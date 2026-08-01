# Manzo

Manzo is a single-owner, self-hosted inbox agent for Cloudflare. It receives
email through Cloudflare Email Routing, keeps the raw message and attachments
private, and lets one allowlisted Telegram chat search, read, draft, and send
email.

## Features

- Inbound email through Cloudflare Email Routing and a Hono Worker
- SQLite-backed Cloudflare Durable Object for mail metadata, conversations,
  drafts, memory, and owner profile
- Private R2 storage for original `.eml` files and attachments
- Workers AI with AI Gateway for model inference and guarded tool calling
- Telegram delivery and commands through Chat SDK's Telegram adapter
- Cloudflare Email Service for replies and brand-new messages
- Attachment metadata and binary storage in private R2, with explicit Telegram
  sharing and outbound email attachments from Telegram uploads
- Durable drafts, exact-draft confirmations, direct-send safeguards,
  duplicate-send prevention, and `delivery_unknown` locking
- Deterministic inbox queries and proactive Telegram notifications

## Architecture

```text
Cloudflare Email Routing                 Allowlisted Telegram chat
            │                                       │
            ▼                                       ▼
     Hono Worker email handler ───────► Chat SDK Telegram adapter
            │                                       │
            ▼                                       ▼
         InboxAgent Durable Object ◄── Telegram webhook
            │
            ├── SQLite: metadata, drafts, conversation, memory, profile
            ├── private R2: raw .eml files and attachments
            ├── Workers AI + AI Gateway: inference and tool calling
            └── Email Service: confirmed replies and new messages
```

## Security model

Email is untrusted data. Subjects, bodies, sender names, links, attachment
names, quoted history, and email-bearing tool output are never instructions or
send authorization. Only the current message from `TELEGRAM_CHAT_ID` can
authorize a send.

Normal compose requests create a durable preview. A later explicit confirmation
sends only that exact displayed draft revision. Ambiguous delivery outcomes are
locked as `delivery_unknown` instead of being retried automatically.

The Telegram chat ID is the authorization boundary. R2 is private, and AI
Gateway prompt/response collection is disabled in code. Private means the data
is not publicly exposed; it still passes through Telegram, Cloudflare, AI
inference, and email delivery providers as part of normal operation.

## Setup

You need Node.js 22+, pnpm, a Cloudflare account, a Cloudflare-managed domain,
and a Telegram account. The complete deployment guide is in
[`SETUP.md`](SETUP.md).

The short version is:

```sh
git clone https://github.com/your-org/manzo.git
cd manzo
pnpm install
pnpm check
```

Then configure `wrangler.jsonc`, create the R2 bucket, onboard Email Routing
and Email Sending, configure the Telegram bot and Wrangler secrets, deploy,
and register the webhook. Follow [`SETUP.md`](SETUP.md) for the exact order and
verification steps.

## Using Manzo

Commands:

- `/start` — introduction; optional profile setup never blocks use
- `/help` — capability guide
- `/latest` — ten most recent emails
- `/read <email-id>` — read one email
- `/draft <email-id> <reply>` — create a reviewable reply
- `/reset` — clear only the current chat's working context

Natural-language examples:

- “How many emails did I receive today?”
- “Show me the oldest email in the inbox.”
- “Has this sender emailed me before?”
- “Draft a reply saying I'll get back to them tomorrow.”
- “Just send ‘I'll be there at two’ to friend@example.com.”
- “My timezone is America/New_York.”
- “Your name is Nimbus.”
- “Send me the PDF from the latest email.”
- Upload a resume, then say “Email the recruiter and attach this resume.”

For an ordinary draft, say “looks good, send” after reviewing its card. Direct
sends require explicit send language, a recipient, and usable wording in the
same allowlisted message. Telegram uploads are staged privately first; sending
or attaching a file requires an explicit request.

## Current limitations

- One Telegram chat owns the inbox; this is not a shared helpdesk or a
  multi-tenant agent.
- It cannot browse the web.
- Attachment contents can be listed and explicitly shared into the allowlisted
  Telegram chat, and Telegram uploads can be attached to reviewed outbound
  drafts; there is no automatic forwarding or automatic sending.
- Email Routing and Email Sending are separate Cloudflare setup flows.
- A successful send requires a provider message ID. Ambiguous outcomes are
  deliberately locked instead of retried automatically.

## Model configuration and costs

The template defaults to the Cloudflare-hosted
`@cf/moonshotai/kimi-k2.7-code` model through Workers AI. Model usage, R2
storage, Durable Object usage, Workers requests, AI Gateway, and Email Service
may each have separate account limits or costs. Review the current
[Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
and [AI Gateway pricing](https://developers.cloudflare.com/ai-gateway/pricing/)
before sending significant inbox volume.

## Development

```sh
pnpm test   # regression tests
pnpm check  # type generation, tests, and Wrangler dry-run
pnpm dev    # local Worker development
```

See [`SETUP.md`](SETUP.md) for local fixture testing and deployment
troubleshooting.

## Project structure

```text
src/
  agent/                 durable inbox, AI loop, storage, and guarded tools
    storage/             SQLite schemas and focused storage helpers
      outbound-attachments.ts  Telegram upload metadata and draft links
    tools/               guarded email, attachment, and memory tools
  channels/telegram/     adapter, commands, cards, state, and webhooks
  email/                 bounded MIME normalization and attachment handling
    attachments.ts       attachment normalization and R2 key helpers
  index.ts               Hono HTTP and Cloudflare Email entry points
fixtures/sample-email.eml safe local inbound-mail fixture with attachment
tests/                    regression coverage for reliability and storage
wrangler.jsonc            non-secret deployment configuration
SETUP.md                 full deployment and operations guide
```
