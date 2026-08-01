// biome-ignore-all lint/suspicious/noUnusedExpressions: SQL tagged templates intentionally execute through the Durable Object SQL host.
import { findStoredEmailRow } from "@/agent/storage/emails";
import type { AgentSqlHost } from "@/agent/storage/sql";
import type { StoredEmailAttachment } from "@/agent/types";

export type AttachmentRow = StoredEmailAttachment & {
  r2_key: string;
};

type AttachmentInsert = StoredEmailAttachment & {
  r2Key: string;
};

function toStoredAttachment(row: AttachmentRow): StoredEmailAttachment {
  return {
    contentId: row.contentId,
    disposition: row.disposition,
    emailId: row.emailId,
    filename: row.filename,
    id: row.id,
    mimeType: row.mimeType,
    size: row.size,
  };
}

function toAttachmentRow(row: {
  id: string;
  email_id: string;
  filename: string;
  mime_type: string;
  disposition: "attachment" | "inline" | null;
  content_id: string | null;
  size: number;
  r2_key: string;
}): AttachmentRow {
  return {
    contentId: row.content_id,
    disposition: row.disposition,
    emailId: row.email_id,
    filename: row.filename,
    id: row.id,
    mimeType: row.mime_type,
    r2_key: row.r2_key,
    size: row.size,
  };
}

export function insertStoredAttachments(
  host: AgentSqlHost,
  attachments: AttachmentInsert[]
): void {
  for (const attachment of attachments) {
    host.sql`
      INSERT INTO attachments (
        id,
        email_id,
        filename,
        mime_type,
        disposition,
        content_id,
        size,
        r2_key
      )
      VALUES (
        ${attachment.id},
        ${attachment.emailId},
        ${attachment.filename},
        ${attachment.mimeType},
        ${attachment.disposition},
        ${attachment.contentId},
        ${attachment.size},
        ${attachment.r2Key}
      )
      ON CONFLICT(id) DO NOTHING
    `;
  }
}

export function listStoredAttachmentRows(
  host: AgentSqlHost,
  emailReference: string
): AttachmentRow[] {
  const email = findStoredEmailRow(host, emailReference);
  if (!email) {
    return [];
  }

  const rows = host.sql<{
    id: string;
    email_id: string;
    filename: string;
    mime_type: string;
    disposition: "attachment" | "inline" | null;
    content_id: string | null;
    size: number;
    r2_key: string;
  }>`
    SELECT id, email_id, filename, mime_type, disposition, content_id, size, r2_key
    FROM attachments
    WHERE email_id = ${email.id}
    ORDER BY id ASC
  `;

  return rows.map(toAttachmentRow);
}

export function listStoredAttachments(
  host: AgentSqlHost,
  emailReference: string
): StoredEmailAttachment[] {
  return listStoredAttachmentRows(host, emailReference).map(toStoredAttachment);
}
