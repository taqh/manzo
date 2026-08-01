// biome-ignore-all lint/suspicious/noUnusedExpressions: SQL tagged templates intentionally execute through the Durable Object SQL host.
import type { AgentSqlHost } from "@/agent/storage/sql";
import type { StoredOutboundAttachment } from "@/agent/types";

export type OutboundAttachmentRow = StoredOutboundAttachment & {
  r2_key: string;
};

type OutboundAttachmentInsert = StoredOutboundAttachment & {
  r2Key: string;
};

function toStoredAttachment(
  row: OutboundAttachmentRow
): StoredOutboundAttachment {
  return {
    conversationId: row.conversationId,
    filename: row.filename,
    id: row.id,
    mimeType: row.mimeType,
    size: row.size,
  };
}

function toAttachmentRow(row: {
  id: string;
  conversation_id: string;
  filename: string;
  mime_type: string;
  size: number;
  r2_key: string;
}): OutboundAttachmentRow {
  return {
    conversationId: row.conversation_id,
    filename: row.filename,
    id: row.id,
    mimeType: row.mime_type,
    r2_key: row.r2_key,
    size: row.size,
  };
}

export function insertOutboundAttachments(
  host: AgentSqlHost,
  attachments: OutboundAttachmentInsert[]
): void {
  for (const attachment of attachments) {
    host.sql`
      INSERT INTO outbound_attachments (
        id,
        conversation_id,
        filename,
        mime_type,
        size,
        r2_key,
        created_at
      )
      VALUES (
        ${attachment.id},
        ${attachment.conversationId},
        ${attachment.filename},
        ${attachment.mimeType},
        ${attachment.size},
        ${attachment.r2Key},
        ${Date.now()}
      )
      ON CONFLICT(id) DO NOTHING
    `;
  }
}

export function listOutboundAttachmentRows(
  host: AgentSqlHost,
  attachmentIds: string[]
): OutboundAttachmentRow[] {
  const rows: OutboundAttachmentRow[] = [];
  for (const attachmentId of attachmentIds) {
    const matches = host.sql<{
      id: string;
      conversation_id: string;
      filename: string;
      mime_type: string;
      size: number;
      r2_key: string;
    }>`
      SELECT id, conversation_id, filename, mime_type, size, r2_key
      FROM outbound_attachments
      WHERE id = ${attachmentId}
      LIMIT 1
    `;
    const [row] = matches;
    if (row) {
      rows.push(toAttachmentRow(row));
    }
  }
  return rows;
}

export function listOutboundAttachments(
  host: AgentSqlHost,
  attachmentIds: string[]
): StoredOutboundAttachment[] {
  return listOutboundAttachmentRows(host, attachmentIds).map(
    toStoredAttachment
  );
}

export function linkAttachmentsToDraft(
  host: AgentSqlHost,
  draftId: string,
  attachmentIds: string[]
): void {
  for (const attachmentId of attachmentIds) {
    host.sql`
      INSERT INTO draft_attachments (draft_id, attachment_id)
      VALUES (${draftId}, ${attachmentId})
      ON CONFLICT(draft_id, attachment_id) DO NOTHING
    `;
  }
}

export function listDraftAttachmentRows(
  host: AgentSqlHost,
  draftId: string
): OutboundAttachmentRow[] {
  const rows = host.sql<{
    id: string;
    conversation_id: string;
    filename: string;
    mime_type: string;
    size: number;
    r2_key: string;
  }>`
    SELECT a.id, a.conversation_id, a.filename, a.mime_type, a.size, a.r2_key
    FROM draft_attachments AS d
    INNER JOIN outbound_attachments AS a ON a.id = d.attachment_id
    WHERE d.draft_id = ${draftId}
    ORDER BY a.created_at ASC, a.id ASC
  `;
  return rows.map(toAttachmentRow);
}

export function listDraftAttachments(
  host: AgentSqlHost,
  draftId: string
): StoredOutboundAttachment[] {
  return listDraftAttachmentRows(host, draftId).map(toStoredAttachment);
}
