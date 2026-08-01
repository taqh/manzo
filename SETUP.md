# Manzo setup

This guide walks through a complete deployment of this template.

## Prerequisites

- Node.js 22 or later and pnpm
- A Cloudflare account with Workers, Durable Objects, R2, Workers AI, Email
  Routing, and Email Sending available
- A Cloudflare-managed domain, for example `your-domain.example`
- A Telegram account to create a bot and discover one private chat ID
- Wrangler authenticated to the intended Cloudflare account

Cloudflare Email Routing accepts email for a domain in your account. Cloudflare
Email Sending must also be onboarded for any domain/address that Manzo sends
from. Configure DNS records requested by the Email Sending flow before testing
outbound mail.

## Install and validate

```sh
git clone https://github.com/your-org/manzo.git
cd manzo
pnpm install
pnpm check
```

Before deploying, replace the example mailbox and bot values in
`wrangler.jsonc`. The Worker returns a clear configuration error and rejects
inbound mail while `agent@example.com` or `your-domain.example` placeholders
remain.

## Configure `wrangler.jsonc`

Non-secret deployment configuration belongs in `wrangler.jsonc`:

| Setting | Purpose |
| --- | --- |
| `name` | Cloudflare Worker name, initially `manzo` |
| `r2_buckets[0].bucket_name` | Private raw-mail bucket; choose a suitable unique name |
| `DEFAULT_OUTBOUND_MAILBOX` | Address used for brand-new messages; must be managed |
| `MANAGED_MAILBOXES` | Comma-separated inbound/reply addresses; must include the default mailbox |
| `send_email.allowed_sender_addresses` | Must match the addresses Email Sending permits |
| `AI_MODEL` | Workers AI or AI Gateway model identifier |
| `AI_GATEWAY_ID` | Cloudflare AI Gateway identifier; the template defaults to `default` |
| `TELEGRAM_BOT_USERNAME` | Public BotFather username without `@` |

For a first deployment, set all mailbox-related values to one real test
address, for example `agent@your-domain.example`. Keep the routing list and
allowed sender list in sync with `MANAGED_MAILBOXES`.

Learned identity is intentionally not configuration: `ownerName`, `agentName`,
and `timeZone` are optional SQLite profile fields. With no timezone,
date-relative queries use UTC; set an IANA value in Telegram when you want
local calendar boundaries.

## Private R2 setup

Create a bucket and place its name in `wrangler.jsonc`:

```sh
pnpm exec wrangler r2 bucket create manzo-raw-email
```

Do not create a public bucket binding, custom-domain mapping, or CDN endpoint
for this bucket. Manzo stores original RFC822 files at `emails/<sha256>.eml`.
Those files can include sensitive content and attachments.

## Email Routing setup

In Cloudflare, open **Email > Email Routing** for `your-domain.example` and
complete the domain onboarding. After the Worker has been deployed:

1. Create a rule for only `agent@your-domain.example`.
2. Choose **Send to a Worker** and select the Manzo Worker.
3. Send a harmless message from another mailbox.
4. Confirm its Telegram notification, read it, prepare a reply, and confirm
   delivery.
5. Add any other managed mailbox only after this end-to-end test passes.

Routing one test address first avoids interrupting every mailbox if an account
or DNS setting is incomplete.

## Email Sending onboarding

Open **Compute > Email Service > Email Sending** in Cloudflare and onboard
`your-domain.example`. Add the DNS records Cloudflare requests, then ensure the
addresses in `send_email.allowed_sender_addresses` match the real managed
addresses in `wrangler.jsonc`. Incoming routing and outbound Email Sending do
not automatically configure each other.

## Telegram setup

### Create the bot

1. Message `@BotFather`, create a bot, and copy its token.
2. Copy the bot username without `@` into `TELEGRAM_BOT_USERNAME` in
   `wrangler.jsonc`.
3. Open the bot in a private chat and send `/start`.
4. Generate a webhook secret, for example:

   ```sh
   openssl rand -hex 32
   ```

### Discover the chat ID

After messaging the bot, call Telegram's `getUpdates` endpoint and copy the
private `result[].message.chat.id` value:

```sh
curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
```

Treat the chat ID as a secret allowlist value. Do not use a claimed name as an
authorization check.

### Add Wrangler secrets

`.env.example` contains only empty secret placeholders. For a deployment, set
the production values with Wrangler rather than committing a `.env` or
`.dev.vars` file:

