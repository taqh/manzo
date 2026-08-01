import assert from "node:assert/strict";
import test from "node:test";
import {
  markNewEmailDeliveryUnknown,
  markReplyDraftDeliveryUnknown,
} from "../src/agent/storage/drafts.ts";
import {
  type EmailRow,
  findOldestStoredEmail,
  summarizeStoredEmailsInRange,
} from "../src/agent/storage/emails.ts";
import { clearStoredMemories } from "../src/agent/storage/memories.ts";
import { normalizeAttachments } from "../src/email/attachments.ts";

const OLDEST_ORDER_PATTERN = /ORDER BY received_at ASC, id ASC/;
const LIMIT_ONE_PATTERN = /LIMIT 1/;
const PARAMETERIZED_LIMIT_PATTERN = /LIMIT \?/;
const COUNT_PATTERN = /COUNT\(\*\)/;
const LIMIT_PATTERN = /LIMIT/;
const DELIVERY_UNKNOWN_PATTERN = /status = 'delivery_unknown'/;
const SENDING_PATTERN = /status = 'sending'/;
const DRAFT_STATUS_PATTERN = /status = 'draft'/;
const DELETE_MEMORIES_PATTERN = /DELETE FROM memories/;
const RETURNING_KEY_PATTERN = /RETURNING key/;

test("normalizes attachment metadata and binary content for R2 storage", () => {
  const [attachment] = normalizeAttachments("email-1", [
    {
      content: new TextEncoder().encode("hello"),
      contentId: undefined,
      disposition: "attachment",
      filename: "../notes.txt",
      mimeType: "text/plain",
    },
  ]);

  assert.equal(attachment?.id, "email-1-attachment-1");
  assert.equal(attachment?.filename, "_notes.txt");
  assert.equal(attachment?.mimeType, "text/plain");
  assert.deepEqual(
    [...(attachment?.content ?? new Uint8Array())],
    [...new TextEncoder().encode("hello")]
  );
});

test("oldest email queries the complete inbox in ascending order", () => {
  const queries: string[] = [];
  const oldestRow: EmailRow = {
    attachment_count: 0,
    html_body: null,
    id: "email-oldest",
    is_auto_reply: 0,
    mailbox: "agent@example.com",
    message_id: "<oldest@example.com>",
    notification_status: "sent",
    raw_key: "mail/email-oldest.eml",
    raw_size: 100,
    read_at: null,
    received_at: 1,
    reply_to: "first@example.com",
    sender: "first@example.com",
    sender_name: "First Sender",
    sent_at: null,
    short_id: "oldest01",
    subject: "The beginning",
    text_body: "First message",
  };
  const host = {
    sql<T>(strings: TemplateStringsArray): T[] {
      queries.push(strings.join("?"));
      return [oldestRow] as T[];
    },
  };

  const oldest = findOldestStoredEmail(host);

  assert.equal(oldest?.shortId, "oldest01");
  assert.equal(queries.length, 1);
  assert.match(queries[0] ?? "", OLDEST_ORDER_PATTERN);
  assert.match(queries[0] ?? "", LIMIT_ONE_PATTERN);
  assert.doesNotMatch(queries[0] ?? "", PARAMETERIZED_LIMIT_PATTERN);
});

test("period summary counts every matching email even when the list is limited", () => {
  const calls: string[] = [];
  const host = {
    sql<T>(strings: TemplateStringsArray): T[] {
      const query = strings.join("?");
      calls.push(query);
      if (query.includes("COUNT(*)")) {
        return [{ count: 27, unread_count: 4 }] as T[];
      }
      return [];
    },
  };

  const summary = summarizeStoredEmailsInRange(
    host,
    "today",
    Date.parse("2026-07-31T23:00:00.000Z"),
    Date.parse("2026-08-01T23:00:00.000Z"),
    20
  );

  assert.equal(summary.count, 27);
  assert.equal(summary.unreadCount, 4);
  assert.equal(summary.emails.length, 0);
  assert.equal(calls.length, 2);
  assert.match(calls[0] ?? "", COUNT_PATTERN);
  assert.match(calls[1] ?? "", LIMIT_PATTERN);
});

test("ambiguous delivery outcomes become non-retryable instead of draft", () => {
  const queries: string[] = [];
  const host = {
    sql<T>(strings: TemplateStringsArray): T[] {
      queries.push(strings.join("?"));
      return [];
    },
  };

  markReplyDraftDeliveryUnknown(host, "reply-1", 123);
  markNewEmailDeliveryUnknown(host, "new-1", 124);

  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.match(query, DELIVERY_UNKNOWN_PATTERN);
    assert.match(query, SENDING_PATTERN);
    assert.doesNotMatch(query, DRAFT_STATUS_PATTERN);
  }
});

test("clearing memories deletes only generic memory rows", () => {
  const queries: string[] = [];
  const host = {
    sql<T>(strings: TemplateStringsArray): T[] {
      queries.push(strings.join("?"));
      return [{ key: "email style" }, { key: "coffee" }] as T[];
    },
  };

  assert.equal(clearStoredMemories(host), 2);
  assert.equal(queries.length, 1);
  assert.match(queries[0] ?? "", DELETE_MEMORIES_PATTERN);
  assert.match(queries[0] ?? "", RETURNING_KEY_PATTERN);
});
