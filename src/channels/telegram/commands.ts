import type { CardElement, Thread } from "chat";
import { capabilityIntroduction, helpMessage } from "@/agent/instructions";
import {
  draftCard,
  formatEmail,
  formatEmailList,
  toPendingDraft,
} from "@/channels/telegram/cards";
import { selectedEmailState } from "@/channels/telegram/operational-state";
import type { PersonalMemory } from "@/agent/types";
import type {
  PersonalAgentActions,
  PersonalThreadState,
} from "@/channels/telegram/types";

export type Command = {
  name: string;
  arguments: string;
};

type CommandResult = {
  content: string | CardElement;
  state?: Partial<PersonalThreadState>;
};

export function parseCommand(text: string): Command | null {
  const match = text
    .trim()
    .match(/^\/([a-z][a-z0-9_]*)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i);

  if (!match?.[1]) {
    return null;
  }

  return {
    name: `/${match[1].toLowerCase()}`,
    arguments: match[2]?.trim() ?? "",
  };
}

function hasUploadedAttachmentIntent(text: string): boolean {
  return /\b(?:attach|include|use|with)\b[\s\S]{0,100}\b(?:file|files|document|documents|pdf|image|images|photo|photos|resume|cv|this|these)\b/i.test(
    text,
  );
}

function formatMemories(memories: PersonalMemory[]): string {
  if (memories.length === 0) {
    return "I don’t have any saved generic memories. Profile details such as your name, my name, and your timezone are stored separately.";
  }

  const lines = ["Saved generic memories:"];
  for (const memory of memories) {
    const line = `• ${memory.key}: ${memory.value}`;
    if ([...lines, line].join("\n").length > 3_500) {
      lines.push("• More memories are saved but not shown here.");
      break;
    }
    lines.push(line);
  }
  lines.push(
    "",
    "Use /memory forget <key> or /memory set <key> <value> to manage one.",
  );
  return lines.join("\n");
}

function isProfileMemoryKey(key: string): boolean {
  return /(?:^|[_ -])(?:name|owner|agent|timezone|time zone)(?:$|[_ -])/i.test(
    key,
  );
}

async function executeCommand(
  agent: PersonalAgentActions,
  command: Command,
  pendingAttachmentIds: string[] = [],
): Promise<CommandResult> {
  if (command.name === "/start") {
    return { content: capabilityIntroduction(await agent.getProfile()) };
  }

  if (command.name === "/help") {
    return { content: helpMessage() };
  }

  if (command.name === "/memory") {
    const [subcommand, ...rest] = command.arguments.split(/\s+/).filter(Boolean);
    const argument = rest.join(" ").trim();

    if (!subcommand || subcommand === "list") {
      return { content: formatMemories(await agent.listMemories()) };
    }

    if (subcommand === "forget" || subcommand === "delete") {
      if (!argument) {
        return { content: "Usage: /memory forget <key>" };
      }
      const forgotten = await agent.forgetMemory(argument);
      return {
        content: forgotten
          ? `Forgot the saved memory “${argument}”.`
          : `I couldn’t find a saved memory with the key “${argument}”.`,
      };
    }

    if (subcommand === "clear") {
      const count = await agent.clearMemories();
      return {
        content:
          count > 0
            ? `Cleared ${count} saved generic ${count === 1 ? "memory" : "memories"}. Profile details were not changed.`
            : "There were no saved generic memories to clear. Profile details were not changed.",
      };
    }

    if (subcommand === "set" || subcommand === "update") {
      const separator = argument.indexOf(" ");
      if (separator < 1 || !argument.slice(separator + 1).trim()) {
        return { content: "Usage: /memory set <key> <value>" };
      }
      const key = argument.slice(0, separator).trim();
      const value = argument.slice(separator + 1).trim();
      if (isProfileMemoryKey(key)) {
        return {
          content:
            "Names and timezone are profile details. Update them with “My name is …”, “Your name is …”, or “My timezone is Region/City”.",
        };
      }
      const memory = await agent.remember(key, value);
      return { content: `Saved memory “${memory.key}”: ${memory.value}` };
    }

    return {
      content:
        "Usage: /memory, /memory set <key> <value>, /memory forget <key>, or /memory clear",
    };
  }

  if (command.name === "/latest") {
    const emails = await agent.listEmails(10);
    return {
      content: formatEmailList(emails),
      state: { presentedEmailIds: emails.map((email) => email.shortId) },
    };
  }

  if (command.name === "/read") {
    if (!command.arguments) {
      return { content: "Usage: /read <email-id>" };
    }

    const email = await agent.readEmail(command.arguments);
    return email
      ? {
          content: formatEmail(email),
          state: selectedEmailState(email.shortId),
        }
      : { content: `Email ${command.arguments} was not found.` };
  }

  if (command.name === "/draft") {
    const firstSpace = command.arguments.indexOf(" ");

    if (firstSpace < 1) {
      return {
        content: "Usage: /draft <email-id> <the exact reply you want to send>",
      };
    }

    const emailReference = command.arguments.slice(0, firstSpace);
    const body = command.arguments.slice(firstSpace + 1).trim();
    const attachmentIds = hasUploadedAttachmentIntent(body)
      ? pendingAttachmentIds
      : [];
    const draft = await agent.createDraft(
      emailReference,
      body,
      attachmentIds,
    );
    return {
      content: draftCard(draft),
      state: {
        activeEmailId:
          draft.kind === "reply" ? draft.emailShortId : emailReference,
        pendingDraft: toPendingDraft(draft),
        pendingAttachmentIds: pendingAttachmentIds.filter(
          (attachmentId) => !attachmentIds.includes(attachmentId),
        ),
      },
    };
  }

  return {
    content: "I don’t recognize that command. Try /help to see what I can do.",
  };
}

export async function postCommandResult(
  target: Thread<PersonalThreadState>,
  agent: PersonalAgentActions,
  command: Command,
  newlyUploadedAttachmentIds: string[] = [],
): Promise<void> {
  try {
    const state = (await target.state) as PersonalThreadState | null;
    const pendingAttachmentIds = [
      ...new Set([
        ...(state?.pendingAttachmentIds ?? []),
        ...newlyUploadedAttachmentIds,
      ]),
    ];
    const result = await executeCommand(agent, command, pendingAttachmentIds);
    await target.post(result.content);
    await target.setState({
      ...result.state,
      pendingAttachmentIds:
        result.state?.pendingAttachmentIds ?? pendingAttachmentIds,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "chat.command_failed",
        command: command.name,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    await target.post(
      "That command failed. Check the Worker logs and try again.",
    );
  }
}
