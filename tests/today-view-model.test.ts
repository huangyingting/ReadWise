/**
 * Pure view-model tests for the Today learner surface (#796/#797/#798).
 *
 * Exercises `buildTodayViewModel` against fixtures with NO database access:
 * step derivation, progress counting, CTA selection, no-candidate / skipped /
 * completed states, word-review availability, and the privacy guarantee that
 * the payload carries only anchors/ids/safe display metadata.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTodayViewModel,
  type TodayArticleDisplays,
} from "@/lib/engagement/today-session/view-model";
import type { TodaySessionView } from "@/lib/engagement/today-session/types";
import type { ListingArticle } from "@/lib/article-library";

function card(id: string): ListingArticle {
  return {
    id,
    title: `Title ${id}`,
    author: null,
    source: null,
    category: "tech",
    difficulty: "B1",
    readingMinutes: 4,
    publishedAt: null,
    heroImage: null,
  };
}

function makeSession(overrides: Partial<TodaySessionView> = {}): TodaySessionView {
  return {
    id: "ts1",
    userId: "user-1",
    localDate: "2026-06-27",
    timezoneSnapshot: "UTC",
    primaryArticleId: "a1",
    backupArticleIds: ["b1", "b2"],
    targetSavedWordIds: [],
    reviewTargetCount: 0,
    status: "active",
    source: "picks",
    completionTier: "none",
    generationReasonCode: "picks_primary",
    readingCompletedAt: null,
    comprehensionCompletedAt: null,
    wordReviewCompletedAt: null,
    completedAt: null,
    skipped: false,
    skipReason: null,
    skippedAt: null,
    createdAt: new Date("2026-06-27T00:00:00Z"),
    updatedAt: new Date("2026-06-27T00:00:00Z"),
    ...overrides,
  };
}

const displays = (primaryId: string | null, backupIds: string[] = []): TodayArticleDisplays => ({
  primary: primaryId ? card(primaryId) : null,
  backups: backupIds.map(card),
});

test("fresh picks day → start CTA, reading available, no word review", () => {
  const vm = buildTodayViewModel(makeSession(), "UTC", displays("a1", ["b1"]));
  assert.equal(vm.cta.kind, "start");
  assert.equal(vm.cta.href, "/reader/a1");
  assert.equal(vm.steps.reading.state, "available");
  assert.equal(vm.steps.wordReview.state, "unavailable");
  assert.equal(vm.steps.wordReview.available, false);
  // word review unavailable → excluded from progress total
  assert.deepEqual(vm.progress, { completedSteps: 0, totalSteps: 2 });
  assert.equal(vm.isNoCandidate, false);
});

test("resume day → continue CTA", () => {
  const vm = buildTodayViewModel(
    makeSession({ source: "resume", generationReasonCode: "resume_in_progress" }),
    "UTC",
    displays("a1"),
  );
  assert.equal(vm.cta.kind, "continue");
});

test("with target words → word review step available and counted", () => {
  const vm = buildTodayViewModel(
    makeSession({ targetSavedWordIds: ["w1", "w2", "w3"], reviewTargetCount: 3 }),
    "UTC",
    displays("a1"),
  );
  assert.equal(vm.steps.wordReview.state, "available");
  assert.equal(vm.steps.wordReview.available, true);
  assert.equal(vm.steps.wordReview.targetCount, 3);
  assert.equal(vm.progress.totalSteps, 3);
});

test("reading complete advances progress and keeps continue CTA", () => {
  const vm = buildTodayViewModel(
    makeSession({ readingCompletedAt: new Date("2026-06-27T01:00:00Z"), completionTier: "reading" }),
    "UTC",
    displays("a1"),
  );
  assert.equal(vm.steps.reading.state, "complete");
  assert.equal(vm.cta.kind, "continue");
  assert.equal(vm.progress.completedSteps, 1);
});

test("completed day → completed CTA", () => {
  const vm = buildTodayViewModel(
    makeSession({
      status: "completed",
      completionTier: "comprehension",
      readingCompletedAt: new Date(),
      comprehensionCompletedAt: new Date(),
      completedAt: new Date("2026-06-27T02:00:00Z"),
    }),
    "UTC",
    displays("a1"),
  );
  assert.equal(vm.cta.kind, "completed");
  assert.ok(vm.completedAt);
});

test("skipped day → browse CTA", () => {
  const vm = buildTodayViewModel(
    makeSession({ status: "skipped", skipped: true, skipReason: "too_busy" }),
    "UTC",
    displays("a1"),
  );
  assert.equal(vm.cta.kind, "browse");
  assert.equal(vm.skipReason, "too_busy");
});

test("no-candidate day → browse CTA + isNoCandidate", () => {
  const vm = buildTodayViewModel(
    makeSession({ primaryArticleId: null, backupArticleIds: [], source: "none", generationReasonCode: "no_candidate" }),
    "UTC",
    displays(null),
  );
  assert.equal(vm.cta.kind, "browse");
  assert.equal(vm.isNoCandidate, true);
  assert.equal(vm.hasPrimary, false);
});

test("primary id present but unreadable → browse CTA, primaryReadable false", () => {
  const vm = buildTodayViewModel(makeSession({ primaryArticleId: "a1" }), "UTC", displays(null, ["b1"]));
  assert.equal(vm.hasPrimary, true);
  assert.equal(vm.primaryReadable, false);
  assert.equal(vm.cta.kind, "browse");
});

test("payload carries only safe display fields (no content)", () => {
  const vm = buildTodayViewModel(makeSession(), "UTC", displays("a1", ["b1"]));
  const json = JSON.stringify(vm);
  for (const forbidden of ["content", "explanation", "contextSentence", "definition", "prompt"]) {
    assert.ok(!json.includes(forbidden), `payload must not contain ${forbidden}`);
  }
  // The article cards expose only the known ListingArticle keys.
  const keys = Object.keys(vm.primaryArticle ?? {}).sort();
  assert.deepEqual(keys, [
    "author",
    "category",
    "difficulty",
    "heroImage",
    "id",
    "publishedAt",
    "readingMinutes",
    "source",
    "title",
  ]);
});
