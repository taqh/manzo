import type { AgentSqlHost } from "@/agent/storage/sql";
import type { PersonalMemory } from "@/agent/types";

const MAX_MEMORY_COUNT = 100;
const MAX_MEMORY_KEY_LENGTH = 80;
const MAX_MEMORY_VALUE_LENGTH = 1_000;

type MemoryRow = {
  key: string;
  value: string;
  created_at: number;
  updated_at: number;
};

function toPersonalMemory(row: MemoryRow): PersonalMemory {
  return {
    key: row.key,
    value: row.value,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listStoredMemories(host: AgentSqlHost): PersonalMemory[] {
  return host.sql<MemoryRow>`
    SELECT key, value, created_at, updated_at
    FROM memories
    ORDER BY updated_at DESC, key ASC
    LIMIT ${MAX_MEMORY_COUNT}
  `.map(toPersonalMemory);
}

export function rememberStoredMemory(
  host: AgentSqlHost,
  key: string,
  value: string,
): PersonalMemory {
  const normalizedKey = key.trim();
  const normalizedValue = value.trim();

  if (
    normalizedKey.length < 1 ||
    normalizedKey.length > MAX_MEMORY_KEY_LENGTH
  ) {
    throw new Error(
      `Memory keys must be between 1 and ${MAX_MEMORY_KEY_LENGTH} characters.`,
    );
  }
  if (
    normalizedValue.length < 1 ||
    normalizedValue.length > MAX_MEMORY_VALUE_LENGTH
  ) {
    throw new Error(
      `Memory values must be between 1 and ${MAX_MEMORY_VALUE_LENGTH} characters.`,
    );
  }

  const existing = host.sql<{ key: string }>`
    SELECT key FROM memories WHERE key = ${normalizedKey} LIMIT 1
  `;
  if (existing.length === 0) {
    const count = host.sql<{ count: number }>`
      SELECT COUNT(*) AS count FROM memories
    `[0]?.count ?? 0;

    if (count >= MAX_MEMORY_COUNT) {
      throw new Error("Memory is full. Forget an item before adding another one.");
    }
  }

  const now = Date.now();
  const rows = host.sql<MemoryRow>`
    INSERT INTO memories (key, value, created_at, updated_at)
    VALUES (${normalizedKey}, ${normalizedValue}, ${now}, ${now})
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
    RETURNING key, value, created_at, updated_at
  `;
  const memory = rows[0];
  if (!memory) {
    throw new Error("The memory could not be saved.");
  }

  return toPersonalMemory(memory);
}

export function forgetStoredMemory(host: AgentSqlHost, key: string): boolean {
  const deleted = host.sql<{ key: string }>`
    DELETE FROM memories
    WHERE key = ${key.trim()}
    RETURNING key
  `;
  return deleted.length > 0;
}

export function clearStoredMemories(host: AgentSqlHost): number {
  const deleted = host.sql<{ key: string }>`
    DELETE FROM memories
    RETURNING key
  `;
  return deleted.length;
}
