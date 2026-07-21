/**
 * PostgreSQL DiscoverySource claim adapter (issue #1087, Phase 1.7).
 *
 * Uses `FOR UPDATE SKIP LOCKED` for safe concurrent claiming across workers —
 * the same pattern as `src/lib/jobs/claim-postgres.ts`. The atomic
 * `UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED) … RETURNING` ensures two
 * concurrent workers can never claim the same source. An expired lease
 * (`leaseExpiresAt < now`) is reclaimable so a crashed worker never strands a
 * source.
 */
import { Prisma, type DiscoverySource } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/observability/logger";

import type { ClaimedDiscoverySource } from "./discovery-claim";
import { AUTO_CLAIM_POLICIES, CLAIMABLE_LIFECYCLE_MODES } from "./schedule";

const log = createLogger("scraper");

type ClaimedSourceRow = {
  id: string;
  wasStale: boolean;
};

function enumSqlLiterals(values: readonly string[], enumType: string): readonly string[] {
  return values.map((value) => `'${value.replaceAll("'", "''")}'::"${enumType}"`);
}

export const POSTGRES_CLAIMABLE_LIFECYCLE_MODE_LITERALS = enumSqlLiterals(
  CLAIMABLE_LIFECYCLE_MODES,
  "DiscoverySourceLifecycleMode",
);
export const POSTGRES_AUTO_CLAIM_POLICY_LITERALS = enumSqlLiterals(
  AUTO_CLAIM_POLICIES,
  "DiscoveryAutomationPolicy",
);

const CLAIMABLE_LIFECYCLE_MODES_SQL = Prisma.join(
  POSTGRES_CLAIMABLE_LIFECYCLE_MODE_LITERALS.map((literal) => Prisma.raw(literal)),
);
const AUTO_CLAIM_POLICIES_SQL = Prisma.join(
  POSTGRES_AUTO_CLAIM_POLICY_LITERALS.map((literal) => Prisma.raw(literal)),
);

/**
 * Claims one due discovery source on PostgreSQL. Enum labels are inlined as
 * scheduler constants and cast to the native enum type, so the PostgreSQL claim
 * predicate cannot drift from the generic Prisma predicate.
 */
export async function claimDueDiscoverySourcePostgres(
  workerId: string,
  now: Date,
  leaseExpiresAt: Date,
): Promise<ClaimedDiscoverySource | null> {
  const rows = await prisma.$queryRaw<ClaimedSourceRow[]>(Prisma.sql`
    UPDATE "DiscoverySource" AS d SET
      "leaseOwner" = ${workerId},
      "leaseAcquiredAt" = ${now},
      "leaseExpiresAt" = ${leaseExpiresAt},
      "updatedAt" = ${now}
    FROM (
      SELECT "id", "leaseOwner", "leaseExpiresAt"
      FROM "DiscoverySource"
      WHERE "nextRunAt" <= ${now}
        AND "lifecycleMode" IN (${CLAIMABLE_LIFECYCLE_MODES_SQL})
        AND "automationPolicy" IN (${AUTO_CLAIM_POLICIES_SQL})
        AND ("leaseOwner" IS NULL OR "leaseExpiresAt" < ${now})
        AND ("backoffUntil" IS NULL OR "backoffUntil" <= ${now})
      ORDER BY "nextRunAt" ASC, "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    ) AS picked
    WHERE d."id" = picked."id"
    RETURNING d."id" AS "id",
      (picked."leaseOwner" IS NOT NULL AND picked."leaseExpiresAt" < ${now}) AS "wasStale"
  `);

  if (rows.length === 0) return null;
  const row = rows[0];
  const source = await prisma.discoverySource.findUnique({ where: { id: row.id } });
  if (!source) return null;
  if (row.wasStale) recordStaleReclaim(source);
  return { source, wasStale: row.wasStale };
}

function recordStaleReclaim(source: DiscoverySource): void {
  log.warn("recovered stale discovery-source lease", {
    sourceId: source.id,
    definitionVersion: source.definitionVersion,
  });
}
