// biome-ignore-all lint/suspicious/noUnusedExpressions: SQL tagged templates intentionally execute through the Durable Object SQL host.
import type { AgentSqlHost } from "@/agent/storage/sql";

const MAX_DRAFT_LENGTH = 20_000;
const MIN_DRAFT_LENGTH = 1;
const MAX_EMAIL_ADDRESS_LENGTH = 320;
const MAX_SUBJECT_LENGTH = 998;
const REPLY_SUBJECT_PATTERN = /^re:/i;
const HEADER_BREAK_PATTERN = /[\r\n]/;
const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class DeliveryOutcomeUnknownError extends Error {
  readonly code = "DELIVERY_OUTCOME_UNKNOWN";

  constructor(cause?: unknown) {
    super(
      "Email delivery could not be confirmed. The draft is locked to prevent a duplicate send.",
      cause === undefined ? undefined : { cause }
    );
    this.name = "DeliveryOutcomeUnknownError";
  }
}

export function isDeliveryOutcomeUnknown(
  error: unknown
): error is DeliveryOutcomeUnknownError {
  return (
    error instanceof DeliveryOutcomeUnknownError ||
    (error instanceof Error &&
      error.message ===
        "Email delivery could not be confirmed. The draft is locked to prevent a duplicate send.")
  );
}

export function markReplyDraftDeliveryUnknown(
  host: AgentSqlHost,
  draftId: string,
  now = Date.now()
): void {
  host.sql`
    UPDATE drafts
    SET status = 'delivery_unknown', updated_at = ${now}
    WHERE id = ${draftId} AND status = 'sending'
  `;
}

export function markNewEmailDeliveryUnknown(
  host: AgentSqlHost,
  draftId: string,
  now = Date.now()
): void {
  host.sql`
    UPDATE new_email_drafts
    SET status = 'delivery_unknown', updated_at = ${now}
    WHERE id = ${draftId} AND status = 'sending'
  `;
}

export type DraftRow = {
  id: string;
  email_id: string;
  body: string;
  revision: number;
  status: string;
};

export type NewEmailDraftRow = {
  id: string;
  from_address: string;
  recipient: string;
  subject: string;
  body: string;
  revision: number;
  status: string;
};

export function subjectForReply(subject: string): string {
  return REPLY_SUBJECT_PATTERN.test(subject) ? subject : `Re: ${subject}`;
}

export function normalizeEmailAddress(address: string): string {
  const normalized = address.trim();
  if (
    normalized.length < 3 ||
    normalized.length > MAX_EMAIL_ADDRESS_LENGTH ||
    HEADER_BREAK_PATTERN.test(normalized) ||
    !EMAIL_ADDRESS_PATTERN.test(normalized)
  ) {
    throw new Error("A valid recipient email address is required.");
  }

  return normalized;
}

export function normalizeSubject(subject: string): string {
  const normalized = subject.trim();
  if (
    normalized.length < 1 ||
    normalized.length > MAX_SUBJECT_LENGTH ||
    HEADER_BREAK_PATTERN.test(normalized)
  ) {
    throw new Error(
      `Subjects must be between 1 and ${MAX_SUBJECT_LENGTH} characters.`
    );
  }

  return normalized;
}

export function normalizeDraftBody(body: string): string {
  const trimmedBody = body.trim();
  if (
    trimmedBody.length < MIN_DRAFT_LENGTH ||
    trimmedBody.length > MAX_DRAFT_LENGTH
  ) {
    throw new Error(
      `Drafts must be between ${MIN_DRAFT_LENGTH} and ${MAX_DRAFT_LENGTH} characters.`
    );
  }

  return trimmedBody;
}
