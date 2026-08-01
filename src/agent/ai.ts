import { isStepCount, type ModelMessage, ToolLoopAgent } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { isExplicitSendConfirmation } from "@/agent/confirmation";
import {
  buildRuntimeInstructions,
  deterministicCapabilityResponse,
} from "@/agent/instructions";
import {
  type AgentIntent,
  classifyAgentIntent,
  forcedToolForIntent,
  hasUsableDirectSendContent,
  isExplicitDirectSendRequest,
} from "@/agent/intent";
import { cleanModelText } from "@/agent/model-text";
import { enforceResponsePostconditions } from "@/agent/postconditions";
import { learnProfileFromTrustedTelegramMessage } from "@/agent/profile";
import { DEFAULT_TIME_ZONE, formatLocalTimestamp } from "@/agent/time";
import {
  createAgentTools,
  createPersonalToolContext,
  type PersonalAiHost,
} from "@/agent/tools";
import type {
  AgentChatResponse,
  AgentEnvironment,
  AgentMessageInput,
  ConversationMessage,
  InboxPeriodSummary,
  OutgoingEmailAttachment,
  PersonalMemory,
  StoredEmailSummary,
} from "@/agent/types";

export const DEFAULT_AI_MODEL = "@cf/moonshotai/kimi-k2.7-code";

const DEFAULT_AI_GATEWAY = "default";
const MAX_USER_MESSAGE_LENGTH = 8000;
const MAX_CONVERSATION_MESSAGES = 24;
const MAX_AGENT_STEPS = 8;
const MODEL_ID_PATTERN =
  /^(?:@cf\/[a-z0-9._-]+\/[a-z0-9._-]+|[a-z0-9._-]+\/[a-z0-9._-]+)$/i;
const GATEWAY_ID_PATTERN = /^[a-z0-9_-]+$/i;

export type { PersonalAiHost } from "@/agent/tools";

function normalizeModelId(value: string | undefined): string {
  const model = value?.trim() || DEFAULT_AI_MODEL;
  if (model.length > 160 || !MODEL_ID_PATTERN.test(model)) {
    throw new Error("AI_MODEL is not a valid Cloudflare model identifier.");
  }
  return model;
}

function normalizeGatewayId(value: string | undefined): string {
  const gateway = value?.trim() || DEFAULT_AI_GATEWAY;
  if (gateway.length > 96 || !GATEWAY_ID_PATTERN.test(gateway)) {
    throw new Error("AI_GATEWAY_ID is not a valid gateway identifier.");
  }
  return gateway;
}

function conversationForModel(
  messages: ConversationMessage[],
  userMessage: string,
  now: number,
  timeZone: string
): ModelMessage[] {
  return [
    ...messages.slice(-MAX_CONVERSATION_MESSAGES).map(
      (message): ModelMessage => ({
        content: `[Historical ${formatLocalTimestamp(message.createdAt, timeZone)}]\n${message.content}`,
        role: message.role,
      })
    ),
    {
      content: `[Current trusted Telegram message at ${formatLocalTimestamp(now, timeZone)}]\n${userMessage}`,
      role: "user",
    },
  ];
}

function friendlySender(email: StoredEmailSummary): string {
  return email.senderName?.trim() || email.sender;
}

function formatBoundaryEmail(
  email: StoredEmailSummary | null | undefined,
  boundary: "latest" | "oldest",
  timeZone: string
): string {
  if (!email) {
    return "I don’t have any stored emails yet.";
  }
  const sender = email.senderName?.trim()
    ? `${email.senderName.trim()} <${email.sender}>`
    : email.sender;
  return [
    `Your ${boundary} stored email is:`,
    `From: ${sender}`,
    `Subject: ${email.subject}`,
    `Received: ${formatLocalTimestamp(email.receivedAt, timeZone)}`,
    `Email ID: ${email.shortId}`,
    "",
    "Say “read it” if you want the message contents.",
  ].join("\n");
}

