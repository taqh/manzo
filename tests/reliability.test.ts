import assert from "node:assert/strict";
import test from "node:test";
import { isExplicitSendConfirmation } from "../src/agent/confirmation.ts";
import {
  CONVERSATION_RUNTIME_VERSION,
  scopedConversationId,
} from "../src/agent/conversation.ts";
import {
  buildRuntimeInstructions,
  capabilityIntroduction,
  deterministicCapabilityResponse,
  helpMessage,
  runtimeCapabilities,
} from "../src/agent/instructions.ts";
import {
  authorizedDirectSendBody,
  classifyAgentIntent,
  directSendBodyMatches,
  forcedToolForIntent,
  hasUsableDirectSendContent,
  isConversationResetRequest,
  isExplicitDirectSendRequest,
} from "../src/agent/intent.ts";
import { cleanModelText } from "../src/agent/model-text.ts";
import { enforceResponsePostconditions } from "../src/agent/postconditions.ts";
import { learnProfileFromTrustedTelegramMessage } from "../src/agent/profile.ts";
import { inboxPeriodRange } from "../src/agent/time.ts";
import {
  operationalStateAfterResponse,
  resolveReplyReference,
  selectedEmailState,
} from "../src/channels/telegram/operational-state.ts";

const emptyProfile = {
  agentName: null,
  ownerName: null,
  timeZone: null,
  updatedAt: null,
} as const;

const baseContext = {
  hasActiveEmail: false,
  hasPendingDraft: false,
  lastInboxPeriod: null,
  presentedEmailCount: 0,
} as const;

const AUTO_NOTIFY_PATTERN = /automatically notify/i;
const HELP_COMMAND_PATTERN = /\/help/i;
const TELEGRAM_NOTIFICATION_PATTERN = /triggers a Telegram notification/i;
const AUTO_MAIL_PATTERN = /automatically when new mail arrives/i;
const LOOKS_GOOD_SEND_PATTERN = /looks good, send/i;
const JUST_SEND_PATTERN = /just send/i;
const REMEMBER_PREFERENCES_PATTERN = /Remember stable preferences/i;
const WEB_BROWSING_PATTERN = /web browsing/i;
const SHARE_ATTACHMENTS_PATTERN = /share attachments/i;
const UPLOADED_FILES_PATTERN = /attach files uploaded/i;
const LIST_OR_SHARE_PATTERN = /list them|share them/i;
const OUTGOING_DRAFT_PATTERN = /outgoing email draft/i;
const RESUME_PATTERN = /resume\.pdf/;
const STAGED_PRIVATELY_PATTERN = /staged privately/;
const EXPLICIT_ATTACHMENT_PATTERN =
  /explicitly asks to use, include, or attach/;
const INBOX_AGENT_PATTERN = /your inbox agent/i;
const COULD_NOT_VERIFY_PATTERN = /couldn.t verify/i;
const COULD_NOT_CREATE_PATTERN = /wasn.t able to create/i;
const NO_CONFIRMED_SEND_PATTERN = /not receive a confirmed send result/i;
const SEND_CAPABILITY_PATTERN = /I can compose and send email/i;

test("profile timezone today and yesterday use local calendar boundaries", () => {
  const now = Date.parse("2026-08-01T00:30:00.000Z");
  assert.deepEqual(inboxPeriodRange("today", now, "America/New_York"), {
    endAt: Date.parse("2026-08-01T04:00:00.000Z"),
    startAt: Date.parse("2026-07-31T04:00:00.000Z"),
  });
  assert.deepEqual(inboxPeriodRange("yesterday", now, "America/New_York"), {
    endAt: Date.parse("2026-07-31T04:00:00.000Z"),
    startAt: Date.parse("2026-07-30T04:00:00.000Z"),
  });
  assert.deepEqual(inboxPeriodRange("today", now), {
    endAt: Date.parse("2026-08-02T00:00:00.000Z"),
    startAt: Date.parse("2026-08-01T00:00:00.000Z"),
  });
});

test("profile learning accepts only explicit trusted declarations", () => {
  assert.deepEqual(
    learnProfileFromTrustedTelegramMessage(
      "My name is Avery. Your name is Nimbus. My timezone is Europe/Paris."
    ),
    {
      agentName: "Nimbus",
      ownerName: "Avery",
      timeZone: "Europe/Paris",
    }
  );
  assert.deepEqual(learnProfileFromTrustedTelegramMessage("I'm tired"), {});
  assert.deepEqual(
    learnProfileFromTrustedTelegramMessage(
      "> My name is someone else\nFrom: sender@example.net"
    ),
    {}
  );
  assert.deepEqual(
    learnProfileFromTrustedTelegramMessage("My timezone is Not/AZone"),
    {}
  );
});

test("today checks and repeat checks route deterministically", () => {
  assert.deepEqual(
    classifyAgentIntent(
      "How many emails have I received today so far?",
      baseContext
    ),
    { kind: "inbox_period", period: "today" }
  );
  assert.deepEqual(
    classifyAgentIntent("Check", {
      ...baseContext,
      lastInboxPeriod: "yesterday",
    }),
    { kind: "inbox_period", period: "yesterday" }
  );
});

