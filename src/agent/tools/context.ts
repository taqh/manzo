import type {
  AgentMessageInput,
  ConversationMessage,
  DraftResult,
  InboxPeriod,
  InboxPeriodSummary,
  NewEmailDraftResult,
  OwnerProfile,
  OwnerProfileUpdate,
  PersonalMemory,
  ReplyDraftResult,
  SentDraftResult,
  StoredEmail,
  StoredEmailSummary,
} from "@/agent/types";

export type PersonalAiHost = {
  createDraft(emailReference: string, body: string): ReplyDraftResult;
  createNewEmailDraft(
    recipient: string,
    subject: string,
    body: string,
  ): NewEmailDraftResult;
  findPreviousEmailsFrom(
    sender: string,
    excludeEmailReference?: string,
    limit?: number,
  ): StoredEmailSummary[];
  getInboxSummary(period: InboxPeriod): InboxPeriodSummary;
  getOldestEmail(): StoredEmailSummary | null;
  getProfile(): OwnerProfile;
  forgetMemory(key: string): boolean;
  listConversationMessages(
    conversationId: string,
    limit?: number,
  ): ConversationMessage[];
  listEmails(limit?: number): StoredEmailSummary[];
  listMemories(): PersonalMemory[];
  readEmail(emailReference: string): StoredEmail | null;
  remember(key: string, value: string): PersonalMemory;
  resetConversation(conversationId: string): void;
  sendDraft(
    draftId: string,
    expectedRevision: number,
  ): Promise<SentDraftResult>;
  saveConversationTurn(
    conversationId: string,
    userMessage: string,
    assistantMessage: string,
  ): void;
  searchEmails(query: string, limit?: number): StoredEmailSummary[];
  updateProfile(update: OwnerProfileUpdate): OwnerProfile;
};

export type PersonalToolResultState = {
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
  memories: PersonalMemory[],
): PersonalToolContext {
  return {
    host,
    input,
    memories,
    result: {
      drafts: [],
      deliveryOutcomeUnknown: false,
      factualToolsRun: [],
      presentedEmailIds: [],
      selectedEmailId: input.activeEmailId,
      sentDrafts: [],
    },
    userMessage,
  };
}
