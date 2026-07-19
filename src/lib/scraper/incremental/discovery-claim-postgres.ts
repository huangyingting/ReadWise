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

const log = createLogger("scraper");

type ClaimedSourceRow = {
  id: string;
  wasStale: boolean;
};

/**
 * Claims one due discovery source on PostgreSQL. Enum labels are inlined as
 * string literals (constants, not user input) so PostgreSQL resolves them to the
 * native enum type; dynamic values (`workerId`, timestamps) are bound.
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
        AND "lifecycleMode" IN (
          'SHADOW'::"DiscoverySourceLifecycleMode",
          'BASELINE'::"DiscoverySourceLifecycleMode",
          'ACTIVE'::"DiscoverySourceLifecycleMode"
        )
        AND "automationPolicy" IN (
          'SCHEDULED'::"DiscoveryAutomationPolicy",
          'CONTINUOUS'::"DiscoveryAutomationPolicy"
        )
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
