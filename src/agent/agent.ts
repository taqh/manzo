// biome-ignore-all lint/suspicious/noUnusedExpressions: SQL tagged templates intentionally execute through the Durable Object SQL host.
import { Agent } from "agents";
import { type AgentEmail, isAutoReplyEmail } from "agents/email";
import PostalMime from "postal-mime";
import { runPersonalAgent } from "@/agent/ai";
import { getDeploymentConfig, isManagedMailbox } from "@/agent/config";
import {
  insertStoredAttachments,
  listStoredAttachmentRows,
  listStoredAttachments,
} from "@/agent/storage/attachments";
import {
  clearStoredConversation,
  listStoredConversationMessages,
  saveStoredConversationTurn,
} from "@/agent/storage/conversations";
import {
  DeliveryOutcomeUnknownError,
  type DraftRow,
  markNewEmailDeliveryUnknown,
  markReplyDraftDeliveryUnknown,
  type NewEmailDraftRow,
  normalizeDraftBody,
  normalizeEmailAddress,
  normalizeSubject,
  subjectForReply,
} from "@/agent/storage/drafts";
import {
  type EmailRow,
  findOldestStoredEmail,
  findPreviousStoredEmails,
  findStoredEmail,
  findStoredEmailRow,
  listStoredEmails,
  searchStoredEmails,
  summarizeStoredEmailsInRange,
  toStoredEmail,
} from "@/agent/storage/emails";
import {
  clearStoredMemories,
  forgetStoredMemory,
  listStoredMemories,
  rememberStoredMemory,
} from "@/agent/storage/memories";
import {
  insertOutboundAttachments,
  linkAttachmentsToDraft,
  listDraftAttachmentRows,
  listOutboundAttachments,
} from "@/agent/storage/outbound-attachments";
import { getStoredProfile, updateStoredProfile } from "@/agent/storage/profile";
import { initializeAgentSchema } from "@/agent/storage/schema";
import { DEFAULT_TIME_ZONE, inboxPeriodRange } from "@/agent/time";
import type {
  AgentChatResponse,
  AgentEnvironment,
  AgentMessageInput,
  ConversationMessage,
  InboxPeriod,
  InboxPeriodSummary,
  NewEmailDraftResult,
  OutgoingEmailAttachment,
  OwnerProfile,
  OwnerProfileUpdate,
  PersonalMemory,
  ReplyDraftResult,
  SentDraftResult,
  StoredEmail,
  StoredEmailAttachment,
  StoredEmailSummary,
  StoredOutboundAttachment,
  UploadedTelegramAttachment,
} from "@/agent/types";
import {
  createPersonalChat,
  handleTelegramWebhook,
  notifyAboutEmail,
  type PersonalChat,
} from "@/channels/telegram";
import {
  attachmentR2Key,
  normalizeAttachments,
  sanitizeAttachmentFilename,
} from "@/email/attachments";
import { normalizeEmail } from "@/email/normalize";

