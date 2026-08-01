import type { PersonalToolContext } from "@/agent/tools/context";
import { createEmailTools } from "@/agent/tools/email";
import { createMemoryTools } from "@/agent/tools/memory";

export function createAgentTools(context: PersonalToolContext) {
  return {
    ...createEmailTools(context),
    ...createMemoryTools(context),
  };
}

export {
  createPersonalToolContext,
  type PersonalAiHost,
  type PersonalToolContext,
} from "@/agent/tools/context";
