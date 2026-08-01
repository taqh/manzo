export const CONVERSATION_RUNTIME_VERSION = "manzo-inbox-v1";

export function scopedConversationId(conversationId: string): string {
  return `${CONVERSATION_RUNTIME_VERSION}:${conversationId}`;
}
