import { DEFAULT_TIME_ZONE } from "./time.ts";
import type { OwnerProfileUpdate } from "./types.ts";

const MAX_NAME_LENGTH = 80;

function containsQuotedEmail(message: string): boolean {
  return /^(?:>|from:|to:|subject:|date:|on .+wrote:)/im.test(message);
}

function cleanName(value: string | undefined): string | null {
  const name = value?.trim().replace(/\s+/g, " ") ?? "";
  if (
    !name ||
    name.length > MAX_NAME_LENGTH ||
    !/^[\p{L}\p{M}][\p{L}\p{M}' -]*$/u.test(name)
  ) {
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
  const candidate = message.match(
    /\b(?:my\s+)?time\s*zone\s*(?:is|:|=)\s*([A-Za-z_+-]+\/[A-Za-z_+\-/]+)/i,
  )?.[1];
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
  message: string,
): OwnerProfileUpdate {
  if (containsQuotedEmail(message)) {
    return {};
  }

  const update: OwnerProfileUpdate = {};
  const ownerName = cleanName(
    message.match(/\b(?:my name is|call me)\s+([^\n,.!?]{1,80})/i)?.[1],
  );
  const agentName = cleanName(
    message.match(/\b(?:your name is|call yourself)\s+([^\n,.!?]{1,80})/i)?.[1],
  );
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
