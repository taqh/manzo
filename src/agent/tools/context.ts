import type {
  AgentMessageInput,
  AttachmentRequest,
  ConversationMessage,
  DraftResult,
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
} from "@/agent/types";

export type PersonalAiHost = {
  createDraft(
    emailReference: string,
    body: string,
    attachmentIds?: string[]
  ): ReplyDraftResult;
  createNewEmailDraft(
    recipient: string,
    subject: string,
    body: string,
    attachmentIds?: string[]
  ): NewEmailDraftResult;
  findPreviousEmailsFrom(
    sender: string,
    excludeEmailReference?: string,
    limit?: number
  ): StoredEmailSummary[];
  getInboxSummary(period: InboxPeriod): InboxPeriodSummary;
  getOldestEmail(): StoredEmailSummary | null;
  getEmailAttachments(
    emailReference: string,
    attachmentIds?: string[]
  ): Promise<OutgoingEmailAttachment[]>;
  getProfile(): OwnerProfile;
  forgetMemory(key: string): boolean;
  listConversationMessages(
    conversationId: string,
    limit?: number
  ): ConversationMessage[];
  listEmails(limit?: number): StoredEmailSummary[];
  listEmailAttachments(emailReference: string): StoredEmailAttachment[];
  listUploadedAttachments(attachmentIds: string[]): StoredOutboundAttachment[];
  listMemories(): PersonalMemory[];
  readEmail(emailReference: string): StoredEmail | null;
  remember(key: string, value: string): PersonalMemory;
  resetConversation(conversationId: string): void;
  sendDraft(
    draftId: string,
    expectedRevision: number
  ): Promise<SentDraftResult>;
  saveConversationTurn(
    conversationId: string,
    userMessage: string,
    assistantMessage: string
  ): void;
  searchEmails(query: string, limit?: number): StoredEmailSummary[];
  updateProfile(update: OwnerProfileUpdate): OwnerProfile;
};

export type PersonalToolResultState = {
  attachmentRequests: AttachmentRequest[];
  consumedAttachmentIds: string[];
  drafts: DraftResult[];
  deliveryOutcomeUnknown: boolean;
  factualToolsRun: string[];
  presentedEmailIds: string[];
  selectedEmailId: string | null;
  sentDrafts: SentDraftResult[];
};

export type PersonalToolContext = {
  host: PersonalAiHost;
  input: AgentMessageInput;
  memories: PersonalMemory[];
  result: PersonalToolResultState;
  userMessage: string;
};

export function createPersonalToolContext(
  host: PersonalAiHost,
  input: AgentMessageInput,
  userMessage: string,
  memories: PersonalMemory[]
): PersonalToolContext {
  return {
    host,
    input,
    memories,
    result: {
      attachmentRequests: [],
      consumedAttachmentIds: [],
      deliveryOutcomeUnknown: false,
      drafts: [],
      factualToolsRun: [],
      presentedEmailIds: [],
      selectedEmailId: input.activeEmailId,
      sentDrafts: [],
    },
    userMessage,
  };
}
