import { createEmailTools } from "@/agent/tools/email";
import { createMemoryTools } from "@/agent/tools/memory";
import type { PersonalToolContext } from "@/agent/tools/context";

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