type InboxAgentState = {
  emailCount: number;
  unreadCount: number;
  lastEmailId: string | null;
  lastReceivedAt: number | null;
};
async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export class InboxAgent extends Agent<AgentEnvironment, InboxAgentState> {
  private chat: PersonalChat | null = null;

  initialState: InboxAgentState = {
    emailCount: 0,
    lastEmailId: null,
    lastReceivedAt: null,
    unreadCount: 0,
  };

  onStart(): void {
    initializeAgentSchema(this);
    this.chat = createPersonalChat(this.env, this);
  }

  async onEmail(email: AgentEmail): Promise<void> {
    if (!isManagedMailbox(this.env, email.to)) {
      email.setReject("Inbox address is not configured");
      return;
    }

    const raw = await email.getRaw();
    const id = await sha256Hex(raw);
    const shortId = id.slice(0, 16);
    const rawKey = `emails/${id}.eml`;
    const receivedAt = Date.now();

    await this.env.MAIL_BUCKET.put(rawKey, raw, {
      customMetadata: {
        emailId: shortId,
        mailbox: email.to.toLowerCase(),
      },
      httpMetadata: { contentType: "message/rfc822" },
    });

    const parsed = await PostalMime.parse(raw, {
      maxHeadersSize: 256 * 1024,
      maxNestingDepth: 64,
    });
    const attachments = normalizeAttachments(id, parsed.attachments);
    await this.persistAttachmentObjects(id, shortId, attachments);
    const normalized = normalizeEmail(parsed, email.from);
    const autoReply = isAutoReplyEmail(parsed.headers);

    const inserted = this.sql<{ id: string }>`
      INSERT INTO emails (
        id,
        short_id,
        mailbox,
        sender,
        sender_name,
        reply_to,
        subject,
        message_id,
        sent_at,
        reference_ids,
        text_body,
        html_body,
        raw_key,
        raw_size,
        attachment_count,
        is_auto_reply,
        received_at
      )
      VALUES (
        ${id},
        ${shortId},
        ${email.to.toLowerCase()},
        ${normalized.sender},
        ${normalized.senderName},
        ${normalized.replyTo},
        ${normalized.subject},
        ${normalized.messageId},
        ${normalized.sentAt},
        ${normalized.referenceIds},
        ${normalized.textBody},
        ${normalized.htmlBody},
        ${rawKey},
        ${email.rawSize},
        ${attachments.length},
        ${autoReply ? 1 : 0},
        ${receivedAt}
      )
      ON CONFLICT(id) DO NOTHING
      RETURNING id
    `;

    if (inserted.length === 0) {
      console.log(
        JSON.stringify({
          emailId: shortId,
          event: "email.duplicate_ignored",
        })
      );
      return;
    }

    insertStoredAttachments(
      this,
      attachments.map((attachment) => ({
        contentId: attachment.contentId,
        disposition: attachment.disposition,
        emailId: id,
        filename: attachment.filename,
        id: attachment.id,
        mimeType: attachment.mimeType,
        r2Key: attachmentR2Key(id, attachment.id),
        size: attachment.content.byteLength,
      }))
    );

    this.setState({
      emailCount: this.state.emailCount + 1,
      lastEmailId: shortId,
      lastReceivedAt: receivedAt,
      unreadCount: this.state.unreadCount + 1,
    });

    const storedEmail = this.findEmail(shortId);
    if (!storedEmail) {
      throw new Error("Email was inserted but could not be read back.");
    }

    const notificationStatus = await notifyAboutEmail(
      this.chat,
      this.env,
      storedEmail
    );
    this.sql`
      UPDATE emails
      SET notification_status = ${notificationStatus}
      WHERE id = ${id}
    `;

    console.log(
      JSON.stringify({
        attachmentCount: attachments.length,
        emailId: shortId,
        event: "email.received",
        mailbox: email.to.toLowerCase(),
        notificationStatus,
        rawSize: email.rawSize,
      })
    );
  }

  listEmails(limit = 10): StoredEmailSummary[] {
    return listStoredEmails(this, limit);
  }

  getOldestEmail(): StoredEmailSummary | null {
    return findOldestStoredEmail(this);
  }

  getInboxSummary(period: InboxPeriod): InboxPeriodSummary {
    const timeZone = this.getProfile().timeZone ?? DEFAULT_TIME_ZONE;
    const range = inboxPeriodRange(period, Date.now(), timeZone);
    return {
      ...summarizeStoredEmailsInRange(this, period, range.startAt, range.endAt),
      timeZone,
    };
  }

  searchEmails(query: string, limit = 10): StoredEmailSummary[] {
    return searchStoredEmails(this, query, limit);
  }

  findPreviousEmailsFrom(
    sender: string,
    excludeEmailReference = "",
    limit = 10
  ): StoredEmailSummary[] {
    return findPreviousStoredEmails(this, sender, excludeEmailReference, limit);
  }

  readEmail(emailReference: string): StoredEmail | null {
    const row = this.findEmailRow(emailReference);
    if (!row) {
      return null;
    }

    if (row.read_at === null) {
      const readAt = Date.now();
      const updated = this.sql<{ id: string }>`
        UPDATE emails
        SET read_at = ${readAt}
        WHERE id = ${row.id} AND read_at IS NULL
        RETURNING id
      `;

      if (updated.length > 0) {
        this.setState({
          ...this.state,
          unreadCount: Math.max(0, this.state.unreadCount - 1),
        });
        row.read_at = readAt;
      }
    }

    return toStoredEmail(row);
  }

  listEmailAttachments(emailReference: string): StoredEmailAttachment[] {
    return listStoredAttachments(this, emailReference);
  }

  async storeTelegramAttachments(
    conversationId: string,
    uploads: UploadedTelegramAttachment[]
  ): Promise<StoredOutboundAttachment[]> {
    const stored = uploads.map((upload) => {
      const id = `tg_${crypto.randomUUID()}`;
      return {
        conversationId,
        data: upload.data,
        filename: sanitizeAttachmentFilename(upload.filename, "upload"),
        id,
        mimeType: upload.mimeType || "application/octet-stream",
        r2Key: `outbound-attachments/${id}`,
        size: upload.data.byteLength,
      };
    });

    for (const attachment of stored) {
      await this.env.MAIL_BUCKET.put(attachment.r2Key, attachment.data, {
        customMetadata: {
          attachmentId: attachment.id,
          conversationId,
          filename: attachment.filename,
        },
        httpMetadata: { contentType: attachment.mimeType },
      });
    }

    insertOutboundAttachments(
      this,
      stored.map(({ data: _data, r2Key, ...attachment }) => ({
        ...attachment,
        r2Key,
      }))
    );
    return stored.map(
      ({ data: _data, r2Key: _r2Key, ...attachment }) => attachment
    );
  }

  listUploadedAttachments(attachmentIds: string[]): StoredOutboundAttachment[] {
    return listOutboundAttachments(this, attachmentIds);
  }

  async getEmailAttachments(
    emailReference: string,
    attachmentIds?: string[]
  ): Promise<OutgoingEmailAttachment[]> {
    const email = this.findEmail(emailReference);
    if (!email) {
      throw new Error(`Email ${emailReference} was not found.`);
    }
    const rows = listStoredAttachmentRows(this, email.id);

    const requested = attachmentIds?.length ? new Set(attachmentIds) : null;
    const selected = requested
      ? rows.filter((row) => requested.has(row.id))
      : rows;

    if (requested && selected.length !== requested.size) {
      throw new Error("One or more requested attachments were not found.");
    }

    const attachments: OutgoingEmailAttachment[] = [];
    for (const row of selected) {
      const object = await this.env.MAIL_BUCKET.get(row.r2_key);
      if (!object) {
        throw new Error(`Attachment ${row.filename} is missing from R2.`);
      }
      attachments.push({
        contentId: row.contentId,
        data: await object.arrayBuffer(),
        disposition: row.disposition,
        emailId: row.emailId,
        filename: row.filename,
        id: row.id,
        mimeType: row.mimeType,
        size: row.size,
      });
    }
    return attachments;
  }

  private async persistAttachmentObjects(
    emailId: string,
    emailShortId: string,
    attachments: ReturnType<typeof normalizeAttachments>
  ): Promise<void> {
    for (const attachment of attachments) {
      await this.env.MAIL_BUCKET.put(
        attachmentR2Key(emailId, attachment.id),
        attachment.content,
        {
          customMetadata: {
            attachmentId: attachment.id,
            emailId: emailShortId,
            filename: attachment.filename,
          },
          httpMetadata: { contentType: attachment.mimeType },
        }
      );
    }
  }

  listMemories(): PersonalMemory[] {
    return listStoredMemories(this);
  }

  remember(key: string, value: string): PersonalMemory {
    return rememberStoredMemory(this, key, value);
  }

  forgetMemory(key: string): boolean {
    return forgetStoredMemory(this, key);
  }

  clearMemories(): number {
    return clearStoredMemories(this);
  }

  getProfile(): OwnerProfile {
    return getStoredProfile(this);
  }

  updateProfile(update: OwnerProfileUpdate): OwnerProfile {
    return updateStoredProfile(this, update);
  }

  listConversationMessages(
    conversationId: string,
    limit = 24
  ): ConversationMessage[] {
    return listStoredConversationMessages(this, conversationId, limit);
  }

  saveConversationTurn(
    conversationId: string,
    userMessage: string,
    assistantMessage: string
  ): void {
    saveStoredConversationTurn(
      this,
      conversationId,
      userMessage,
      assistantMessage
    );
  }

  resetConversation(conversationId: string): void {
    clearStoredConversation(this, conversationId);
  }

  respondToChat(input: AgentMessageInput): Promise<AgentChatResponse> {
    return runPersonalAgent(this.env, this, input);
  }

  createDraft(
    emailReference: string,
    body: string,
    attachmentIds: string[] = []
  ): ReplyDraftResult {
    const trimmedBody = normalizeDraftBody(body);

    const email = this.findEmail(emailReference);
    if (!email) {
      throw new Error(`Email ${emailReference} was not found.`);
    }

    const draftId = crypto.randomUUID();
    const revision = 1;
    const now = Date.now();
    const attachments = this.resolveOutboundAttachments(attachmentIds);

    this.sql`
      INSERT INTO drafts (
        id,
        email_id,
        body,
        revision,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${draftId},
        ${email.id},
        ${trimmedBody},
        ${revision},
        'draft',
        ${now},
        ${now}
      )
    `;
    linkAttachmentsToDraft(
      this,
      draftId,
      attachments.map((attachment) => attachment.id)
    );

    return {
      attachments,
      body: trimmedBody,
      draftId,
      emailShortId: email.shortId,
      from: email.mailbox,
      kind: "reply",
      recipient: email.replyTo,
      revision,
      subject: subjectForReply(email.subject),
    };
  }

  createNewEmailDraft(
    recipient: string,
    subject: string,
    body: string,
    attachmentIds: string[] = []
  ): NewEmailDraftResult {
    const normalizedRecipient = normalizeEmailAddress(recipient);
    const normalizedSubject = normalizeSubject(subject);
    const trimmedBody = normalizeDraftBody(body);

    const { defaultOutboundMailbox } = getDeploymentConfig(this.env);
    const draftId = `n_${crypto.randomUUID()}`;
    const revision = 1;
    const now = Date.now();
    const attachments = this.resolveOutboundAttachments(attachmentIds);

    this.sql`
      INSERT INTO new_email_drafts (
        id,
        from_address,
        recipient,
        subject,
        body,
        revision,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${draftId},
        ${defaultOutboundMailbox},
        ${normalizedRecipient},
        ${normalizedSubject},
        ${trimmedBody},
        ${revision},
        'draft',
        ${now},
        ${now}
      )
    `;
    linkAttachmentsToDraft(
      this,
      draftId,
      attachments.map((attachment) => attachment.id)
    );

    return {
      attachments,
      body: trimmedBody,
      draftId,
      from: defaultOutboundMailbox,
      kind: "new",
      recipient: normalizedRecipient,
      revision,
      subject: normalizedSubject,
    };
  }

  sendDraft(
    draftId: string,
    expectedRevision: number
  ): Promise<SentDraftResult> {
    const claimed = this.sql<DraftRow>`
      UPDATE drafts
      SET status = 'sending', updated_at = ${Date.now()}
      WHERE
        id = ${draftId}
        AND revision = ${expectedRevision}
        AND status = 'draft'
      RETURNING id, email_id, body, revision, status
    `;

    const [draft] = claimed;
    if (draft) {
      return this.sendReplyDraft(draft);
    }

    const claimedNewEmail = this.sql<NewEmailDraftRow>`
      UPDATE new_email_drafts
      SET status = 'sending', updated_at = ${Date.now()}
      WHERE
        id = ${draftId}
        AND revision = ${expectedRevision}
        AND status = 'draft'
      RETURNING
        id,
        from_address,
        recipient,
        subject,
        body,
        revision,
        status
    `;
    const [newEmailDraft] = claimedNewEmail;
    if (newEmailDraft) {
      return this.sendNewEmailDraft(newEmailDraft);
    }

    throw new Error(
      "This draft was changed, already sent, or is no longer available."
    );
  }

  handleTelegramWebhook(request: Request): Promise<Response> {
    return handleTelegramWebhook(this.chat, request, (task) => {
      this.ctx.waitUntil(task);
    });
  }

  private findEmail(emailReference: string): StoredEmail | null {
    return findStoredEmail(this, emailReference);
  }

  private findEmailRow(emailReference: string): EmailRow | null {
    return findStoredEmailRow(this, emailReference);
  }

  private resolveOutboundAttachments(
    attachmentIds: string[]
  ): StoredOutboundAttachment[] {
    if (attachmentIds.length === 0) {
      return [];
    }

    const attachments = listOutboundAttachments(this, attachmentIds);
    if (attachments.length !== attachmentIds.length) {
      throw new Error("One or more uploaded attachments were not found.");
    }
    return attachments;
  }

  private async loadDraftEmailAttachments(
    draftId: string
  ): Promise<EmailAttachment[]> {
    const rows = listDraftAttachmentRows(this, draftId);
    const attachments: EmailAttachment[] = [];
    for (const row of rows) {
      const object = await this.env.MAIL_BUCKET.get(row.r2_key);
      if (!object) {
        throw new Error(
          `Uploaded attachment ${row.filename} is missing from R2.`
        );
      }
      attachments.push({
        content: await object.arrayBuffer(),
        disposition: "attachment",
        filename: row.filename,
        type: row.mimeType,
      });
    }
    return attachments;
  }

  private async sendReplyDraft(draft: DraftRow): Promise<SentDraftResult> {
    const email = this.findEmail(draft.email_id);
    if (!email) {
      this.restoreDraftAfterFailure(draft.id);
      throw new Error("The original email no longer exists.");
    }

    if (!isManagedMailbox(this.env, email.mailbox)) {
      this.restoreDraftAfterFailure(draft.id);
      throw new Error("The original mailbox is not allowed to send replies.");
    }

    try {
      const { ownerName } = this.getProfile();
      const attachments = await this.loadDraftEmailAttachments(draft.id);
      const result = await this.sendEmail({
        binding: this.env.EMAIL,
        from: {
          email: email.mailbox,
          ...(ownerName ? { name: ownerName } : {}),
        },
        replyTo: email.mailbox,
        subject: subjectForReply(email.subject),
        text: draft.body,
        to: email.replyTo,
        ...(attachments.length > 0 ? { attachments } : {}),
        inReplyTo: email.messageId ?? undefined,
        secret: this.env.EMAIL_SECRET,
      });

      if (!result.messageId?.trim()) {
        throw new Error("Email service did not return a message ID.");
      }

      this.sql`
        UPDATE drafts
        SET
          status = 'sent',
          sent_at = ${Date.now()},
          sent_message_id = ${result.messageId},
          updated_at = ${Date.now()}
        WHERE id = ${draft.id} AND status = 'sending'
      `;

      console.log(
        JSON.stringify({
          draftId: draft.id,
          emailId: email.shortId,
          event: "email.reply_sent",
          messageId: result.messageId,
        })
      );

      return {
        draftId: draft.id,
        messageId: result.messageId,
        status: "sent",
      };
    } catch (error) {
      this.markDraftDeliveryUnknown(draft.id);
      console.error(
        JSON.stringify({
          deliveryOutcome: "unknown",
          draftId: draft.id,
          emailId: email.shortId,
          error: error instanceof Error ? error.message : "Unknown error",
          event: "email.reply_failed",
        })
      );
      // biome-ignore lint/style/useErrorCause: DeliveryOutcomeUnknownError preserves this provider error as its cause.
      throw new DeliveryOutcomeUnknownError(error);
    }
  }

  private async sendNewEmailDraft(
    draft: NewEmailDraftRow
  ): Promise<SentDraftResult> {
    const { defaultOutboundMailbox } = getDeploymentConfig(this.env);
    if (draft.from_address !== defaultOutboundMailbox) {
      this.restoreNewEmailDraftAfterFailure(draft.id);
      throw new Error("The sender address is not allowed.");
    }

    try {
      const { ownerName } = this.getProfile();
      const attachments = await this.loadDraftEmailAttachments(draft.id);
      const result = await this.sendEmail({
        binding: this.env.EMAIL,
        from: {
          email: defaultOutboundMailbox,
          ...(ownerName ? { name: ownerName } : {}),
        },
        replyTo: defaultOutboundMailbox,
        subject: draft.subject,
        text: draft.body,
        to: draft.recipient,
        ...(attachments.length > 0 ? { attachments } : {}),
        secret: this.env.EMAIL_SECRET,
      });

      if (!result.messageId?.trim()) {
        throw new Error("Email service did not return a message ID.");
      }

      this.sql`
        UPDATE new_email_drafts
        SET
          status = 'sent',
          sent_at = ${Date.now()},
          sent_message_id = ${result.messageId},
          updated_at = ${Date.now()}
        WHERE id = ${draft.id} AND status = 'sending'
      `;

      console.log(
        JSON.stringify({
          draftId: draft.id,
          event: "email.new_message_sent",
          messageId: result.messageId,
        })
      );

      return {
        draftId: draft.id,
        messageId: result.messageId,
        status: "sent",
      };
    } catch (error) {
      this.markNewEmailDeliveryUnknown(draft.id);
      console.error(
        JSON.stringify({
          deliveryOutcome: "unknown",
          draftId: draft.id,
          error: error instanceof Error ? error.message : "Unknown error",
          event: "email.new_message_failed",
        })
      );
      // biome-ignore lint/style/useErrorCause: DeliveryOutcomeUnknownError preserves this provider error as its cause.
      throw new DeliveryOutcomeUnknownError(error);
    }
  }

  private restoreDraftAfterFailure(draftId: string): void {
    this.sql`
      UPDATE drafts
      SET status = 'draft', updated_at = ${Date.now()}
      WHERE id = ${draftId} AND status = 'sending'
    `;
  }

  private markDraftDeliveryUnknown(draftId: string): void {
    markReplyDraftDeliveryUnknown(this, draftId);
  }

  private restoreNewEmailDraftAfterFailure(draftId: string): void {
    this.sql`
      UPDATE new_email_drafts
      SET status = 'draft', updated_at = ${Date.now()}
      WHERE id = ${draftId} AND status = 'sending'
    `;
  }

  private markNewEmailDeliveryUnknown(draftId: string): void {
    markNewEmailDeliveryUnknown(this, draftId);
  }
}
