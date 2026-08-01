import type { AgentEnvironment } from "@/agent/types";

export const INBOX_AGENT_INSTANCE = "inbox";

export type DeploymentConfig = {
  defaultOutboundMailbox: string;
  managedMailboxes: Set<string>;
};

function normalizeMailbox(address: string): string {
  return address.trim().toLowerCase();
}

function isValidMailbox(address: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
}

function isPlaceholderMailbox(address: string): boolean {
  return (
    address === "agent@example.com" ||
    address.endsWith("@your-domain.example")
  );
}

export function getDeploymentConfig(env: AgentEnvironment): DeploymentConfig {
  const defaultOutboundMailbox = normalizeMailbox(
    env.DEFAULT_OUTBOUND_MAILBOX ?? "",
  );
  const managedMailboxes = new Set(
    (env.MANAGED_MAILBOXES ?? "")
      .split(",")
      .map(normalizeMailbox)
      .filter(Boolean),
  );

  if (!defaultOutboundMailbox || !isValidMailbox(defaultOutboundMailbox)) {
    throw new Error(
      "DEFAULT_OUTBOUND_MAILBOX must be a configured email address.",
    );
  }
  if (managedMailboxes.size === 0) {
    throw new Error(
      "MANAGED_MAILBOXES must contain at least one configured email address.",
    );
  }
  if ([defaultOutboundMailbox, ...managedMailboxes].some(isPlaceholderMailbox)) {
    throw new Error(
      "Replace the example mailbox placeholders in wrangler.jsonc before running Manzo.",
    );
  }
  if ([...managedMailboxes].some((address) => !isValidMailbox(address))) {
    throw new Error(
      "MANAGED_MAILBOXES must be a comma-separated list of valid email addresses.",
    );
  }
  if (!managedMailboxes.has(defaultOutboundMailbox)) {
    throw new Error(
      "DEFAULT_OUTBOUND_MAILBOX must also appear in MANAGED_MAILBOXES.",
    );
  }

  return { defaultOutboundMailbox, managedMailboxes };
}

export function isManagedMailbox(
  env: AgentEnvironment,
  address: string,
): boolean {
  try {
    return getDeploymentConfig(env).managedMailboxes.has(normalizeMailbox(address));
  } catch {
    return false;
  }
}