test("latest email requests are all-time and period corrections clear today", () => {
  assert.deepEqual(
    classifyAgentIntent("What was the last email we received?", baseContext),
    { kind: "latest_email" }
  );
  assert.deepEqual(
    classifyAgentIntent("Show me the most recent stored email", baseContext),
    { kind: "latest_email" }
  );
  assert.deepEqual(
    classifyAgentIntent("Doesn’t have to be today", {
      ...baseContext,
      lastInboxPeriod: "today",
    }),
    { kind: "latest_email" }
  );
  assert.deepEqual(
    classifyAgentIntent("Did I receive any emails?", baseContext),
    { kind: "email_factual" }
  );
  assert.deepEqual(
    classifyAgentIntent("Show my latest email today", baseContext),
    { kind: "inbox_period", period: "today" }
  );
  assert.deepEqual(classifyAgentIntent("List my latest emails", baseContext), {
    kind: "email_factual",
  });
});

test("oldest email requests use the complete-inbox boundary query", () => {
  for (const message of [
    "What is the oldest mail in our inbox?",
    "Show me the earliest stored email",
    "What was the first email we received?",
  ]) {
    const intent = classifyAgentIntent(message, baseContext);
    assert.deepEqual(intent, { kind: "oldest_email" });
    assert.equal(forcedToolForIntent(intent), "getOldestEmail");
  }
  assert.deepEqual(
    classifyAgentIntent("Show the oldest email today", baseContext),
    { kind: "inbox_period", period: "today" }
  );
});

test("factual email intents force a read tool on the first model step", () => {
  assert.equal(
    forcedToolForIntent(
      classifyAgentIntent("List my latest emails", baseContext)
    ),
    "listEmails"
  );
  assert.equal(
    forcedToolForIntent(
      classifyAgentIntent("Have they emailed us before?", {
        ...baseContext,
        hasActiveEmail: true,
      })
    ),
    "checkPreviousCorrespondence"
  );
});

test("single presented email makes yes/read-it a read reference", () => {
  const context = { ...baseContext, presentedEmailCount: 1 };
  assert.deepEqual(classifyAgentIntent("Yes please", context), {
    kind: "read_email",
  });
  assert.deepEqual(classifyAgentIntent("Read it", context), {
    kind: "read_email",
  });
});

test("direct sends require explicit wording and usable content", () => {
  const direct = "Just send hello there to friend@example.com";
  assert.equal(isExplicitDirectSendRequest(direct), true);
  assert.equal(hasUsableDirectSendContent(direct), true);
  assert.deepEqual(classifyAgentIntent(direct, baseContext), {
    kind: "direct_new_email",
  });
  assert.equal(
    authorizedDirectSendBody('Just send "hello there" to friend@example.com'),
    "hello there"
  );
  assert.equal(directSendBodyMatches(direct, "Hello there."), true);
  assert.equal(
    directSendBodyMatches(direct, "Hello there, hope you're well."),
    false
  );

  assert.equal(
    isExplicitDirectSendRequest("Email friend@example.com about tomorrow"),
    false
  );
  assert.equal(
    hasUsableDirectSendContent("Just send an email to friend@example.com"),
    false
  );
  assert.equal(hasUsableDirectSendContent("just send it"), false);
});

test("previewed drafts accept natural conversational confirmations", () => {
  for (const message of [
    "looks good, send",
    "yes send that",
    "send it",
    "go ahead",
    "just send it",
    "just send this now",
  ]) {
    assert.equal(isExplicitSendConfirmation(message), true, message);
  }
  assert.equal(
    isExplicitSendConfirmation("change the body and send it"),
    false
  );
});

test("explicit email selection wins and a different direct send clears stale pending state", () => {
  assert.deepEqual(selectedEmailState("email-b"), {
    activeEmailId: "email-b",
    presentedEmailIds: ["email-b"],
  });
  assert.equal(
    resolveReplyReference({
      activeEmailId: "email-b",
      lastNotificationEmailId: "email-c",
      presentedEmailIds: ["email-a"],
    }),
    "email-b"
  );
  assert.deepEqual(
    operationalStateAfterResponse({
      activeEmailId: "email-b",
      lastInboxPeriod: null,
      presentedEmailIds: ["email-b"],
      sentDraftId: "new-direct-draft",
    }),
    {
      activeEmailId: "email-b",
      lastInboxPeriod: null,
      pendingDraft: null,
      presentedEmailIds: ["email-b"],
    }
  );
});

test("reset is deliberately narrow and versioned history ignores old turns", () => {
  assert.equal(isConversationResetRequest("reset this conversation"), true);
  assert.equal(isConversationResetRequest("start fresh"), true);
  assert.equal(isConversationResetRequest("forget everything about me"), false);
  assert.equal(
    scopedConversationId("telegram:123"),
    `${CONVERSATION_RUNTIME_VERSION}:telegram:123`
  );
});

test("deadline wording does not get hijacked as correspondence history", () => {
  assert.deepEqual(
    classifyAgentIntent(
      "Draft an email to friend@example.com before tomorrow",
      baseContext
    ),
    { kind: "other" }
  );
});

