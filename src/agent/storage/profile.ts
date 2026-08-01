import type { AgentSqlHost } from "@/agent/storage/sql";
import type { OwnerProfile, OwnerProfileUpdate } from "@/agent/types";

type ProfileRow = {
  owner_name: string | null;
  agent_name: string | null;
  time_zone: string | null;
  updated_at: number;
};

function toOwnerProfile(row: ProfileRow | undefined): OwnerProfile {
  return {
    ownerName: row?.owner_name ?? null,
    agentName: row?.agent_name ?? null,
    timeZone: row?.time_zone ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

export function getStoredProfile(host: AgentSqlHost): OwnerProfile {
  const rows = host.sql<ProfileRow>`
    SELECT owner_name, agent_name, time_zone, updated_at
    FROM owner_profile
    WHERE id = 1
    LIMIT 1
  `;
  return toOwnerProfile(rows[0]);
}

export function updateStoredProfile(
  host: AgentSqlHost,
  update: OwnerProfileUpdate,
): OwnerProfile {
  if (
    update.ownerName === undefined &&
    update.agentName === undefined &&
    update.timeZone === undefined
  ) {
    return getStoredProfile(host);
  }

  const now = Date.now();
  const rows = host.sql<ProfileRow>`
    INSERT INTO owner_profile (
      id,
      owner_name,
      agent_name,
      time_zone,
      updated_at
    )
    VALUES (
      1,
      ${update.ownerName ?? null},
      ${update.agentName ?? null},
      ${update.timeZone ?? null},
      ${now}
    )
    ON CONFLICT(id) DO UPDATE SET
      owner_name = COALESCE(excluded.owner_name, owner_profile.owner_name),
      agent_name = COALESCE(excluded.agent_name, owner_profile.agent_name),
      time_zone = COALESCE(excluded.time_zone, owner_profile.time_zone),
      updated_at = excluded.updated_at
    RETURNING owner_name, agent_name, time_zone, updated_at
  `;
  return toOwnerProfile(rows[0]);
}
