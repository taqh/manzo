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

export function isConversationResetRequest(message: string): boolean {
  const normalized = message.toLowerCase().replace(/[^a-z/]+/g, " ").trim();
  return /^(?:\/reset|reset (?:this )?(?:chat|conversation)|start (?:this )?(?:chat |conversation )?(?:over|fresh)|clear (?:this )?(?:chat|conversation)(?: history)?)$/.test(
    normalized,
  );
}

export function isExplicitDirectSendRequest(message: string): boolean {
  const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    /\bjust send\b/.test(normalized) ||
    /\bsend (?:it |this |that )?now\b/.test(normalized) ||
    /\bsend (?:this |the )?exact(?: email| message| reply)?\b/.test(
      normalized,
    ) ||
    /\bsend exactly\b/.test(normalized)
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
    message.match(
      /\b(?:just send|send exactly|send (?:this |the )?exact(?: message| email| reply)?)\s+["“']([^"”']{1,20000})["”']/i,
    )?.[1]?.trim() ??
    message.match(
      /\b(?:saying|body(?: is)?|message(?: is)?|that says)\s+["“']([^"”']{1,20000})["”']/i,
    )?.[1]?.trim();
  if (exact) {
    return exact;
  }

  const withoutRecipient = message
    .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/gi, " ")
    .trim();
  const described = withoutRecipient.match(
    /\b(?:saying|say|telling (?:them|him|her)|tell (?:them|him|her)|body(?: is)?|message(?: is)?|that says)\s+([\s\S]{2,})$/i,
  )?.[1];
  if (described?.trim()) {
    return described.trim().replace(/["”']+$/g, "").trim();
  }

  const inline = withoutRecipient
    .replace(
      /^.*?\b(?:just send|send exactly|send (?:it |this |that )?now|send (?:this |the )?exact(?: message| email| reply)?)\b/i,
      "",
    )
    .replace(/^\s*(?:an?\s+)?(?:email|mail|message|reply)\b/i, "")
    .replace(/\s+to\s*$/i, "")
    .trim();
  if (/^(?:it|this|that)(?:\s+now)?$/i.test(inline)) {
    return null;
  }
  return inline.length >= 2 ? inline : null;
}

export function directSendBodyMatches(message: string, body: string): boolean {
  const authorizedBody = authorizedDirectSendBody(message);
  const normalize = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return authorizedBody !== null && normalize(body) === normalize(authorizedBody);
}

export function authorizedDirectSendSubject(message: string): string {
  return (
    message.match(
      /\bsubject(?: is|:)?\s+["“']?([^"”'\n]{1,120})["”']?(?=\s+(?:and|with|saying|body|message|that says)\b|$)/i,
    )?.[1]?.trim() || "Quick note"
  );
}

function inboxPeriodFromMessage(
  message: string,
  lastInboxPeriod: InboxPeriod | null,
): InboxPeriod | null {
  const normalized = message.toLowerCase();
  const mentionsEmail = /\b(?:email|emails|mail|mails|inbox)\b/.test(normalized);
  if (/^(?:check|check again|double check|are you sure)[.!? ]*$/.test(normalized.trim())) {
    return lastInboxPeriod;
  }
  if (!mentionsEmail) {
    return null;
  }
  if (/\byesterday\b/.test(normalized)) {
    return "yesterday";
  }
  if (/\btoday\b|\bso far\b/.test(normalized)) {
    return "today";
  }
  return null;
}

function requestsLatestEmail(
  message: string,
  lastInboxPeriod: InboxPeriod | null,
): boolean {
  const normalized = message.toLowerCase().replace(/[’]/g, "'");
  const mentionsSingularEmail = /\b(?:email|mail|message|inbox)\b/.test(
    normalized,
  );
  const mentionsExplicitPeriod = /\b(?:today|yesterday|so far)\b/.test(
    normalized,
  );
  const explicitlyLatest =
    mentionsSingularEmail &&
    !mentionsExplicitPeriod &&
    /\b(?:last|latest|newest|most recent)\b/.test(normalized);
  const removesPreviousPeriod =
    lastInboxPeriod !== null &&
    /\b(?:(?:doesn't|doesnt|does not)\s+have\s+to\s+be|not\s+(?:just|only)|not\s+limited\s+to)\s+(?:today|yesterday)\b/.test(
      normalized,
    );

  return explicitlyLatest || removesPreviousPeriod;
}

function requestsOldestEmail(message: string): boolean {
  const normalized = message.toLowerCase();
  const mentionsSingularEmail = /\b(?:email|mail|message|inbox)\b/.test(
    normalized,
  );
  const mentionsExplicitPeriod = /\b(?:today|yesterday|so far)\b/.test(
    normalized,
  );

  return (
    mentionsSingularEmail &&
    !mentionsExplicitPeriod &&
    /\b(?:oldest|earliest|first)\b/.test(normalized)
  );
}

export function classifyAgentIntent(
  message: string,
  context: IntentContext,
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
  if (directSend && /\b(reply|respond)\b/.test(normalized)) {
    return { kind: "direct_reply" };
  }
  if (directSend && /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/.test(message)) {
    return { kind: "direct_new_email" };
  }
  if (directSend && context.hasActiveEmail) {
    return { kind: "direct_reply" };
  }

  if (
    /\b(?:read|open|show)(?: me)? (?:it|that|the email|the message)\b/.test(
      normalized,
    ) ||
    (/^(?:yes|yeah|yep|sure)(?: please)?[.! ]*$/.test(normalized) &&
      !context.hasPendingDraft &&
      context.presentedEmailCount === 1)
  ) {
    return { kind: "read_email" };
  }

  if (
    /\b(?:emailed|heard from|corresponded)\b.{0,50}\b(?:before|previously)\b/.test(
      normalized,
    ) ||
    /\b(?:they|he|she|this sender)\b.{0,30}\bemail(?:ed)?\b.{0,30}\b(?:before|previously)\b/.test(
      normalized,
    ) ||
    /\b(?:any|find|show)\s+(?:previous|earlier)\s+(?:email|emails|mail)\b/.test(
      normalized,
    )
  ) {
    return { kind: "email_history" };
  }
  if (/\b(?:find|search|look for)\b/.test(normalized) && /\b(?:email|mail)\b/.test(normalized)) {
    return { kind: "email_search" };
  }
  if (
    /\b(?:check|list|latest|recent|read|email|emails|mail|inbox)\b/.test(
      normalized,
    ) &&
    /\b(?:did|do|have|has|what|which|who|when|check|list|latest|recent|read)\b/.test(
      normalized,
    )
  ) {
    return { kind: "email_factual" };
  }

  return { kind: "other" };
}

export function forcedToolForIntent(intent: AgentIntent): ForcedAgentTool | null {
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