test("runtime capabilities truthfully include proactive notification and sending", () => {
  const capabilities = runtimeCapabilities([
    "getInboxSummary",
    "readEmail",
    "searchEmails",
    "findPreviousEmailsFrom",
    "createDraft",
    "createNewEmailDraft",
    "sendPendingDraft",
    "sendNewEmail",
    "sendReply",
    "listEmailAttachments",
    "sendAttachmentsToTelegram",
  ]);
  assert.equal(capabilities.proactiveEmailNotifications, true);
  assert.equal(capabilities.sendEmail, true);
  assert.equal(capabilities.browseWeb, false);
  assert.equal(capabilities.inspectAttachments, true);
  assert.match(capabilityIntroduction(emptyProfile), AUTO_NOTIFY_PATTERN);
  assert.match(capabilityIntroduction(emptyProfile), HELP_COMMAND_PATTERN);
  assert.match(
    deterministicCapabilityResponse("Cool, lmk if any comes up") ?? "",
    TELEGRAM_NOTIFICATION_PATTERN
  );
});

test("help lists natural capabilities and every Telegram command", () => {
  const help = helpMessage();
  for (const command of [
    "/start",
    "/latest",
    "/read",
    "/draft",
    "/memory",
    "/reset",
    "/help",
  ]) {
    assert.match(help, new RegExp(command.replace("/", "\\/")));
  }
  assert.match(help, AUTO_MAIL_PATTERN);
  assert.match(help, LOOKS_GOOD_SEND_PATTERN);
  assert.match(help, JUST_SEND_PATTERN);
  assert.match(help, REMEMBER_PREFERENCES_PATTERN);
  assert.match(help, WEB_BROWSING_PATTERN);
  assert.match(help, SHARE_ATTACHMENTS_PATTERN);
  assert.match(help, UPLOADED_FILES_PATTERN);
});

test("attachment requests are not mistaken for capability questions", () => {
  assert.equal(
    deterministicCapabilityResponse("Can you show me the attachment?"),
    null
  );
  assert.match(
    deterministicCapabilityResponse("Can you inspect attachments?") ?? "",
    LIST_OR_SHARE_PATTERN
  );
  assert.match(
    deterministicCapabilityResponse("Can you attach files to an email?") ?? "",
    OUTGOING_DRAFT_PATTERN
  );
});

test("runtime instructions expose staged Telegram uploads without authorizing them", () => {
  const runtime = buildRuntimeInstructions({
    activeEmailId: null,
    localTime: "2026-08-01 12:00 UTC",
    memories: [],
    pendingAttachments: [
      {
        conversationId: "telegram:owner",
        filename: "resume.pdf",
        id: "tg_resume",
        mimeType: "application/pdf",
        size: 1024,
      },
    ],
    pendingDraft: null,
    profile: emptyProfile,
    toolNames: ["createDraft", "createNewEmailDraft", "listPendingAttachments"],
  });

  assert.match(runtime, RESUME_PATTERN);
  assert.match(runtime, STAGED_PRIVATELY_PATTERN);
  assert.match(runtime, EXPLICIT_ATTACHMENT_PATTERN);
});

test("runtime copy stays neutral until profile values are learned", () => {
  const introduction = capabilityIntroduction(emptyProfile);
  assert.match(introduction, INBOX_AGENT_PATTERN);
});

test("postconditions block false check, draft, and send claims", () => {
  assert.match(
    enforceResponsePostconditions("I checked: no new emails.", {
      draftCreated: false,
      factualDataRead: false,
      factualIntent: true,
      sentMessageId: null,
    }).text,
    COULD_NOT_VERIFY_PATTERN
  );
  assert.match(
    enforceResponsePostconditions("I've prepared the draft.", {
      draftCreated: false,
      factualDataRead: false,
      factualIntent: false,
      sentMessageId: null,
    }).text,
    COULD_NOT_CREATE_PATTERN
  );
  assert.match(
    enforceResponsePostconditions("I've sent the email; it is on its way.", {
      draftCreated: false,
      factualDataRead: false,
      factualIntent: false,
      sentMessageId: null,
    }).text,
    NO_CONFIRMED_SEND_PATTERN
  );
  assert.match(
    enforceResponsePostconditions("I can't send emails with my tools.", {
      draftCreated: false,
      factualDataRead: false,
      factualIntent: false,
      sentMessageId: null,
    }).text,
    SEND_CAPABILITY_PATTERN
  );
});

test("confirmation-like follow-ups with new content are not send confirmations", () => {
  assert.equal(
    isExplicitSendConfirmation(
      "yes do that but the body should be here is my resume"
    ),
    false
  );
});

test("raw provider tool markup never reaches Telegram text", () => {
  assert.equal(
    cleanModelText(
      '<|tool_calls_section_begin|><|tool_call_begin|>functions.composeEmail<|tool_call_argument_begin|>{"to":"friend@example.net"}<|tool_call_end|><|tool_calls_section_end|>'
    ),
    ""
  );
  assert.equal(
    cleanModelText("I prepared it. <|tool_calls_section_begin|>ignored"),
    "I prepared it."
  );
});
