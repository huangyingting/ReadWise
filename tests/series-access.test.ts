/**
 * Curated reading series — module access + lifecycle tests (#813).
 *
 * Prisma, the Article Library access helper, and the analytics writer are fully
 * mocked. Covers:
 *   - enroll/unenroll 404 for a non-public series (IDOR-safe);
 *   - ACCESS REVALIDATION: a private/inaccessible article id is never returned
 *     as a resolved series candidate and `nextIndex` advances past it;
 *   - `nextIndex` advance on completion (monotonic + idempotent) and end-of-
 *     series completion;
 *   - privacy: the `series_enrolled` analytics event carries id+slug anchors
 *     only (no article content / reading history).
 */
process.env.LOG_LEVEL = "error";

import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---- mutable mock state ----------------------------------------------------
let series: Record<string, unknown> | null = null;
let enrollment: Record<string, unknown> | null = null;
let accessibleIds: Set<string> = new Set();
const enrollmentUpdates: Array<Record<string, unknown>> = [];
const upserts: Array<Record<string, unknown>> = [];
const deletes: Array<Record<string, unknown>> = [];
const events: Array<Record<string, unknown>> = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      readingSeries: {
        findFirst: async () => series,
        findMany: async () => (series ? [series] : []),
      },
      seriesEnrollment: {
        findFirst: async () => enrollment,
        findMany: async () => (enrollment ? [enrollment] : []),
        findUnique: async () => enrollment,
        upsert: async (args: Record<string, unknown>) => {
          upserts.push(args);
          return enrollment ?? { id: "e1" };
        },
        update: async (args: { data: Record<string, unknown> }) => {
          enrollmentUpdates.push(args.data);
          if (enrollment) Object.assign(enrollment, args.data);
          return enrollment ?? {};
        },
        deleteMany: async (args: Record<string, unknown>) => {
          deletes.push(args);
          return { count: 1 };
        },
      },
    },
  },
});

mock.module("@/lib/article-library/policy", {
  namedExports: {
    getPublicListableArticleById: async (id: string) =>
      accessibleIds.has(id) ? { id } : null,
  },
});

mock.module("@/lib/analytics/events", {
  namedExports: {
    ANALYTICS_EVENT_TYPES: { seriesEnrolled: "series_enrolled" },
    recordEvent: async (e: Record<string, unknown>) => {
      events.push(e);
    },
  },
});

beforeEach(() => {
  series = null;
  enrollment = null;
  accessibleIds = new Set();
  enrollmentUpdates.length = 0;
  upserts.length = 0;
  deletes.length = 0;
  events.length = 0;
});

const importSeries = () => import("@/lib/engagement/series");

// ---------------------------------------------------------------------------
// Enroll / unenroll
// ---------------------------------------------------------------------------

test("enrollInSeries: non-public series → not_found (no upsert, no event)", async () => {
  const { enrollInSeries } = await importSeries();
  series = null; // getPublicSeries → findFirst returns null
  const result = await enrollInSeries("u1", "s-hidden");
  assert.deepEqual(result, { ok: false, reason: "not_found" });
  assert.equal(upserts.length, 0);
  assert.equal(events.length, 0);
});

test("enrollInSeries: public series → upsert + privacy-safe analytics event", async () => {
  const { enrollInSeries } = await importSeries();
  series = { id: "s1", slug: "7-days-tech" };
  const result = await enrollInSeries("u1", "s1");
  assert.equal(result.ok, true);
  assert.equal(upserts.length, 1);
  assert.equal(events.length, 1);
  // Privacy: only id + slug anchors, no article content / reading history.
  assert.deepEqual(events[0].properties, { seriesId: "s1", seriesSlug: "7-days-tech" });
  const keys = Object.keys(events[0].properties as object);
  assert.ok(!keys.some((k) => /article|word|text|title|wpm|history/i.test(k)));
});

test("unenrollFromSeries: non-public series → not_found", async () => {
  const { unenrollFromSeries } = await importSeries();
  series = null;
  const result = await unenrollFromSeries("u1", "missing");
  assert.deepEqual(result, { ok: false, reason: "not_found" });
  assert.equal(deletes.length, 0);
});

test("unenrollFromSeries: public series → deletes the enrollment", async () => {
  const { unenrollFromSeries } = await importSeries();
  series = { id: "s1", slug: "x" };
  const result = await unenrollFromSeries("u1", "s1");
  assert.equal(result.ok, true);
  assert.equal(deletes.length, 1);
});

