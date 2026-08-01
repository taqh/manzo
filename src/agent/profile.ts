import { DEFAULT_TIME_ZONE } from "./time.ts";
import type { OwnerProfileUpdate } from "./types.ts";

const MAX_NAME_LENGTH = 80;
const QUOTED_EMAIL_PATTERN = /^(?:>|from:|to:|subject:|date:|on .+wrote:)/im;
const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}' -]*$/u;
const TIME_ZONE_PATTERN =
  /\b(?:my\s+)?time\s*zone\s*(?:is|:|=)\s*([A-Za-z_+-]+\/[A-Za-z_+\-/]+)/i;
const OWNER_NAME_PATTERN = /\b(?:my name is|call me)\s+([^\n,.!?]{1,80})/i;
const AGENT_NAME_PATTERN =
  /\b(?:your name is|call yourself)\s+([^\n,.!?]{1,80})/i;

function containsQuotedEmail(message: string): boolean {
  return QUOTED_EMAIL_PATTERN.test(message);
}

function cleanName(value: string | undefined): string | null {
  const name = value?.trim().replace(/\s+/g, " ") ?? "";
  if (!name || name.length > MAX_NAME_LENGTH || !NAME_PATTERN.test(name)) {
    return null;
  }
  return name;
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value.includes("/") || value === DEFAULT_TIME_ZONE;
  } catch {
    return false;
  }
}

function explicitTimeZone(message: string): string | null {
  const candidate = message.match(TIME_ZONE_PATTERN)?.[1];
  if (!candidate) {
    return null;
  }
  return isValidTimeZone(candidate) ? candidate : null;
}

/**
 * Extracts only explicit profile declarations from one trusted Telegram message.
 * Email payloads and tool results never call this function.
 */
export function learnProfileFromTrustedTelegramMessage(
  message: string
): OwnerProfileUpdate {
  if (containsQuotedEmail(message)) {
    return {};
  }

  const update: OwnerProfileUpdate = {};
  const ownerName = cleanName(message.match(OWNER_NAME_PATTERN)?.[1]);
  const agentName = cleanName(message.match(AGENT_NAME_PATTERN)?.[1]);
  const timeZone = explicitTimeZone(message);

  if (ownerName) {
    update.ownerName = ownerName;
  }
  if (agentName) {
    update.agentName = agentName;
  }
  if (timeZone) {
    update.timeZone = timeZone;
  }
  return update;
}
