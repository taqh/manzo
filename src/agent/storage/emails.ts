import type { AgentSqlHost } from "@/agent/storage/sql";
import type {
  InboxPeriod,
  InboxPeriodSummary,
  StoredEmail,
  StoredEmailSummary,
} from "@/agent/types";

const MAX_SEARCH_QUERY_LENGTH = 200;

export type EmailRow = {
  id: string;
  short_id: string;
  mailbox: string;
  sender: string;
  sender_name: string | null;
  reply_to: string;
  subject: string;
  message_id: string | null;
  sent_at: string | null;
  text_body: string;
  html_body: string | null;
  raw_key: string;
  raw_size: number;
  attachment_count: number;
  is_auto_reply: number;
  received_at: number;
  read_at: number | null;
  notification_status: string;
};

function safeEmailLimit(limit: number): number {
  return Math.max(1, Math.min(20, Math.trunc(limit)));
}

export function toStoredEmail(row: EmailRow): StoredEmail {
  return {
    id: row.id,
    shortId: row.short_id,
    mailbox: row.mailbox,
    sender: row.sender,
    senderName: row.sender_name,
    replyTo: row.reply_to,
    subject: row.subject,
    messageId: row.message_id,
    sentAt: row.sent_at,
    textBody: row.text_body,
    htmlBody: row.html_body,
    rawKey: row.raw_key,
    rawSize: row.raw_size,
    attachmentCount: row.attachment_count,
    isAutoReply: row.is_auto_reply === 1,
    receivedAt: row.received_at,
    readAt: row.read_at,
    notificationStatus: row.notification_status,
  };
}

function toStoredEmailSummary(row: EmailRow): StoredEmailSummary {
  const email = toStoredEmail(row);

  return {
    id: email.id,
    shortId: email.shortId,
    mailbox: email.mailbox,
    sender: email.sender,
    senderName: email.senderName,
    subject: email.subject,
    receivedAt: email.receivedAt,
    attachmentCount: email.attachmentCount,
    readAt: email.readAt,
    notificationStatus: email.notificationStatus,
  };
}

export function findStoredEmailRow(
  host: AgentSqlHost,
  emailReference: string,
): EmailRow | null {
  const rows = host.sql<EmailRow>`
    SELECT *
    FROM emails
    WHERE id = ${emailReference} OR short_id = ${emailReference}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

export function findStoredEmail(
  host: AgentSqlHost,
  emailReference: string,
): StoredEmail | null {
  const row = findStoredEmailRow(host, emailReference);
  return row ? toStoredEmail(row) : null;
}

export function listStoredEmails(
  host: AgentSqlHost,
  limit = 10,
): StoredEmailSummary[] {
  const rows = host.sql<EmailRow>`
    SELECT *
    FROM emails
    ORDER BY received_at DESC
    LIMIT ${safeEmailLimit(limit)}
  `;

  return rows.map(toStoredEmailSummary);
}

export function findOldestStoredEmail(
  host: AgentSqlHost,
): StoredEmailSummary | null {
  const rows = host.sql<EmailRow>`
    SELECT *
    FROM emails
    ORDER BY received_at ASC, id ASC
    LIMIT 1
  `;

  return rows[0] ? toStoredEmailSummary(rows[0]) : null;
}

type EmailRangeCountRow = {
  count: number;
  unread_count: number;
};

export function summarizeStoredEmailsInRange(
  host: AgentSqlHost,
  period: InboxPeriod,
  startAt: number,
  endAt: number,
  limit = 20,
): InboxPeriodSummary {
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || startAt >= endAt) {
    throw new Error("A valid email date range is required.");
  }

  const counts = host.sql<EmailRangeCountRow>`
    SELECT
      COUNT(*) AS count,
      COALESCE(SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END), 0) AS unread_count
    FROM emails
    WHERE received_at >= ${Math.trunc(startAt)} AND received_at < ${Math.trunc(endAt)}
  `;
  const rows = host.sql<EmailRow>`
    SELECT *
    FROM emails
    WHERE received_at >= ${Math.trunc(startAt)} AND received_at < ${Math.trunc(endAt)}
    ORDER BY received_at DESC
    LIMIT ${safeEmailLimit(limit)}
  `;

  return {
    period,
    startAt,
    endAt,
    count: Number(counts[0]?.count ?? 0),
    unreadCount: Number(counts[0]?.unread_count ?? 0),
    emails: rows.map(toStoredEmailSummary),
  };
}

export function searchStoredEmails(
  host: AgentSqlHost,
  query: string,
  limit = 10,
): StoredEmailSummary[] {
  const trimmedQuery = query.trim();
  if (
    trimmedQuery.length < 1 ||
    trimmedQuery.length > MAX_SEARCH_QUERY_LENGTH
  ) {
    throw new Error(
      `Email searches must be between 1 and ${MAX_SEARCH_QUERY_LENGTH} characters.`,
    );
  }

  const pattern = `%${trimmedQuery}%`;
  const rows = host.sql<EmailRow>`
    SELECT *
    FROM emails
    WHERE
      sender LIKE ${pattern}
      OR COALESCE(sender_name, '') LIKE ${pattern}
      OR subject LIKE ${pattern}
      OR text_body LIKE ${pattern}
    ORDER BY received_at DESC
    LIMIT ${safeEmailLimit(limit)}
  `;

  return rows.map(toStoredEmailSummary);
}

export function findPreviousStoredEmails(
  host: AgentSqlHost,
  sender: string,
  excludeEmailReference = "",
  limit = 10,
): StoredEmailSummary[] {
  const normalizedSender = sender.trim().toLowerCase();
  if (!normalizedSender || normalizedSender.length > 320) {
    throw new Error("A valid sender address is required.");
  }

  const excludedId = excludeEmailReference
    ? findStoredEmailRow(host, excludeEmailReference)?.id ?? excludeEmailReference
    : "";
  const rows = host.sql<EmailRow>`
    SELECT *
    FROM emails
    WHERE lower(sender) = ${normalizedSender} AND id <> ${excludedId}
    ORDER BY received_at DESC
    LIMIT ${safeEmailLimit(limit)}
  `;

  return rows.map(toStoredEmailSummary);
}
