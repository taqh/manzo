type ReferenceState = {
  activeEmailId?: string | null;
  lastNotificationEmailId?: string | null;
  presentedEmailIds?: string[];
};

export function resolveReadReference(state: ReferenceState): string | null {
  return (
    state.presentedEmailIds?.[0] ??
    state.activeEmailId ??
    state.lastNotificationEmailId ??
    null
  );
}

export function resolveReplyReference(state: ReferenceState): string | null {
  return (
    state.activeEmailId ??
    state.presentedEmailIds?.[0] ??
    state.lastNotificationEmailId ??
    null
  );
}

export function selectedEmailState(emailId: string): {
  activeEmailId: string;
  presentedEmailIds: string[];
} {
  return { activeEmailId: emailId, presentedEmailIds: [emailId] };
}

type AgentResponseState = {
  activeEmailId: string | null;
  lastInboxPeriod: "today" | "yesterday" | null;
  presentedEmailIds: string[];
  sentDraftId: string | null;
};

export function operationalStateAfterResponse(response: AgentResponseState): {
  activeEmailId: string | null;
  lastInboxPeriod: "today" | "yesterday" | null;
  pendingDraft?: null;
  presentedEmailIds: string[];
} {
  return {
    activeEmailId: response.activeEmailId,
    lastInboxPeriod: response.lastInboxPeriod,
    presentedEmailIds: response.presentedEmailIds,
    ...(response.sentDraftId ? { pendingDraft: null } : {}),
  };
}
