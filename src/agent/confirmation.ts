const SEND_CONFIRMATION_WORDS = new Set([
  "and",
  "ahead",
  "approve",
  "confirm",
  "draft",
  "email",
  "exact",
  "go",
  "good",
  "it",
  "just",
  "looks",
  "now",
  "ok",
  "okay",
  "please",
  "pls",
  "reply",
  "send",
  "sure",
  "thanks",
  "that",
  "the",
  "this",
  "yeah",
  "yep",
  "yes",
]);

export function isExplicitSendConfirmation(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
  if (!normalized || normalized.length > 100) {
    return false;
  }

  const words = normalized.split(" ");
  const hasAction =
    words.includes("send") ||
    words.includes("approve") ||
    words.includes("confirm") ||
    normalized.includes("go ahead");

  return hasAction && words.every((word) => SEND_CONFIRMATION_WORDS.has(word));
}
