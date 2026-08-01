import { createTelegramAdapter } from "@chat-adapter/telegram";
import { createChatSdkState } from "agents/chat-sdk";
import { Chat, type Thread } from "chat";
import { isExplicitSendConfirmation } from "@/agent/confirmation";
import { isConversationResetRequest } from "@/agent/intent";
import { isDeliveryOutcomeUnknown } from "@/agent/storage/drafts";
import type { AgentEnvironment, StoredEmail } from "@/agent/types";
import {
  ACTION_DRAFT_EMAIL,
  ACTION_READ_EMAIL,
  ACTION_SEND_DRAFT,
  ACTION_SHOW_ATTACHMENTS,
  draftCard,
  formatEmail,
  notificationCard,
  toPendingDraft,
} from "@/channels/telegram/cards";
import {
  parseCommand,
  postCommandResult,
} from "@/channels/telegram/commands";
import {
  operationalStateAfterResponse,
  selectedEmailState,
} from "@/channels/telegram/operational-state";
import type {
  ChatDeliveryStatus,
  PersonalAgentActions,
  PersonalChat,
  PersonalChatHost,
  PersonalThreadState,
} from "@/channels/telegram/types";

type TelegramConfiguration = AgentEnvironment & {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  TELEGRAM_BOT_USERNAME: string;
  TELEGRAM_WEBHOOK_SECRET: string;
};

const MAX_CONVERSATIONAL_DRAFT_AGE_MS = 24 * 60 * 60 * 1_000;

async function clearPendingDraftSafely(
  thread: Thread<PersonalThreadState>,
  draftId: string,
): Promise<void> {
  try {
    const state = await thread.state;
    if (state?.pendingDraft?.draftId === draftId) {
      await thread.setState({ pendingDraft: null });
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "chat.pending_draft_state_cleanup_failed",
        draftId,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
  }
}

function telegramConfigured(
  env: AgentEnvironment,
): env is TelegramConfiguration {
  return Boolean(
    env.TELEGRAM_BOT_TOKEN &&
    env.TELEGRAM_CHAT_ID &&
    env.TELEGRAM_BOT_USERNAME &&
    !env.TELEGRAM_BOT_USERNAME.startsWith("your_") &&
    env.TELEGRAM_WEBHOOK_SECRET,
  );
}

async function postAgentResponse(
  thread: Thread<PersonalThreadState>,
  host: PersonalAgentActions,
  text: string,
): Promise<void> {
  let confirmedSend = false;
  try {
    await thread.startTyping();
    const state = await thread.state;

    if (isConversationResetRequest(text)) {
      await resetThread(thread, host);
      return;
    }

    if (state?.pendingDraft && isExplicitSendConfirmation(text)) {
      const draftAge = Date.now() - state.pendingDraft.displayedAt;
      if (
        draftAge < 0 ||
        draftAge > MAX_CONVERSATIONAL_DRAFT_AGE_MS
      ) {
        await thread.setState({ pendingDraft: null });
        await thread.post(
          "That displayed draft is too old for conversational sending. Ask me to prepare a fresh one so you can review it again.",
        );
        return;
      }
      const sent = await host.sendDraft(
        state.pendingDraft.draftId,
        state.pendingDraft.revision,
      );
      if (!sent.messageId?.trim()) {
        throw new Error("Email service did not return a message ID.");
      }
      confirmedSend = true;
      await clearPendingDraftSafely(thread, sent.draftId);
      const confirmationText = "Sent — that exact email is on its way.";
      try {
        await host.saveConversationTurn(thread.id, text, confirmationText);
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "chat.send_conversation_save_failed",
            draftId: sent.draftId,
            error: error instanceof Error ? error.message : "Unknown error",
          }),
        );
      }
      console.log(
        JSON.stringify({
          event: "chat.pending_draft_sent",
          draftId: sent.draftId,
          confirmation: "natural_language",
        }),
      );
      await thread.post(confirmationText);
      return;
    }

    const response = await host.respondToChat({
      activeEmailId: state?.activeEmailId ?? null,
      authorization: "telegram_allowlisted",
      conversationId: thread.id,
      lastInboxPeriod: state?.lastInboxPeriod ?? null,
      lastNotificationEmailId: state?.lastNotificationEmailId ?? null,
      pendingDraft: state?.pendingDraft ?? null,
      presentedEmailIds: state?.presentedEmailIds ?? [],
      text,
    });
    confirmedSend = Boolean(response.sentDraftId);

    if (response.attachments.length > 0) {
      await thread.post({
        markdown: response.text,
        files: response.attachments.map((attachment) => ({
          data: attachment.data,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
        })),
      });
    } else {
      await thread.post(response.text);
    }

    try {
      await thread.setState(operationalStateAfterResponse(response));
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "chat.operational_state_update_failed",
          confirmedSend,
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      );
    }

    for (const draft of response.drafts) {
      await thread.post(draftCard(draft));
      try {
        await thread.setState({ pendingDraft: toPendingDraft(draft) });
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "chat.pending_draft_state_update_failed",
            draftId: draft.draftId,
            error: error instanceof Error ? error.message : "Unknown error",
          }),
        );
      }
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "chat.agent_failed",
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    await thread.post(
      confirmedSend
        ? "The email was sent successfully, but I hit a Telegram response/state problem afterward. Duplicate sends are still blocked."
        : isDeliveryOutcomeUnknown(error)
          ? "I couldn’t confirm whether the email was delivered. I locked that draft to prevent a duplicate send; don’t retry it until delivery is checked."
          : "I hit a problem processing that and did not receive a confirmed send result. Check the draft before retrying.",
    );
  }
}

