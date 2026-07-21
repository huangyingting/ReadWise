process.env.LOG_LEVEL = "error";

import { before, mock, test } from "node:test";
import assert from "node:assert/strict";

import { CrawlCandidateStatus } from "@prisma/client";

before(() => {
  mock.module("@/lib/prisma", { namedExports: { prisma: {} } });
});

test("backfill query and commit derive reactivation branches from one status filter list", async () => {
  const { BACKFILL_REACTIVATION_STATUS_FILTERS, eligibleBackfillCandidateWhere } = await import(
    "@/lib/scraper/incremental/backfill-query"
  );

  assert.deepEqual(BACKFILL_REACTIVATION_STATUS_FILTERS, [
    { status: CrawlCandidateStatus.BASELINE },
    { status: CrawlCandidateStatus.DISCOVERED, observedInBaseline: false },
    { status: CrawlCandidateStatus.SKIPPED_OUTSIDE_WINDOW },
  ]);

  const where = eligibleBackfillCandidateWhere(
    { providerKey: "fixture", discoverySourceId: "source-1" },
    {
      windowStart: new Date("2026-07-01T00:00:00.000Z"),
      windowEnd: new Date("2026-07-02T00:00:00.000Z"),
      maxItems: 100,
    },
  );

  assert.deepEqual(where.OR, [...BACKFILL_REACTIVATION_STATUS_FILTERS]);
});

test("PostgreSQL discovery claim enum SQL literals match scheduler constants", async () => {
  const schedule = await import("@/lib/scraper/incremental/schedule");
  const postgresClaim = await import("@/lib/scraper/incremental/discovery-claim-postgres");

  assert.deepEqual(
    postgresClaim.POSTGRES_CLAIMABLE_LIFECYCLE_MODE_LITERALS,
    schedule.CLAIMABLE_LIFECYCLE_MODES.map(
      (mode) => `'${mode}'::"DiscoverySourceLifecycleMode"`,
    ),
  );
  assert.deepEqual(
    postgresClaim.POSTGRES_AUTO_CLAIM_POLICY_LITERALS,
    schedule.AUTO_CLAIM_POLICIES.map((policy) => `'${policy}'::"DiscoveryAutomationPolicy"`),
  );
});