// ---------------------------------------------------------------------------
// Access revalidation — private articles never surface as candidates
// ---------------------------------------------------------------------------

test("resolveNextSeriesArticle: skips a PRIVATE article and advances nextIndex past it", async () => {
  const { resolveNextSeriesArticle } = await importSeries();
  enrollment = {
    id: "e1",
    seriesId: "s1",
    nextIndex: 0,
    series: { id: "s1", status: "active", public: true, articleIds: ["a-priv", "a-pub"] },
  };
  accessibleIds = new Set(["a-pub"]); // a-priv is NOT public-listable

  const resolved = await resolveNextSeriesArticle("u1");
  assert.ok(resolved);
  // The private id must NEVER be returned as a Today candidate.
  assert.notEqual(resolved!.articleId, "a-priv");
  assert.equal(resolved!.articleId, "a-pub");
  assert.equal(resolved!.index, 1);
  // nextIndex advanced past the inaccessible entry.
  assert.deepEqual(enrollmentUpdates.at(-1), { nextIndex: 1 });
});

test("resolveNextSeriesArticle: no active enrollment → null", async () => {
  const { resolveNextSeriesArticle } = await importSeries();
  enrollment = null;
  assert.equal(await resolveNextSeriesArticle("u1"), null);
});

test("resolveNextSeriesArticle: all inaccessible → completes the enrollment", async () => {
  const { resolveNextSeriesArticle } = await importSeries();
  enrollment = {
    id: "e1",
    seriesId: "s1",
    nextIndex: 0,
    series: { id: "s1", status: "active", public: true, articleIds: ["x", "y"] },
  };
  accessibleIds = new Set(); // none accessible
  const resolved = await resolveNextSeriesArticle("u1");
  assert.equal(resolved, null);
  const last = enrollmentUpdates.at(-1)!;
  assert.equal(last.status, "completed");
  assert.equal(last.nextIndex, 2);
});

test("resolveNextSeriesArticle: archived/non-public series is not surfaced", async () => {
  const { resolveNextSeriesArticle } = await importSeries();
  enrollment = {
    id: "e1",
    seriesId: "s1",
    nextIndex: 0,
    series: { id: "s1", status: "archived", public: false, articleIds: ["a-pub"] },
  };
  accessibleIds = new Set(["a-pub"]);
  assert.equal(await resolveNextSeriesArticle("u1"), null);
});

// ---------------------------------------------------------------------------
// nextIndex advance on completion
// ---------------------------------------------------------------------------

test("advanceSeriesOnArticleRead: advances nextIndex when the read primary is the series article", async () => {
  const { advanceSeriesOnArticleRead } = await importSeries();
  enrollment = {
    id: "e1",
    seriesId: "s1",
    nextIndex: 0,
    series: { id: "s1", status: "active", public: true, articleIds: ["a0", "a1"] },
  };
  accessibleIds = new Set(["a0", "a1"]);
  await advanceSeriesOnArticleRead("u1", "a0");
  // index 0 read → advances to 1 (not complete yet).
  const last = enrollmentUpdates.at(-1)!;
  assert.equal(last.nextIndex, 1);
  assert.notEqual(last.status, "completed");
});

test("advanceSeriesOnArticleRead: completing the last article marks the enrollment completed", async () => {
  const { advanceSeriesOnArticleRead } = await importSeries();
  enrollment = {
    id: "e1",
    seriesId: "s1",
    nextIndex: 1,
    series: { id: "s1", status: "active", public: true, articleIds: ["a0", "a1"] },
  };
  accessibleIds = new Set(["a0", "a1"]);
  await advanceSeriesOnArticleRead("u1", "a1");
  const last = enrollmentUpdates.at(-1)!;
  assert.equal(last.nextIndex, 2);
  assert.equal(last.status, "completed");
});

test("advanceSeriesOnArticleRead: idempotent — a non-current article does not advance", async () => {
  const { advanceSeriesOnArticleRead } = await importSeries();
  enrollment = {
    id: "e1",
    seriesId: "s1",
    nextIndex: 0,
    series: { id: "s1", status: "active", public: true, articleIds: ["a0", "a1"] },
  };
  accessibleIds = new Set(["a0", "a1"]);
  // The current series article is a0; completing a1 (not current) must not advance.
  await advanceSeriesOnArticleRead("u1", "a1");
  assert.equal(
    enrollmentUpdates.some((u) => u.nextIndex === 1 || u.status === "completed"),
    false,
  );
});
