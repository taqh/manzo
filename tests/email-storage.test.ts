import assert from "node:assert/strict";
import test from "node:test";
import {
  markNewEmailDeliveryUnknown,
  markReplyDraftDeliveryUnknown,
} from "../src/agent/storage/drafts.ts";
import {
  findOldestStoredEmail,
  summarizeStoredEmailsInRange,
  type EmailRow,
} from "../src/agent/storage/emails.ts";
import { normalizeAttachments } from "../src/email/attachments.ts";

test("normalizes attachment metadata and binary content for R2 storage", () => {
  const [attachment] = normalizeAttachments("email-1", [
    {
      filename: "../notes.txt",
      mimeType: "text/plain",
      disposition: "attachment",
      contentId: undefined,
      content: new TextEncoder().encode("hello"),
    },
  ]);

  assert.equal(attachment?.id, "email-1-attachment-1");
  assert.equal(attachment?.filename, "_notes.txt");
  assert.equal(attachment?.mimeType, "text/plain");
  assert.deepEqual(
    [...(attachment?.content ?? new Uint8Array())],
    [...new TextEncoder().encode("hello")],
  );
});

test("oldest email queries the complete inbox in ascending order", () => {
  const queries: string[] = [];
  const oldestRow: EmailRow = {
    id: "email-oldest",
    short_id: "oldest01",
    mailbox: "agent@example.com",
    sender: "first@example.com",
    sender_name: "First Sender",
    reply_to: "first@example.com",
    subject: "The beginning",
    message_id: "<oldest@example.com>",
    sent_at: null,
    text_body: "First message",
    html_body: null,
    raw_key: "mail/email-oldest.eml",
    raw_size: 100,
    attachment_count: 0,
    is_auto_reply: 0,
    received_at: 1,
    read_at: null,
    notification_status: "sent",
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
  assert.match(queries[0] ?? "", /ORDER BY received_at ASC, id ASC/);
  assert.match(queries[0] ?? "", /LIMIT 1/);
  assert.doesNotMatch(queries[0] ?? "", /LIMIT \?/);
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
    20,
  );

  assert.equal(summary.count, 27);
  assert.equal(summary.unreadCount, 4);
  assert.equal(summary.emails.length, 0);
  assert.equal(calls.length, 2);
  assert.match(calls[0] ?? "", /COUNT\(\*\)/);
  assert.match(calls[1] ?? "", /LIMIT/);
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
    assert.match(query, /status = 'delivery_unknown'/);
    assert.match(query, /status = 'sending'/);
    assert.doesNotMatch(query, /status = 'draft'/);
  }
});
