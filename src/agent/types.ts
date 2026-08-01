export type RuntimeConfiguration = {
  DEFAULT_OUTBOUND_MAILBOX?: string;
  MANAGED_MAILBOXES?: string;
  AI_GATEWAY_ID?: string;
  AI_MODEL?: string;
  TELEGRAM_BOT_USERNAME?: string;
};

export type RuntimeSecrets = {
  EMAIL_SECRET?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
};

export type AgentEnvironment =
  & CloudflareBindings
  & RuntimeConfiguration
  & RuntimeSecrets;

export type StoredEmailSummary = {
  id: string;
  shortId: string;
  mailbox: string;
  sender: string;
  senderName: string | null;
  subject: string;
  receivedAt: number;
  attachmentCount: number;
  readAt: number | null;
  notificationStatus: string;
};

export type StoredEmail = StoredEmailSummary & {
  replyTo: string;
  messageId: string | null;
  sentAt: string | null;
  textBody: string;
  htmlBody: string | null;
  rawKey: string;
  rawSize: number;
  isAutoReply: boolean;
};

export type StoredEmailAttachment = {
  id: string;
  emailId: string;
  filename: string;
  mimeType: string;
  disposition: "attachment" | "inline" | null;
  contentId: string | null;
  size: number;
};

export type OutgoingEmailAttachment = StoredEmailAttachment & {
  data: ArrayBuffer;
};

export type StoredOutboundAttachment = {
  id: string;
  conversationId: string;
  filename: string;
  mimeType: string;
  size: number;
};

export type UploadedTelegramAttachment = {
  filename: string;
  mimeType: string;
  size: number;
  data: ArrayBuffer;
};

export type AttachmentRequest = {
  emailId: string;
  attachmentIds: string[];
};

export type InboxPeriod = "today" | "yesterday";

export type InboxPeriodSummary = {
  period: InboxPeriod;
  startAt: number;
  endAt: number;
  timeZone?: string;
  count: number;
  unreadCount: number;
  emails: StoredEmailSummary[];
};

export type OwnerProfile = {
  ownerName: string | null;
  agentName: string | null;
  timeZone: string | null;
  updatedAt: number | null;
};

export type OwnerProfileUpdate = Partial<
  Pick<OwnerProfile, "ownerName" | "agentName" | "timeZone">
>;

export type DraftConfirmation = {
  draftId: string;
  revision: number;
};

export type ReplyDraftResult = DraftConfirmation & {
  kind: "reply";
  emailShortId: string;
  from: string;
  recipient: string;
  subject: string;
  body: string;
  attachments: StoredOutboundAttachment[];
};

export type NewEmailDraftResult = DraftConfirmation & {
  kind: "new";
  from: string;
  recipient: string;
  subject: string;
  body: string;
  attachments: StoredOutboundAttachment[];
};

export type DraftResult = ReplyDraftResult | NewEmailDraftResult;

export type PendingDraft = DraftConfirmation & {
  kind: DraftResult["kind"];
  from: string;
  recipient: string;
  subject: string;
  displayedAt: number;
};

export type AgentMessageInput = {
  activeEmailId: string | null;
  authorization: "telegram_allowlisted";
  conversationId: string;
  lastInboxPeriod: InboxPeriod | null;
  lastNotificationEmailId: string | null;
  pendingDraft: PendingDraft | null;
  presentedEmailIds: string[];
  text: string;
  uploadedAttachmentIds: string[];
};

export type SentDraftResult = {
  draftId: string;
  messageId: string;
  status: "sent";
};

export type PersonalMemory = {
  key: string;
  value: string;
  createdAt: number;
  updatedAt: number;
};

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

export type AgentChatResponse = {
  text: string;
  drafts: DraftResult[];
  activeEmailId: string | null;
  lastInboxPeriod: InboxPeriod | null;
  presentedEmailIds: string[];
  sentDraftId: string | null;
  attachments: OutgoingEmailAttachment[];
  consumedAttachmentIds: string[];
  model: string;
};
