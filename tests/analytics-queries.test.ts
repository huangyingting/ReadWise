/**
 * Analytics aggregation tests (RW-052). The pure aggregation functions
 * (`computeOverview`, `computeRetentionCohorts`) are tested directly on
 * synthetic events; the DB loaders are tested with an INJECTED fake client +
 * segment resolver (no real DB). `@/lib/prisma` is mocked so importing the
 * module never touches a database.
 */
process.env.LOG_LEVEL = "error";

import { test, before, mock } from "node:test";
import assert from "node:assert/strict";

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: { prisma: {} },
  });
});

type Stat = { type: string; userId: string | null; count: number };

function stat(type: string, users: string[]): Stat[] {
  return users.map((u) => ({ type, userId: u, count: 1 }));
}

test("computeOverview builds a descending funnel of distinct users", async () => {
  const { computeOverview } = await import("@/lib/analytics-queries");
  const stats: Stat[] = [
    ...stat("onboarding_complete", ["u1", "u2", "u3", "u4"]),
    ...stat("article_view", ["u1", "u2", "u3"]),
    ...stat("progress_complete", ["u2"]),
    ...stat("save_word", ["u1", "u2"]),
    ...stat("quiz_complete", ["u1"]),
    ...stat("study_review", ["u1"]),
  ];
  const overview = computeOverview(stats);

  assert.deepEqual(
    overview.funnel.map((s) => s.users),
    [4, 3, 2, 1, 1],
  );
  // Stage conversions from the start.
  assert.equal(overview.funnel[0].conversionFromStartPct, 100);
  assert.equal(overview.funnel[1].conversionFromStartPct, 75);
  assert.equal(overview.funnel[2].conversionFromStartPct, 50);

  // Activation: onboarded ∩ readers = 3/4.
  assert.equal(overview.activation.numerator, 3);
  assert.equal(overview.activation.denominator, 4);
  assert.equal(overview.activation.ratePct, 75);

  // Reading completion: readers ∩ completers = 1/3.
  assert.equal(overview.readingCompletion.numerator, 1);
  assert.equal(overview.readingCompletion.denominator, 3);
  assert.equal(overview.readingCompletion.ratePct, 33.3);

  // Study conversion: savers ∩ reviewers = 1/2.
  assert.equal(overview.studyConversion.ratePct, 50);

  assert.equal(overview.totals.users, 4);
});

test("computeOverview handles an empty stream without dividing by zero", async () => {
  const { computeOverview } = await import("@/lib/analytics-queries");
  const overview = computeOverview([]);
  assert.equal(overview.totals.events, 0);
  assert.equal(overview.activation.ratePct, 0);
  assert.equal(overview.funnel[0].users, 0);
});

test("computeRetentionCohorts groups users by first-active week", async () => {
  const { computeRetentionCohorts } = await import("@/lib/analytics-queries");
  const now = new Date("2026-06-22T00:00:00Z"); // a Monday
  const ev = (userId: string, date: string) => ({
    userId,
    occurredAt: new Date(`${date}T12:00:00Z`),
  });
  const events = [
    ev("A", "2026-06-01"), // week 0
    ev("A", "2026-06-15"), // week 2
    ev("B", "2026-06-01"), // week 0
    ev("B", "2026-06-08"), // week 1
    ev("C", "2026-06-15"), // week 2
  ];
  const cohorts = computeRetentionCohorts(events, { now, weeks: 4 });

  // Cohort indexed by first week.
  const c0 = cohorts.find((c) => c.cohortWeek === "2026-06-01")!;
  assert.equal(c0.size, 2); // A + B
  assert.equal(c0.cells[0].pct, 100); // both active week 0
  assert.equal(c0.cells[1].pct, 50); // only B in week 1
  assert.equal(c0.cells[2].pct, 50); // only A in week 2
  assert.equal(c0.cells[3].pct, 0); // neither in week 3

  const c2 = cohorts.find((c) => c.cohortWeek === "2026-06-15")!;
  assert.equal(c2.size, 1); // C only
  assert.equal(c2.cells[0].pct, 100);
});

test("getAnalyticsOverview groups events and respects an empty segment", async () => {
  const { getAnalyticsOverview } = await import("@/lib/analytics-queries");
  let groupByArgs: unknown = null;
  const client = {
    analyticsEvent: {
      groupBy: async (args: unknown) => {
        groupByArgs = args;
        return [
          { type: "onboarding_complete", userId: "u1", _count: { _all: 1 } },
          { type: "article_view", userId: "u1", _count: { _all: 2 } },
        ];
      },
    },
  };

  // No segment → no user filter, groupBy called.
  const overview = await getAnalyticsOverview({
    client: client as never,
    since: new Date("2026-06-01"),
  });
  assert.equal(overview.segmentUserCount, null);
  assert.equal(overview.funnel[0].users, 1);
  assert.ok(groupByArgs);

  // A segment that resolves to nobody short-circuits to an empty overview.
  const empty = await getAnalyticsOverview({
    client: client as never,
    segment: { level: "C2" },
    resolveSegment: async () => [],
  });
  assert.equal(empty.segmentUserCount, 0);
  assert.equal(empty.totals.events, 0);
});

test("resolveSegmentUserIds filters profiles by level and topic", async () => {
  const { resolveSegmentUserIds } = await import("@/lib/analytics-queries");
  const profiles = [
    { userId: "u1", englishLevel: "B1", topics: JSON.stringify(["science", "tech"]) },
    { userId: "u2", englishLevel: "B1", topics: JSON.stringify(["health"]) },
    { userId: "u3", englishLevel: "C1", topics: JSON.stringify(["science"]) },
  ];
  const client = {
    profile: {
      findMany: async (args: { where?: { englishLevel?: string } }) => {
        const lvl = args.where?.englishLevel;
        return profiles
          .filter((p) => (lvl ? p.englishLevel === lvl : true))
          .map((p) => ({ userId: p.userId, topics: p.topics }));
      },
    },
  };

  // No segment → null (no filter).
  assert.equal(await resolveSegmentUserIds({}, client as never), null);

  // Level only.
  const byLevel = await resolveSegmentUserIds({ level: "B1" }, client as never);
  assert.deepEqual(byLevel, ["u1", "u2"]);

  // Topic only (across all levels).
  const byTopic = await resolveSegmentUserIds({ topic: "science" }, client as never);
  assert.deepEqual(byTopic, ["u1", "u3"]);

  // Level + topic.
  const both = await resolveSegmentUserIds({ level: "B1", topic: "science" }, client as never);
  assert.deepEqual(both, ["u1"]);
});