```sh
pnpm exec wrangler secret put TELEGRAM_BOT_TOKEN
pnpm exec wrangler secret put TELEGRAM_CHAT_ID
pnpm exec wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

If your Email Service setup requires it, also add the optional existing binding
secret:

```sh
pnpm exec wrangler secret put EMAIL_SECRET
```

## Deploy and register the webhook

Validate before deployment:

```sh
pnpm check
pnpm deploy
```

Then replace the placeholders and register the Telegram webhook. The URL must
use your deployed Worker hostname, not an example URL:

```sh
curl --request POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  --header "Content-Type: application/json" \
  --data '{
    "url": "https://<your-worker>.workers.dev/webhooks/telegram",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["message", "callback_query"],
    "drop_pending_updates": true
  }'
```

Opening the Worker root should show `"status":"ok"`. Until mailbox
placeholders are replaced it instead returns a precise configuration error.

## Local development and fixture testing

After replacing the mailbox placeholders with a non-placeholder managed address
and keeping `DEFAULT_OUTBOUND_MAILBOX`, `MANAGED_MAILBOXES`, and
`allowed_sender_addresses` aligned, start the Worker:

```sh
pnpm dev
```

In another terminal, post the safe local fixture:

```sh
curl --request POST \
  "http://localhost:8787/cdn-cgi/handler/email?from=sender@example.net&to=inbox@my-test.example" \
  --header "Content-Type: message/rfc822" \
  --data-binary "@fixtures/sample-email.eml"
```

Local Durable Object and R2 state lives under `.wrangler/`, which is ignored.
Raw email exports and `.eml` files are ignored by default except for the safe
checked-in fixture. Never place production mail in `fixtures/`.

Use an ignored `.dev.vars` file for local Telegram secrets:

```dotenv
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_WEBHOOK_SECRET=
EMAIL_SECRET=
```

Workers AI calls run remotely and can consume the same account allocation or
Gateway credits as production.

## Commands and examples

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
- “Draft a reply saying I’ll get back to them tomorrow.”
- “Just send ‘I’ll be there at two’ to friend@example.com.”
- “My timezone is America/New_York.”
- “Your name is Nimbus.”

For an ordinary draft, say “looks good, send” after reviewing its card. A
direct-send request is intentionally stricter: it must contain explicit send
language, recipient, and exact usable wording in the same allowlisted message.

## Model configuration and costs

The template defaults to the Cloudflare-hosted
`@cf/moonshotai/kimi-k2.7-code` model through the Workers AI binding. Review
the current [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
and [AI Gateway pricing](https://developers.cloudflare.com/ai-gateway/pricing/)
before selecting a model or sending significant inbox volume.

`AI_MODEL` accepts Cloudflare model IDs such as `@cf/provider/model` or a
Gateway-routed `provider/model` ID. Some third-party models require Unified
Billing credits. Model usage, R2 storage, Durable Object usage, Workers
requests, and Email Service may each have separate account limits or costs.
AI Gateway prompt/response logging remains disabled by Manzo regardless of
model choice.

## Data and state

Manzo stores mail metadata, drafts, conversation context, memory, and the owner
profile in the InboxAgent Durable Object's SQLite database. Original `.eml`
files and attachments are stored in the private R2 bucket. There is currently
no automatic retention policy; review and delete stored data according to your
own needs and account policy.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Root endpoint says `configuration_required` | Replace `agent@example.com`/`your-domain.example`, keep the default mailbox inside `MANAGED_MAILBOXES`, then redeploy. |
| No inbound notification | Verify Email Routing sends the test address to the correct Worker, then confirm all three Telegram secrets and the public bot username. |
| Telegram webhook fails | Re-register the deployed `/webhooks/telegram` URL with the exact webhook secret; make sure the bot chat ID is allowlisted. |
| Outbound send fails | Complete Email Sending onboarding, publish required DNS, and align `allowed_sender_addresses` with managed mailboxes. |
| “today” has the wrong boundary | Say `My timezone is Region/City`; without one, Manzo uses UTC. |
| A draft cannot be retried | `delivery_unknown` is intentional. Verify delivery outside Manzo before deciding whether to compose a new message. |
| Local mail is rejected | The placeholder mailbox configuration deliberately rejects it. Configure a real local address before testing the email handler. |
