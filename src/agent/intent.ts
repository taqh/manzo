import type { InboxPeriod } from "@/agent/time";

export type IntentContext = {
  hasActiveEmail: boolean;
  hasPendingDraft: boolean;
  lastInboxPeriod: InboxPeriod | null;
  presentedEmailCount: number;
};

export type AgentIntent =
  | { kind: "inbox_period"; period: InboxPeriod }
  | { kind: "latest_email" }
  | { kind: "oldest_email" }
  | { kind: "read_email" }
  | { kind: "email_history" }
  | { kind: "email_search" }
  | { kind: "direct_new_email" }
  | { kind: "direct_reply" }
  | { kind: "email_factual" }
  | { kind: "conversation_reset" }
  | { kind: "other" };

export type ForcedAgentTool =
  | "readEmail"
  | "getOldestEmail"
  | "checkPreviousCorrespondence"
  | "searchEmails"
  | "listEmails"
  | "sendNewEmail"
  | "sendReply";

const RESET_NORMALIZATION_PATTERN = /[^a-z/]+/g;
const RESET_REQUEST_PATTERN =
  /^(?:\/reset|reset (?:this )?(?:chat|conversation)|start (?:this )?(?:chat |conversation )?(?:over|fresh)|clear (?:this )?(?:chat|conversation)(?: history)?)$/;
const WHITESPACE_PATTERN = /\s+/g;
const JUST_SEND_PATTERN = /\bjust send\b/;
const SEND_NOW_PATTERN = /\bsend (?:it |this |that )?now\b/;
const SEND_EXACT_PATTERN =
  /\bsend (?:this |the )?exact(?: email| message| reply)?\b/;
const SEND_EXACTLY_PATTERN = /\bsend exactly\b/;
const EXACT_SEND_BODY_PATTERN =
  /\b(?:just send|send exactly|send (?:this |the )?exact(?: message| email| reply)?)\s+["“']([^"”']{1,20000})["”']/i;
const DESCRIBED_SEND_BODY_PATTERN =
  /\b(?:saying|body(?: is)?|message(?: is)?|that says)\s+["“']([^"”']{1,20000})["”']/i;
const SEND_DESCRIPTION_PATTERN =
  /\b(?:saying|say|telling (?:them|him|her)|tell (?:them|him|her)|body(?: is)?|message(?: is)?|that says)\s+([\s\S]{2,})$/i;
