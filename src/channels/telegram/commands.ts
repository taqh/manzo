import type { CardElement, Thread } from "chat";
import { capabilityIntroduction, helpMessage } from "@/agent/instructions";
import {
  draftCard,
  formatEmail,
  formatEmailList,
  toPendingDraft,
} from "@/channels/telegram/cards";
import { selectedEmailState } from "@/channels/telegram/operational-state";
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
