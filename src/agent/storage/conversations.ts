// biome-ignore-all lint/suspicious/noUnusedExpressions: SQL tagged templates intentionally execute through the Durable Object SQL host.
import { scopedConversationId } from "@/agent/conversation";
import type { AgentSqlHost } from "@/agent/storage/sql";
import type { ConversationMessage } from "@/agent/types";

const MAX_CONVERSATION_HISTORY = 40;

type ConversationRow = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: number;
};

export function listStoredConversationMessages(
  host: AgentSqlHost,
  conversationId: string,
  limit = 24
): ConversationMessage[] {
  const storageConversationId = scopedConversationId(conversationId);
  const safeLimit = Math.max(
    1,
    Math.min(MAX_CONVERSATION_HISTORY, Math.trunc(limit))
  );
  const rows = host.sql<ConversationRow>`
    SELECT id, role, content, created_at
    FROM (
      SELECT id, role, content, created_at
      FROM conversation_messages
      WHERE conversation_id = ${storageConversationId}
      ORDER BY id DESC
      LIMIT ${safeLimit}
    )
    ORDER BY id ASC
  `;

  return rows.map((row) => ({
    content: row.content,
    createdAt: row.created_at,
    role: row.role,
  }));
}

export function saveStoredConversationTurn(
  host: AgentSqlHost,
  conversationId: string,
  userMessage: string,
  assistantMessage: string
): void {
  const storageConversationId = scopedConversationId(conversationId);
  const now = Date.now();
  host.sql`
    INSERT INTO conversation_messages (
      conversation_id,
      role,
      content,
      created_at
    )
    VALUES
      (${storageConversationId}, 'user', ${userMessage}, ${now}),
      (${storageConversationId}, 'assistant', ${assistantMessage}, ${now + 1})
  `;

  host.sql`
    DELETE FROM conversation_messages
    WHERE
      conversation_id = ${storageConversationId}
      AND id NOT IN (
        SELECT id
        FROM conversation_messages
        WHERE conversation_id = ${storageConversationId}
        ORDER BY id DESC
        LIMIT ${MAX_CONVERSATION_HISTORY}
      )
  `;
}

export function clearStoredConversation(
  host: AgentSqlHost,
  conversationId: string
): void {
  host.sql`
    DELETE FROM conversation_messages
    WHERE conversation_id = ${scopedConversationId(conversationId)}
  `;
}