function neutralThreadState(): PersonalThreadState {
  return {
    activeEmailId: null,
    lastInboxPeriod: null,
    lastNotificationEmailId: null,
    pendingDraft: null,
    presentedEmailIds: [],
  };
}

async function resetThread(
  thread: Thread<PersonalThreadState>,
  host: PersonalAgentActions,
): Promise<void> {
  await host.resetConversation(thread.id);
  await thread.setState(neutralThreadState(), { replace: true });
  console.log(JSON.stringify({ event: "chat.context_reset" }));
  await thread.post(
    "Fresh start. I cleared this chat’s conversation and working context; your emails, memories, and draft/sent records are untouched.",
  );
}

export function createPersonalChat(
  env: AgentEnvironment,
  host: PersonalChatHost,
): PersonalChat | null {
  if (!telegramConfigured(env)) {
    return null;
  }

  const telegram = createTelegramAdapter({
    allowedUserIds: [env.TELEGRAM_CHAT_ID],
    botToken: env.TELEGRAM_BOT_TOKEN,
    mode: "webhook",
    secretToken: env.TELEGRAM_WEBHOOK_SECRET,
    userName: env.TELEGRAM_BOT_USERNAME,
  });

  const chat = new Chat({
    adapters: { telegram },
    concurrency: "queue",
    dedupeTtlMs: 10 * 60 * 1_000,
    logger: "info",
    state: createChatSdkState({ parent: host }),
    userName: env.TELEGRAM_BOT_USERNAME,
  });

  chat.onDirectMessage(async (thread, message) => {
    if (message.author.userId !== env.TELEGRAM_CHAT_ID) {
      return;
    }

    const command = parseCommand(message.text);
    if (command) {
      if (command.name === "/reset") {
        await resetThread(thread, host);
        return;
      }
      await postCommandResult(thread, host, command);
      return;
    }

    await postAgentResponse(thread, host, message.text);
  });

  chat.onSlashCommand(async (event) => {
    if (event.user.userId !== env.TELEGRAM_CHAT_ID) {
      return;
    }

    const command = {
      name: event.command.toLowerCase(),
      arguments: event.text.trim(),
    };
    if (command.name === "/reset") {
      await resetThread(chat.thread(event.channel.id), host);
      return;
    }
    await postCommandResult(chat.thread(event.channel.id), host, command);
  });

  chat.onAction(
    [
      ACTION_READ_EMAIL,
      ACTION_DRAFT_EMAIL,
      ACTION_SEND_DRAFT,
      ACTION_SHOW_ATTACHMENTS,
    ],
    async (event) => {
      if (event.user.userId !== env.TELEGRAM_CHAT_ID || !event.thread) {
        return;
      }

      let confirmedSend = false;
      try {
        if (event.actionId === ACTION_READ_EMAIL) {
          const emailReference = event.value ?? "";
          const email = await host.readEmail(emailReference);
          if (email) {
            await event.thread.setState(selectedEmailState(email.shortId));
          }
          await event.thread.post(
            email
              ? formatEmail(email)
              : `Email ${emailReference} was not found.`,
          );
          return;
        }

        if (event.actionId === ACTION_SHOW_ATTACHMENTS) {
          const emailReference = event.value ?? "";
          const email = await host.readEmail(emailReference);
          if (!email) {
            await event.thread.post(`Email ${emailReference} was not found.`);
            return;
          }
          const attachments = await host.getEmailAttachments(email.shortId);
          if (attachments.length === 0) {
            await event.thread.post("That email does not have any attachments.");
            return;
          }
          await event.thread.setState(selectedEmailState(email.shortId));
          await event.thread.post({
            markdown: `Here ${attachments.length === 1 ? "is the attachment" : "are the attachments"} from **${email.subject}**:`,
            files: attachments.map((attachment) => ({
              data: attachment.data,
              filename: attachment.filename,
              mimeType: attachment.mimeType,
            })),
          });
          return;
        }

        if (event.actionId === ACTION_DRAFT_EMAIL) {
          const emailReference = event.value ?? "";
          await event.thread.setState(selectedEmailState(emailReference));
          await event.thread.post(
            "Tell me what you want the reply to say. For example: “Tell them I’ll get back to them tomorrow.”",
          );
          return;
        }

        const separator = event.value?.lastIndexOf(":") ?? -1;
        const draftId = event.value?.slice(0, separator) ?? "";
        const revision = Number(event.value?.slice(separator + 1));

        if (separator < 1 || !draftId || !Number.isInteger(revision)) {
          await event.thread.post("This confirmation is invalid.");
          return;
        }

        const sent = await host.sendDraft(draftId, revision);
        if (!sent.messageId?.trim()) {
          throw new Error("Email service did not return a message ID.");
        }
        confirmedSend = true;
        const typedThread = event.thread as Thread<PersonalThreadState>;
        await clearPendingDraftSafely(typedThread, draftId);
        await event.thread.post("Sent — that exact email is on its way.");
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "chat.action_failed",
            action: event.actionId,
            error: error instanceof Error ? error.message : "Unknown error",
          }),
        );
        await event.thread.post(
          confirmedSend
            ? "The email was sent successfully, but I hit a Telegram response/state problem afterward. Duplicate sends are still blocked."
            : isDeliveryOutcomeUnknown(error)
              ? "I couldn’t confirm whether the email was delivered. I locked that draft to prevent a duplicate send; don’t retry it until delivery is checked."
            : [
                "That action failed, or I could not deliver its confirmation.",
                "The draft is still safe to review. Duplicate sends are blocked.",
              ].join("\n"),
        );
      }
    },
  );

  return chat;
}

export async function notifyAboutEmail(
  chat: PersonalChat | null,
  env: AgentEnvironment,
  email: StoredEmail,
): Promise<ChatDeliveryStatus> {
  if (!chat || !telegramConfigured(env)) {
    return "not_configured";
  }

  try {
    await chat.initialize();
    const telegram = chat.getAdapter("telegram");
    const threadId = await telegram.openDM(env.TELEGRAM_CHAT_ID);
    const thread = chat.thread(threadId);
    const state = await thread.state;
    await thread.setState({
      lastNotificationEmailId: email.shortId,
      ...(state?.pendingDraft
        ? {}
        : { presentedEmailIds: [email.shortId] }),
    });
    await thread.post(notificationCard(email));
    return "sent";
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "chat.notification_failed",
        emailId: email.shortId,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    return "failed";
  }
}
