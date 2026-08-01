import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AUTO_CLAIM_POLICIES,
  CLAIMABLE_LIFECYCLE_MODES,
} from "@/lib/scraper/incremental/schedule";
import { buildDueDiscoverySourceWhere } from "@/lib/scraper/incremental/discovery-claim";

test("the shared discovery claim predicate requires due, eligible, unlocked, and unbacked-off state", () => {
  const now = new Date("2026-07-31T17:00:00.000Z");

  assert.deepEqual(buildDueDiscoverySourceWhere(now), {
    nextRunAt: { lte: now },
    lifecycleMode: { in: [...CLAIMABLE_LIFECYCLE_MODES] },
    automationPolicy: { in: [...AUTO_CLAIM_POLICIES] },
    AND: [
      { OR: [{ leaseOwner: null }, { leaseExpiresAt: { lt: now } }] },
      { OR: [{ backoffUntil: null }, { backoffUntil: { lte: now } }] },
    ],
  });
});
