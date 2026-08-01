import type { AgentSqlHost } from "@/agent/storage/sql";

export function initializeAgentSchema(host: AgentSqlHost): void {
  host.sql`
    CREATE TABLE IF NOT EXISTS emails (
      id TEXT PRIMARY KEY,
      short_id TEXT NOT NULL UNIQUE,
      mailbox TEXT NOT NULL,
      sender TEXT NOT NULL,
      sender_name TEXT,
      reply_to TEXT NOT NULL,
      subject TEXT NOT NULL,
      message_id TEXT,
      sent_at TEXT,
      reference_ids TEXT,
      text_body TEXT NOT NULL,
      html_body TEXT,
      raw_key TEXT NOT NULL,
      raw_size INTEGER NOT NULL,
      attachment_count INTEGER NOT NULL DEFAULT 0,
      is_auto_reply INTEGER NOT NULL DEFAULT 0,
      received_at INTEGER NOT NULL,
      read_at INTEGER,
      notification_status TEXT NOT NULL DEFAULT 'pending'
    )
  `;

  host.sql`
    CREATE INDEX IF NOT EXISTS emails_received_at_idx
    ON emails (received_at DESC)
  `;

  host.sql`
    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY,
      email_id TEXT NOT NULL,
      body TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      sent_at INTEGER,
      sent_message_id TEXT,
      FOREIGN KEY (email_id) REFERENCES emails(id)
    )
  `;

  host.sql`
    CREATE TABLE IF NOT EXISTS new_email_drafts (
      id TEXT PRIMARY KEY,
      from_address TEXT NOT NULL,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      sent_at INTEGER,
      sent_message_id TEXT
    )
  `;

  host.sql`
    CREATE TABLE IF NOT EXISTS memories (
      key TEXT PRIMARY KEY COLLATE NOCASE,
      value TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `;

  host.sql`
    CREATE TABLE IF NOT EXISTS owner_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      owner_name TEXT,
      agent_name TEXT,
      time_zone TEXT,
      updated_at INTEGER NOT NULL
    )
  `;

  host.sql`
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `;

  host.sql`
    CREATE INDEX IF NOT EXISTS conversation_messages_lookup_idx
    ON conversation_messages (conversation_id, id DESC)
  `;
}