function formatInboxSummary(summary: InboxPeriodSummary): string {
  const label = summary.period;
  const timeZone = summary.timeZone ?? DEFAULT_TIME_ZONE;
  const timeZoneLabel = `using ${timeZone}`;
  if (summary.count === 0) {
    return `No emails arrived ${label} (${timeZoneLabel}).`;
  }
  const unread =
    summary.unreadCount > 0
      ? ` ${summary.unreadCount} ${summary.unreadCount === 1 ? "is" : "are"} unread.`
      : " They’re all marked read.";
  const emails = summary.emails
    .slice(0, 10)
    .map(
      (email, index) =>
        `${index + 1}. ${friendlySender(email)} — “${email.subject}” at ${new Intl.DateTimeFormat(
          "en-GB",
          { hour: "2-digit", minute: "2-digit", timeZone }
        ).format(new Date(email.receivedAt))}`
    );
  const omitted = summary.count - emails.length;
  return [
    `You received ${summary.count} ${summary.count === 1 ? "email" : "emails"} ${label} (${timeZoneLabel}).${unread}`,
    "",
    ...emails,
    omitted > 0 ? `…and ${omitted} more.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function factualIntent(intent: AgentIntent): boolean {
  return [
    "inbox_period",
    "latest_email",
    "oldest_email",
    "read_email",
    "email_history",
    "email_search",
    "email_factual",
  ].includes(intent.kind);
}

function saveTurnSafely(
  host: PersonalAiHost,
  conversationId: string,
  userMessage: string,
  assistantMessage: string,
  sentDraftId: string | null
): void {
  try {
    host.saveConversationTurn(conversationId, userMessage, assistantMessage);
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
        event: "agent.conversation_save_failed",
        sentDraftId,
      })
    );
  }
}

function deterministicResponse(
  host: PersonalAiHost,
  input: AgentMessageInput,
  model: string,
  text: string,
  options: {
    activeEmailId?: string | null;
    lastInboxPeriod?: AgentChatResponse["lastInboxPeriod"];
    presentedEmailIds?: string[];
  } = {}
): AgentChatResponse {
  saveTurnSafely(host, input.conversationId, input.text.trim(), text, null);
  return {
    activeEmailId:
      options.activeEmailId === undefined
        ? input.activeEmailId
        : options.activeEmailId,
    attachments: [],
    consumedAttachmentIds: [],
    drafts: [],
    lastInboxPeriod:
      options.lastInboxPeriod === undefined
        ? input.lastInboxPeriod
        : options.lastInboxPeriod,
    model,
    presentedEmailIds: options.presentedEmailIds ?? input.presentedEmailIds,
    sentDraftId: null,
    text,
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This is the central deterministic routing and tool orchestration boundary.
export async function runPersonalAgent(
  env: AgentEnvironment,
  host: PersonalAiHost,
  input: AgentMessageInput
): Promise<AgentChatResponse> {
  const userMessage = input.text.trim();
  if (!userMessage || userMessage.length > MAX_USER_MESSAGE_LENGTH) {
    throw new Error(
      `Messages must be between 1 and ${MAX_USER_MESSAGE_LENGTH} characters.`
    );
  }

  if (input.authorization === "telegram_allowlisted") {
    const profileUpdate = learnProfileFromTrustedTelegramMessage(userMessage);
    if (Object.keys(profileUpdate).length > 0) {
      host.updateProfile(profileUpdate);
    }
  }
  const profile = host.getProfile();
  const pendingAttachments = host.listUploadedAttachments(
    input.uploadedAttachmentIds
  );
  const timeZone = profile.timeZone ?? DEFAULT_TIME_ZONE;

  const modelId = normalizeModelId(env.AI_MODEL);
  const intent = classifyAgentIntent(userMessage, {
    hasActiveEmail: Boolean(
      input.activeEmailId ||
        input.presentedEmailIds[0] ||
        input.lastNotificationEmailId
    ),
    hasPendingDraft: Boolean(input.pendingDraft),
    lastInboxPeriod: input.lastInboxPeriod,
    presentedEmailCount: input.presentedEmailIds.length,
  });
  console.log(
    JSON.stringify({
      event: "agent.intent_routed",
      hasPendingDraft: Boolean(input.pendingDraft),
      hasSelectedEmail: Boolean(input.activeEmailId),
      intent: intent.kind,
      presentedEmailCount: input.presentedEmailIds.length,
    })
  );

  if (intent.kind === "conversation_reset") {
    host.resetConversation(input.conversationId);
    return {
      activeEmailId: null,
      attachments: [],
      consumedAttachmentIds: [],
      drafts: [],
      lastInboxPeriod: null,
      model: modelId,
      presentedEmailIds: [],
      sentDraftId: null,
      text: "Fresh start. I cleared this chat’s conversation and working context; your emails, memories, and draft/sent records are untouched.",
    };
  }

  const capabilityText = deterministicCapabilityResponse(userMessage);
  if (capabilityText) {
    return deterministicResponse(host, input, modelId, capabilityText);
  }

  if (intent.kind === "inbox_period") {
    const summary = host.getInboxSummary(intent.period);
    const text = formatInboxSummary(summary);
    console.log(
      JSON.stringify({
        count: summary.count,
        event: "agent.inbox_period_checked",
        period: intent.period,
        unreadCount: summary.unreadCount,
      })
    );
    return deterministicResponse(host, input, modelId, text, {
      lastInboxPeriod: intent.period,
      presentedEmailIds: summary.emails.map((email) => email.shortId),
    });
  }

  if (intent.kind === "latest_email") {
    const [latest] = host.listEmails(1);
    console.log(
      JSON.stringify({
        emailId: latest?.shortId ?? null,
        event: "agent.latest_email_checked",
        found: Boolean(latest),
      })
    );
    return deterministicResponse(
      host,
      input,
      modelId,
      formatBoundaryEmail(latest, "latest", timeZone),
      {
        activeEmailId: latest?.shortId ?? null,
        lastInboxPeriod: null,
        presentedEmailIds: latest ? [latest.shortId] : [],
      }
    );
  }

  if (intent.kind === "oldest_email") {
    const oldest = host.getOldestEmail();
    console.log(
      JSON.stringify({
        emailId: oldest?.shortId ?? null,
        event: "agent.oldest_email_checked",
        found: Boolean(oldest),
      })
    );
    return deterministicResponse(
      host,
      input,
      modelId,
      formatBoundaryEmail(oldest, "oldest", timeZone),
      {
        activeEmailId: oldest?.shortId ?? null,
        lastInboxPeriod: null,
        presentedEmailIds: oldest ? [oldest.shortId] : [],
      }
    );
  }

  if (
    isExplicitDirectSendRequest(userMessage) &&
    !hasUsableDirectSendContent(userMessage)
  ) {
    return deterministicResponse(
      host,
      input,
      modelId,
      "I can send that directly, but I still need usable message content. Tell me exactly what it should say."
    );
  }
  if (isExplicitDirectSendRequest(userMessage) && intent.kind === "other") {
    return deterministicResponse(
      host,
      input,
      modelId,
      "I can send that directly, but I need a recipient email address or a selected email to reply to."
    );
  }

  const gatewayId = normalizeGatewayId(env.AI_GATEWAY_ID);
  const memories: PersonalMemory[] = host.listMemories();
  const toolContext = createPersonalToolContext(
    host,
    input,
    userMessage,
    memories
  );
  const tools = createAgentTools(toolContext);
  const forcedTool = forcedToolForIntent(intent) as keyof typeof tools | null;
  const activeTools = (Object.keys(tools) as Array<keyof typeof tools>).filter(
    (toolName) =>
      (isExplicitDirectSendRequest(userMessage) ||
        !["sendNewEmail", "sendReply"].includes(toolName)) &&
      (toolName !== "sendPendingDraft" ||
        Boolean(input.pendingDraft && isExplicitSendConfirmation(userMessage)))
  );
  const workersai = createWorkersAI({
    binding: env.AI,
    gateway: { collectLog: false, id: gatewayId },
  });
  const model =
    modelId === DEFAULT_AI_MODEL
      ? workersai(modelId, { reasoning_effort: "low" })
      : workersai(modelId);
  const now = Date.now();

  const agent = new ToolLoopAgent({
    activeTools,
    instructions: buildRuntimeInstructions({
      activeEmailId: input.activeEmailId,
      localTime: formatLocalTimestamp(now, timeZone),
      memories,
      pendingAttachments,
      pendingDraft: input.pendingDraft,
      profile,
      toolNames: Object.keys(tools),
    }),
    maxOutputTokens: 900,
    model,
    prepareStep: ({ stepNumber }) => {
      if (!forcedTool) {
        return;
      }
      if (stepNumber === 0) {
        return {
          activeTools: [forcedTool],
          toolChoice: { toolName: forcedTool, type: "tool" as const },
        };
      }
      return { activeTools: [], toolChoice: "none" as const };
    },
    stopWhen: isStepCount(MAX_AGENT_STEPS),
    temperature: 0.3,
    tools,
  });

  const result = await agent.generate({
    messages: conversationForModel(
      host.listConversationMessages(
        input.conversationId,
        MAX_CONVERSATION_MESSAGES
      ),
      userMessage,
      now,
      timeZone
    ),
    timeout: { stepMs: 25_000, totalMs: 60_000 },
  });

  const sent = toolContext.result.sentDrafts.at(-1) ?? null;
  const attachments: OutgoingEmailAttachment[] = [];
  let attachmentDeliveryFailed = false;
  for (const request of toolContext.result.attachmentRequests) {
    try {
      attachments.push(
        ...(await host.getEmailAttachments(
          request.emailId,
          request.attachmentIds
        ))
      );
    } catch (error) {
      attachmentDeliveryFailed = true;
      console.error(
        JSON.stringify({
          emailId: request.emailId,
          error: error instanceof Error ? error.message : "Unknown error",
          event: "agent.attachment_load_failed",
        })
      );
    }
  }
  let text =
    cleanModelText(result.text) ||
    "I finished, but I don’t have a useful response.";
  if (sent) {
    text = "Sent — that email is on its way.";
  } else if (toolContext.result.deliveryOutcomeUnknown) {
    text =
      "I couldn’t confirm whether the email was delivered. I locked that draft to prevent a duplicate send; don’t retry it until delivery is checked.";
  } else if (toolContext.result.drafts.length > 0) {
    text = "Here’s the draft. Nothing has been sent yet.";
  } else if (isExplicitDirectSendRequest(userMessage)) {
    text =
      "I couldn’t complete a direct send from that request. Check the recipient and message content, then try again.";
  }
  if (attachments.length > 0) {
    text = `Here ${attachments.length === 1 ? "is the requested attachment" : "are the requested attachments"}.`;
  } else if (attachmentDeliveryFailed) {
    text =
      "I found the requested attachment, but couldn’t retrieve it from private storage.";
  }

  const postconditions = enforceResponsePostconditions(text, {
    draftCreated: toolContext.result.drafts.length > 0,
    factualDataRead: toolContext.result.factualToolsRun.length > 0,
    factualIntent: factualIntent(intent),
    sentMessageId: sent?.messageId ?? null,
  });
  ({ text } = postconditions);
  saveTurnSafely(
    host,
    input.conversationId,
    userMessage,
    text,
    sent?.draftId ?? null
  );

  const toolCalls = result.steps.flatMap((step) =>
    step.toolCalls.map((call) => call.toolName)
  );
  console.log(
    JSON.stringify({
      attachmentCount: attachments.length,
      attachmentDeliveryFailed,
      deliveryOutcomeUnknown: toolContext.result.deliveryOutcomeUnknown,
      draftCount: toolContext.result.drafts.length,
      event: "agent.response_generated",
      factualToolsRun: toolContext.result.factualToolsRun,
      inputTokens: result.usage.inputTokens,
      intent: intent.kind,
      model: modelId,
      outputTokens: result.usage.outputTokens,
      postconditionViolations: postconditions.violations,
      sent: Boolean(sent?.messageId),
      steps: result.steps.length,
      toolCalls,
    })
  );

  return {
    activeEmailId: toolContext.result.selectedEmailId,
    attachments,
    consumedAttachmentIds: toolContext.result.consumedAttachmentIds,
    drafts: sent ? [] : toolContext.result.drafts,
    lastInboxPeriod: input.lastInboxPeriod,
    model: modelId,
    presentedEmailIds:
      toolContext.result.presentedEmailIds.length > 0
        ? toolContext.result.presentedEmailIds
        : input.presentedEmailIds,
    sentDraftId: sent?.draftId ?? null,
    text,
  };
}
