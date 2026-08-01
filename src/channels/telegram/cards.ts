import { Actions, Button, Card, type CardElement, CardText } from "chat";
import type {
  DraftResult,
  PendingDraft,
  StoredEmail,
  StoredEmailSummary,
} from "@/agent/types";
import { emailPreview, extractLatestEmailContent } from "@/email/normalize";

const CHAT_MESSAGE_LIMIT = 3500;
const REPLY_SUBJECT_PATTERN = /^(?:(?:re|fw|fwd):\s*)+/i;
const SENDER_LOCAL_PART_PATTERN = /[._-]+/g;

// Keep these IDs short: Telegram limits encoded callback payloads to 64 bytes.
export const ACTION_READ_EMAIL = "r";
export const ACTION_DRAFT_EMAIL = "d";
export const ACTION_SEND_DRAFT = "s";
export const ACTION_SHOW_ATTACHMENTS = "a";

function clipForChat(value: string, limit = CHAT_MESSAGE_LIMIT): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit - 1)}…`;
}

function friendlySender(
  email: Pick<StoredEmailSummary, "sender" | "senderName">
): string {
  return (
    email.senderName?.trim() ||
    email.sender.split("@")[0]?.replace(SENDER_LOCAL_PART_PATTERN, " ") ||
    email.sender
  );
}

function cleanSubject(subject: string): string {
  return subject.replace(REPLY_SUBJECT_PATTERN, "").trim() || "no subject";
}

function quoteForChat(value: string): string {
  return value
    .split("\n")
    .map((line) => `> ${line || " "}`)
    .join("\n");
}

export function formatEmail(email: StoredEmail): string {
  const sender = email.senderName
    ? `${email.senderName} <${email.sender}>`
    : email.sender;
  const latestContent = extractLatestEmailContent(email.textBody);
  const quotedHistoryHidden =
    latestContent.trim() === email.textBody.trim()
      ? ""
      : "\n\n_Quoted reply history hidden._";
  const attachments =
    email.attachmentCount > 0
      ? `\n\nAttachments: ${email.attachmentCount} (available to share)`
      : "";

  return clipForChat(
    [
      `**${sender}**`,
      `_${email.subject}_`,
      "",
      quoteForChat(latestContent),
      attachments,
      quotedHistoryHidden,
      "",
      `Received at ${email.mailbox} · ID ${email.shortId}`,
    ]
      .filter((line) => line !== "")
      .join("\n")
  );
}

export function formatEmailList(emails: StoredEmailSummary[]): string {
  if (emails.length === 0) {
    return "No emails have arrived yet.";
  }

  return emails
    .map((email) => {
      const unread = email.readAt === null ? "●" : "○";
      const sender = friendlySender(email);
      return `${unread} ${sender} — ${email.subject} · ${email.shortId}`;
    })
    .join("\n");
}

export function draftCard(draft: DraftResult): CardElement {
  const attachmentText =
    draft.attachments.length > 0
      ? [
          "",
          `Attachments (${draft.attachments.length}):`,
          ...draft.attachments.map((attachment) => `• ${attachment.filename}`),
        ].join("\n")
      : "";

  return Card({
    children: [
      CardText(
        [
          `From: ${draft.from}`,
          `To: ${draft.recipient}`,
          `Subject: ${draft.subject}`,
          "",
          draft.body,
          attachmentText,
          "",
          "Nothing has been sent. Check it carefully first.",
        ].join("\n")
      ),
      Actions([
        Button({
          id: ACTION_SEND_DRAFT,
          label:
            draft.kind === "new"
              ? "Send this exact email"
              : "Send this exact reply",
          style: "primary",
          value: `${draft.draftId}:${draft.revision}`,
        }),
      ]),
    ],
    title:
      draft.kind === "new"
        ? `New email draft to ${draft.recipient}`
        : `Draft reply to ${draft.recipient}`,
  });
}

export function toPendingDraft(draft: DraftResult): PendingDraft {
  return {
    displayedAt: Date.now(),
    draftId: draft.draftId,
    from: draft.from,
    kind: draft.kind,
    recipient: draft.recipient,
    revision: draft.revision,
    subject: draft.subject,
  };
}

export function notificationCard(email: StoredEmail): CardElement {
  const sender = friendlySender(email);
  const isReply = REPLY_SUBJECT_PATTERN.test(email.subject);
  const title = clipForChat(
    `${sender} ${isReply ? "replied about" : "emailed you about"} “${cleanSubject(email.subject)}”`,
    100
  );
  const attachmentText =
    email.attachmentCount > 0
      ? `\n\nThey included ${email.attachmentCount} attachment${email.attachmentCount === 1 ? "" : "s"}.`
      : "";
  const actions = [
    Button({
      id: ACTION_READ_EMAIL,
      label: "Open",
      value: email.shortId,
    }),
    Button({
      id: ACTION_DRAFT_EMAIL,
      label: "Draft reply",
      value: email.shortId,
    }),
  ];
  if (email.attachmentCount > 0) {
    actions.push(
      Button({
        id: ACTION_SHOW_ATTACHMENTS,
        label: "Show attachments",
        value: email.shortId,
      })
    );
  }

  return Card({
    children: [
      CardText(
        [
          "Here’s the new bit:",
          "",
          quoteForChat(emailPreview(email.textBody, 500)),
          attachmentText,
        ]
          .filter((line) => line !== "")
          .join("\n")
      ),
      Actions(actions),
    ],
    title,
  });
}
