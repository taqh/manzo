const MESSAGE_ID_PATTERN = /^<[^<>\r\n]+>$/;

export type OutboundEmailInput = {
  attachments?: EmailAttachment[];
  from: { email: string; name?: string };
  inReplyTo?: string | null;
  replyTo?: string;
  subject: string;
  text: string;
  to: string;
};

export function formatEmailAddress(
  email: string,
  name?: string | null
): string {
  const trimmedName = name?.trim();
  return trimmedName ? `${trimmedName} <${email}>` : email;
}

export function normalizeMessageId(
  messageId: string | null | undefined
): string | null {
  const normalized = messageId?.trim() ?? "";
  return normalized && MESSAGE_ID_PATTERN.test(normalized) ? normalized : null;
}

export function buildOutboundEmailMessage(
  input: OutboundEmailInput
): EmailMessageBuilder {
  const messageId = normalizeMessageId(input.inReplyTo);
  const name = input.from.name?.trim();
  const from: string | EmailAddress = name
    ? { email: input.from.email, name }
    : input.from.email;
  return {
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    from,
    ...(messageId ? { headers: { "In-Reply-To": messageId } } : {}),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    subject: input.subject,
    text: input.text,
    to: input.to,
  };
}
