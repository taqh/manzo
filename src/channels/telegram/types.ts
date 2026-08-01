import type { TelegramAdapter } from "@chat-adapter/telegram";
import type { ChatSdkStateParent } from "agents/chat-sdk";
import type { Chat } from "chat";
import type {
  AgentChatResponse,
  AgentMessageInput,
  DraftResult,
  InboxPeriod,
  InboxPeriodSummary,
  OwnerProfile,
  OutgoingEmailAttachment,
  PendingDraft,
  PersonalMemory,
  StoredEmail,
  StoredEmailAttachment,
  StoredEmailSummary,
  StoredOutboundAttachment,
  UploadedTelegramAttachment,
} from "@/agent/types";

type MaybePromise<T> = T | Promise<T>;

export type PersonalAgentActions = {
  createDraft(
    emailReference: string,
    body: string,
    attachmentIds?: string[],
  ): MaybePromise<DraftResult>;
  findPreviousEmailsFrom(
    sender: string,
    excludeEmailReference?: string,
    limit?: number,
  ): MaybePromise<StoredEmailSummary[]>;
  getInboxSummary(period: InboxPeriod): MaybePromise<InboxPeriodSummary>;
  getEmailAttachments(
    emailReference: string,
    attachmentIds?: string[],
  ): Promise<OutgoingEmailAttachment[]>;
  getProfile(): MaybePromise<OwnerProfile>;
  listMemories(): MaybePromise<PersonalMemory[]>;
  listEmails(limit?: number): MaybePromise<StoredEmailSummary[]>;
  listEmailAttachments(
    emailReference: string,
  ): MaybePromise<StoredEmailAttachment[]>;
  listUploadedAttachments(
    attachmentIds: string[],
  ): MaybePromise<StoredOutboundAttachment[]>;
  storeTelegramAttachments(
    conversationId: string,
    uploads: UploadedTelegramAttachment[],
  ): Promise<StoredOutboundAttachment[]>;
  readEmail(emailReference: string): MaybePromise<StoredEmail | null>;
  remember(key: string, value: string): MaybePromise<PersonalMemory>;
  forgetMemory(key: string): MaybePromise<boolean>;
  clearMemories(): MaybePromise<number>;
  respondToChat(input: AgentMessageInput): Promise<AgentChatResponse>;
  resetConversation(conversationId: string): MaybePromise<void>;
  saveConversationTurn(
    conversationId: string,
    userMessage: string,
    assistantMessage: string,
  ): MaybePromise<void>;
  searchEmails(
    query: string,
    limit?: number,
  ): MaybePromise<StoredEmailSummary[]>;
  sendDraft(
    draftId: string,
    expectedRevision: number,
  ): Promise<{
    draftId: string;
    messageId: string;
    status: "sent";
  }>;
};

export type PersonalChatHost = PersonalAgentActions & ChatSdkStateParent;

export type PersonalThreadState = {
  activeEmailId?: string | null;
  lastInboxPeriod?: InboxPeriod | null;
  lastNotificationEmailId?: string | null;
  pendingDraft?: PendingDraft | null;
  pendingAttachmentIds?: string[];
  presentedEmailIds?: string[];
};

export type PersonalChat = Chat<
  { telegram: TelegramAdapter },
  PersonalThreadState
>;

export type ChatDeliveryStatus = "sent" | "not_configured" | "failed";
