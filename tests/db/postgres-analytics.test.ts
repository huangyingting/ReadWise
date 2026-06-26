/**
 * PostgreSQL integration tests for analyticsEvent retention (pruneOldEvents).
 *
 * Inserts events at 30/90 days ago and now, calls pruneOldEvents(60), and
 * asserts exactly 1 row is removed with 2 remaining.
 *
 * Guarded by `enabled` (RUN_DB_INTEGRATION=1) + a PostgreSQL DATABASE_URL.
 * Skips cleanly under plain `npm test`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { prisma } from "@/lib/prisma";
import { pruneOldEvents } from "@/lib/analytics/events/retention";

import { enabled, isPostgres } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";

registerIntegrationCleanup();

test(
  "pruneOldEvents deletes events older than the window and retains recent ones",
  { skip: !enabled },
  async () => {
    assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

    const userId = id("analytics_ret_user");
    await prisma.user.create({ data: { id: userId, name: "DB Integration Analytics Retention User" } });

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);

    await prisma.analyticsEvent.createMany({
      data: [
        { type: "page_view", userId, occurredAt: ninetyDaysAgo }, // > 60 days → should be pruned
        { type: "page_view", userId, occurredAt: thirtyDaysAgo }, // < 60 days → should remain
        { type: "page_view", userId, occurredAt: now },           // now → should remain
      ],
    });

    assert.equal(
      await prisma.analyticsEvent.count({ where: { userId } }),
      3,
      "3 events should exist before pruning",
    );

    const deleted = await pruneOldEvents(60, prisma, now);

    assert.equal(deleted, 1, "exactly 1 event (90-day-old) should be pruned");
    assert.equal(
      await prisma.analyticsEvent.count({ where: { userId } }),
      2,
      "2 events should remain after pruning",
    );
  },
);
