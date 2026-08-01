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
  PendingDraft,
  StoredEmail,
  StoredEmailSummary,
} from "@/agent/types";

type MaybePromise<T> = T | Promise<T>;

export type PersonalAgentActions = {
  createDraft(emailReference: string, body: string): MaybePromise<DraftResult>;
  findPreviousEmailsFrom(
    sender: string,
    excludeEmailReference?: string,
    limit?: number,
  ): MaybePromise<StoredEmailSummary[]>;
  getInboxSummary(period: InboxPeriod): MaybePromise<InboxPeriodSummary>;
  getProfile(): MaybePromise<OwnerProfile>;
  listEmails(limit?: number): MaybePromise<StoredEmailSummary[]>;
  readEmail(emailReference: string): MaybePromise<StoredEmail | null>;
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
  presentedEmailIds?: string[];
};

export type PersonalChat = Chat<
  { telegram: TelegramAdapter },
  PersonalThreadState
>;

export type ChatDeliveryStatus = "sent" | "not_configured" | "failed";
