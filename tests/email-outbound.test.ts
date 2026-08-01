import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOutboundEmailMessage,
  formatEmailAddress,
  normalizeMessageId,
} from "../src/email/outbound.ts";

test("outbound email messages preserve attachments and safe reply headers", () => {
  const message = buildOutboundEmailMessage({
    attachments: [
      {
        content: new TextEncoder().encode("resume").buffer as ArrayBuffer,
        disposition: "attachment",
        filename: "resume.pdf",
        type: "application/pdf",
      },
    ],
    from: { email: "hello@example.com", name: "Avery" },
    inReplyTo: "<message-1@example.net>",
    replyTo: "hello@example.com",
    subject: "Re: Hello",
    text: "Thanks",
    to: "friend@example.net",
  });

  assert.deepEqual(message.headers, {
    "In-Reply-To": "<message-1@example.net>",
  });
  assert.equal(message.attachments?.[0]?.filename, "resume.pdf");
  assert.deepEqual(message.from, { email: "hello@example.com", name: "Avery" });
});

test("invalid message IDs are omitted instead of breaking reply delivery", () => {
  assert.equal(normalizeMessageId("not a message id"), null);
  assert.equal(
    buildOutboundEmailMessage({
      from: { email: "hello@example.com" },
      inReplyTo: "bad\r\nheader",
      subject: "Hello",
      text: "Thanks",
      to: "friend@example.net",
    }).headers,
    undefined
  );
});

test("draft sender display includes the learned owner name", () => {
  assert.equal(
    formatEmailAddress("hello@example.com", "Avery"),
    "Avery <hello@example.com>"
  );
  assert.equal(formatEmailAddress("hello@example.com"), "hello@example.com");
});
