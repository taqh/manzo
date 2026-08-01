import { getAgentByName, routeAgentEmail } from "agents";
import { createCatchAllEmailResolver } from "agents/email";
import { Hono } from "hono";
import {
  getDeploymentConfig,
  INBOX_AGENT_INSTANCE,
  isManagedMailbox,
} from "@/agent/config";
import type { AgentEnvironment } from "@/agent/types";

export { ChatSdkStateAgent } from "agents/chat-sdk";
export { InboxAgent } from "@/agent/agent";

const app = new Hono<{ Bindings: AgentEnvironment }>();

app.get("/", (context) => {
  let configurationError: string | null = null;
  try {
    getDeploymentConfig(context.env);
  } catch (error) {
    configurationError =
      error instanceof Error
        ? error.message
        : "Worker configuration is invalid.";
  }

  return context.json(
    {
      ai: Boolean(context.env.AI),
      configurationError,
      email: configurationError ? "not_configured" : "ready",
      model: context.env.AI_MODEL,
      name: "Manzo inbox agent",
      status: configurationError ? "configuration_required" : "ok",
      telegram: Boolean(
        context.env.TELEGRAM_BOT_TOKEN &&
          context.env.TELEGRAM_CHAT_ID &&
          context.env.TELEGRAM_WEBHOOK_SECRET
      ),
    },
    configurationError ? 503 : 200
  );
});

app.post("/webhooks/telegram", async (context) => {
  const agent = await getAgentByName(
    context.env.InboxAgent,
    INBOX_AGENT_INSTANCE
  );

  return agent.handleTelegramWebhook(context.req.raw);
});

export default {
  async email(
    message: ForwardableEmailMessage,
    env: AgentEnvironment
  ): Promise<void> {
    if (!isManagedMailbox(env, message.to)) {
      let reason = "Inbox address is not configured.";
      try {
        getDeploymentConfig(env);
      } catch (error) {
        reason =
          error instanceof Error
            ? `Worker configuration is incomplete: ${error.message}`
            : "Worker configuration is incomplete.";
      }
      message.setReject(reason);
      return;
    }

    await routeAgentEmail(message, env, {
      resolver: createCatchAllEmailResolver("InboxAgent", INBOX_AGENT_INSTANCE),
    });
  },
  fetch: app.fetch,
} satisfies ExportedHandler<AgentEnvironment>;
