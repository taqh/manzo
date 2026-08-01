import type { Address, Email, Mailbox } from "postal-mime";

const MAX_BODY_LENGTH = 250_000;
const MAX_SUBJECT_LENGTH = 998;
const QUOTED_REPLY_MARKERS = [
  /^On .+wrote:\s*$/i,
  /^On .+at .+wrote:\s*$/i,
  /^-{2,}\s*(?:Original Message|Forwarded message)\s*-{2,}$/i,
  /^Begin forwarded message:\s*$/i,
  /^_{5,}\s*$/,
];

export type NormalizedEmail = {
  sender: string;
  senderName: string | null;
  replyTo: string;
  subject: string;
  messageId: string | null;
  sentAt: string | null;
  referenceIds: string | null;
  textBody: string;
  htmlBody: string | null;
  attachmentCount: number;
};

function firstMailbox(address: Address | undefined): Mailbox | undefined {
  if (!address) {
    return;
  }

  if ("address" in address && address.address) {
    return address;
  }

  return address.group?.[0];
}

function clip(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}\n\n[Content truncated; the full email is preserved in R2.]`;
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

const OUTLOOK_FROM_HEADER_PATTERN = /^From:\s+\S/i;
const OUTLOOK_SENT_OR_DATE_PATTERN = /^(?:Sent|Date):\s+/im;
const OUTLOOK_TO_HEADER_PATTERN = /^To:\s+/im;
const OUTLOOK_SUBJECT_HEADER_PATTERN = /^Subject:\s+/im;
const QUOTED_LINE_PATTERN = /^>/;

function startsOutlookHeader(lines: string[], index: number): boolean {
  if (!OUTLOOK_FROM_HEADER_PATTERN.test(lines[index] ?? "")) {
    return false;
  }

  const following = lines.slice(index + 1, index + 6).join("\n");
  return (
    OUTLOOK_SENT_OR_DATE_PATTERN.test(following) &&
    OUTLOOK_TO_HEADER_PATTERN.test(following) &&
    OUTLOOK_SUBJECT_HEADER_PATTERN.test(following)
  );
}

/**
 * Returns only the newly written part of a reply. Quoted history remains in the
 * normalized body and raw R2 object, but is hidden from routine chat previews.
 */
export function extractLatestEmailContent(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let end = lines.length;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    const isQuotedLine = QUOTED_LINE_PATTERN.test(line);
    const isReplyMarker = QUOTED_REPLY_MARKERS.some((marker) =>
      marker.test(line)
    );

    if (
      index > 0 &&
      (isQuotedLine || isReplyMarker || startsOutlookHeader(lines, index))
    ) {
      end = index;
      break;
    }
  }

  const latest = lines
    .slice(0, end)
    .join("\n")
    .replace(/\n[ \t]+\n/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return latest || "[No new readable text before the quoted thread.]";
}

export function normalizeEmail(
  parsed: Email,
  envelopeFrom: string
): NormalizedEmail {
  const from = firstMailbox(parsed.from);
  const replyTo = firstMailbox(parsed.replyTo?.[0]);
  const htmlBody = parsed.html ? clip(parsed.html, MAX_BODY_LENGTH) : null;
  const textBody = clip(
    parsed.text?.trim() ||
      (parsed.html ? htmlToPlainText(parsed.html) : "") ||
      "[This email has no readable text body.]",
    MAX_BODY_LENGTH
  );

  return {
    attachmentCount: parsed.attachments.length,
    htmlBody,
    messageId: parsed.messageId || null,
    referenceIds: parsed.references || null,
    replyTo: replyTo?.address || from?.address || envelopeFrom,
    sender: from?.address || envelopeFrom,
    senderName: from?.name?.trim() || null,
    sentAt: parsed.date || null,
    subject:
      parsed.subject?.trim().slice(0, MAX_SUBJECT_LENGTH) || "(no subject)",
    textBody,
  };
}

export function emailPreview(text: string, limit = 360): string {
  const compact = extractLatestEmailContent(text).replace(/\s+/g, " ").trim();

  if (compact.length <= limit) {
    return compact;
  }

  return `${compact.slice(0, limit - 1)}…`;
}
