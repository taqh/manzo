import type { Attachment as ParsedAttachment } from "postal-mime";

export type NormalizedAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  disposition: "attachment" | "inline" | null;
  contentId: string | null;
  content: Uint8Array;
};

const UNSAFE_FILENAME_CHARACTERS_PATTERN = /[\\/\x00-\x1f]+/g;
const LEADING_DOTS_PATTERN = /^\.+/;

export function sanitizeAttachmentFilename(
  filename: string | null | undefined,
  fallback = "attachment"
): string {
  const normalized = filename
    ?.trim()
    .replace(UNSAFE_FILENAME_CHARACTERS_PATTERN, "_")
    .replace(LEADING_DOTS_PATTERN, "");
  return normalized?.slice(0, 240) || fallback;
}

function safeFilename(filename: string | null, index: number): string {
  const fallback = `attachment-${index + 1}`;
  return sanitizeAttachmentFilename(filename, fallback);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function attachmentBytes(attachment: ParsedAttachment): Uint8Array {
  if (attachment.content instanceof Uint8Array) {
    return attachment.content;
  }

  if (attachment.content instanceof ArrayBuffer) {
    return new Uint8Array(attachment.content);
  }

  if (attachment.encoding === "base64") {
    return decodeBase64(attachment.content);
  }

  return new TextEncoder().encode(attachment.content);
}

export function normalizeAttachments(
  emailId: string,
  attachments: ParsedAttachment[]
): NormalizedAttachment[] {
  return attachments.map((attachment, index) => ({
    content: attachmentBytes(attachment),
    contentId: attachment.contentId ?? null,
    disposition: attachment.disposition ?? null,
    filename: safeFilename(attachment.filename, index),
    id: `${emailId}-attachment-${index + 1}`,
    mimeType: attachment.mimeType || "application/octet-stream",
  }));
}

export function attachmentR2Key(emailId: string, attachmentId: string): string {
  return `emails/${emailId}/attachments/${attachmentId}`;
}
