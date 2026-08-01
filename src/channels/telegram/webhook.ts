import type { PersonalChat } from "@/channels/telegram/types";

const CHAT_WEBHOOK_REQUEST_LIMIT = 1_000_000;

class PayloadTooLargeError extends Error {}

async function readBoundedRequest(request: Request): Promise<Request> {
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > CHAT_WEBHOOK_REQUEST_LIMIT) {
    throw new PayloadTooLargeError();
  }

  if (!request.body) {
    return request;
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    size += value.byteLength;
    if (size > CHAT_WEBHOOK_REQUEST_LIMIT) {
      await reader.cancel();
      throw new PayloadTooLargeError();
    }

    chunks.push(value);
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new Request(request.url, {
    body,
    headers: request.headers,
    method: request.method,
  });
}

export async function handleTelegramWebhook(
  chat: PersonalChat | null,
  request: Request,
  waitUntil: (task: Promise<unknown>) => void
): Promise<Response> {
  if (!chat) {
    return Response.json(
      { error: "Telegram is not configured." },
      { status: 503 }
    );
  }

  try {
    const boundedRequest = await readBoundedRequest(request);
    return await chat.webhooks.telegram(boundedRequest, { waitUntil });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return Response.json({ error: "Payload too large." }, { status: 413 });
    }

    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
        event: "chat.webhook_failed",
      })
    );
    return Response.json(
      { error: "Webhook processing failed." },
      { status: 500 }
    );
  }
}