const EMAIL_ADDRESS_IN_MESSAGE_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/gi;
const TRAILING_QUOTES_PATTERN = /["”']+$/g;
const INLINE_SEND_PREFIX_PATTERN =
  /^.*?\b(?:just send|send exactly|send (?:it |this |that )?now|send (?:this |the )?exact(?: message| email| reply)?)\b/i;
const EMAIL_TYPE_PREFIX_PATTERN =
  /^\s*(?:an?\s+)?(?:email|mail|message|reply)\b/i;
const TRAILING_TO_PATTERN = /\s+to\s*$/i;
const EMPTY_SEND_REFERENCE_PATTERN = /^(?:it|this|that)(?:\s+now)?$/i;
const SMART_APOSTROPHE_PATTERN = /[’']/g;
const ALPHANUMERIC_NORMALIZATION_PATTERN = /[^a-z0-9]+/g;
const SUBJECT_PATTERN =
  /\bsubject(?: is|:)?\s+["“']?([^"”'\n]{1,120})["”']?(?=\s+(?:and|with|saying|body|message|that says)\b|$)/i;
const EMAIL_MENTION_PATTERN = /\b(?:email|emails|mail|mails|inbox)\b/;
const REPEAT_CHECK_PATTERN =
  /^(?:check|check again|double check|are you sure)[.!? ]*$/;
const YESTERDAY_PATTERN = /\byesterday\b/;
const TODAY_PATTERN = /\btoday\b|\bso far\b/;
const SINGULAR_EMAIL_PATTERN = /\b(?:email|mail|message|inbox)\b/;
const EXPLICIT_PERIOD_PATTERN = /\b(?:today|yesterday|so far)\b/;
const LATEST_PATTERN = /\b(?:last|latest|newest|most recent)\b/;
const PREVIOUS_PERIOD_PATTERN =
  /\b(?:(?:doesn't|doesnt|does not)\s+have\s+to\s+be|not\s+(?:just|only)|not\s+limited\s+to)\s+(?:today|yesterday)\b/;
const OLDEST_PATTERN = /\b(?:oldest|earliest|first)\b/;
const DIRECT_REPLY_PATTERN = /\b(reply|respond)\b/;
const EMAIL_ADDRESS_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/;
const READ_REFERENCE_PATTERN =
  /\b(?:read|open|show)(?: me)? (?:it|that|the email|the message)\b/;
const CONFIRM_READ_PATTERN = /^(?:yes|yeah|yep|sure)(?: please)?[.! ]*$/;
const HISTORY_PATTERN =
  /\b(?:emailed|heard from|corresponded)\b.{0,50}\b(?:before|previously)\b/;
const HISTORY_SUBJECT_PATTERN =
  /\b(?:they|he|she|this sender)\b.{0,30}\bemail(?:ed)?\b.{0,30}\b(?:before|previously)\b/;
const PREVIOUS_EMAIL_PATTERN =
  /\b(?:any|find|show)\s+(?:previous|earlier)\s+(?:email|emails|mail)\b/;
const SEARCH_PATTERN = /\b(?:find|search|look for)\b/;
const SEARCH_EMAIL_PATTERN = /\b(?:email|mail)\b/;
const FACTUAL_EMAIL_PATTERN =
  /\b(?:check|list|latest|recent|read|email|emails|mail|inbox)\b/;
const FACTUAL_ACTION_PATTERN =
  /\b(?:did|do|have|has|what|which|who|when|check|list|latest|recent|read)\b/;

export function isConversationResetRequest(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .replace(RESET_NORMALIZATION_PATTERN, " ")
    .trim();
  return RESET_REQUEST_PATTERN.test(normalized);
}

export function isExplicitDirectSendRequest(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .replace(WHITESPACE_PATTERN, " ")
    .trim();
  return (
    JUST_SEND_PATTERN.test(normalized) ||
    SEND_NOW_PATTERN.test(normalized) ||
    SEND_EXACT_PATTERN.test(normalized) ||
    SEND_EXACTLY_PATTERN.test(normalized)
  );
}

export function hasUsableDirectSendContent(message: string): boolean {
  return authorizedDirectSendBody(message) !== null;
}

export function authorizedDirectSendBody(message: string): string | null {
  if (!isExplicitDirectSendRequest(message)) {
    return null;
  }
  const exact =
    message.match(EXACT_SEND_BODY_PATTERN)?.[1]?.trim() ??
    message.match(DESCRIBED_SEND_BODY_PATTERN)?.[1]?.trim();
  if (exact) {
    return exact;
  }

  const withoutRecipient = message
    .replace(EMAIL_ADDRESS_IN_MESSAGE_PATTERN, " ")
    .trim();
  const described = withoutRecipient.match(SEND_DESCRIPTION_PATTERN)?.[1];
  if (described?.trim()) {
    return described.trim().replace(TRAILING_QUOTES_PATTERN, "").trim();
  }

  const inline = withoutRecipient
    .replace(INLINE_SEND_PREFIX_PATTERN, "")
    .replace(EMAIL_TYPE_PREFIX_PATTERN, "")
    .replace(TRAILING_TO_PATTERN, "")
    .trim();
  if (EMPTY_SEND_REFERENCE_PATTERN.test(inline)) {
    return null;
  }
  return inline.length >= 2 ? inline : null;
}

export function directSendBodyMatches(message: string, body: string): boolean {
  const authorizedBody = authorizedDirectSendBody(message);
  const normalize = (value: string): string =>
    value
      .toLowerCase()
      .replace(SMART_APOSTROPHE_PATTERN, "")
      .replace(ALPHANUMERIC_NORMALIZATION_PATTERN, " ")
      .trim();
  return (
    authorizedBody !== null && normalize(body) === normalize(authorizedBody)
  );
}

export function authorizedDirectSendSubject(message: string): string {
  return message.match(SUBJECT_PATTERN)?.[1]?.trim() || "Quick note";
}

function inboxPeriodFromMessage(
  message: string,
  lastInboxPeriod: InboxPeriod | null
): InboxPeriod | null {
  const normalized = message.toLowerCase();
  const mentionsEmail = EMAIL_MENTION_PATTERN.test(normalized);
  if (REPEAT_CHECK_PATTERN.test(normalized.trim())) {
    return lastInboxPeriod;
  }
  if (!mentionsEmail) {
    return null;
  }
  if (YESTERDAY_PATTERN.test(normalized)) {
    return "yesterday";
  }
  if (TODAY_PATTERN.test(normalized)) {
    return "today";
  }
  return null;
}

function requestsLatestEmail(
  message: string,
  lastInboxPeriod: InboxPeriod | null
): boolean {
  const normalized = message.toLowerCase().replace(/[’]/g, "'");
  const mentionsSingularEmail = SINGULAR_EMAIL_PATTERN.test(normalized);
  const mentionsExplicitPeriod = EXPLICIT_PERIOD_PATTERN.test(normalized);
  const explicitlyLatest =
    mentionsSingularEmail &&
    !mentionsExplicitPeriod &&
    LATEST_PATTERN.test(normalized);
  const removesPreviousPeriod =
    lastInboxPeriod !== null && PREVIOUS_PERIOD_PATTERN.test(normalized);

  return explicitlyLatest || removesPreviousPeriod;
}

function requestsOldestEmail(message: string): boolean {
  const normalized = message.toLowerCase();
  const mentionsSingularEmail = SINGULAR_EMAIL_PATTERN.test(normalized);
  const mentionsExplicitPeriod = EXPLICIT_PERIOD_PATTERN.test(normalized);

  return (
    mentionsSingularEmail &&
    !mentionsExplicitPeriod &&
    OLDEST_PATTERN.test(normalized)
  );
}

export function classifyAgentIntent(
  message: string,
  context: IntentContext
): AgentIntent {
  if (isConversationResetRequest(message)) {
    return { kind: "conversation_reset" };
  }

  const normalized = message.toLowerCase().trim();
  if (requestsOldestEmail(message)) {
    return { kind: "oldest_email" };
  }
  if (requestsLatestEmail(message, context.lastInboxPeriod)) {
    return { kind: "latest_email" };
  }
  const inboxPeriod = inboxPeriodFromMessage(message, context.lastInboxPeriod);
  if (inboxPeriod) {
    return { kind: "inbox_period", period: inboxPeriod };
  }

  const directSend = isExplicitDirectSendRequest(message);
  if (directSend && DIRECT_REPLY_PATTERN.test(normalized)) {
    return { kind: "direct_reply" };
  }
  if (directSend && EMAIL_ADDRESS_PATTERN.test(message)) {
    return { kind: "direct_new_email" };
  }
  if (directSend && context.hasActiveEmail) {
    return { kind: "direct_reply" };
  }

  if (
    READ_REFERENCE_PATTERN.test(normalized) ||
    (CONFIRM_READ_PATTERN.test(normalized) &&
      !context.hasPendingDraft &&
      context.presentedEmailCount === 1)
  ) {
    return { kind: "read_email" };
  }

  if (
    HISTORY_PATTERN.test(normalized) ||
    HISTORY_SUBJECT_PATTERN.test(normalized) ||
    PREVIOUS_EMAIL_PATTERN.test(normalized)
  ) {
    return { kind: "email_history" };
  }
  if (
    SEARCH_PATTERN.test(normalized) &&
    SEARCH_EMAIL_PATTERN.test(normalized)
  ) {
    return { kind: "email_search" };
  }
  if (
    FACTUAL_EMAIL_PATTERN.test(normalized) &&
    FACTUAL_ACTION_PATTERN.test(normalized)
  ) {
    return { kind: "email_factual" };
  }

  return { kind: "other" };
}

export function forcedToolForIntent(
  intent: AgentIntent
): ForcedAgentTool | null {
  switch (intent.kind) {
    case "read_email":
      return "readEmail";
    case "latest_email":
      return "listEmails";
    case "oldest_email":
      return "getOldestEmail";
    case "email_history":
      return "checkPreviousCorrespondence";
    case "email_search":
      return "searchEmails";
    case "email_factual":
      return "listEmails";
    case "direct_new_email":
      return "sendNewEmail";
    case "direct_reply":
      return "sendReply";
    default:
      return null;
  }
}
