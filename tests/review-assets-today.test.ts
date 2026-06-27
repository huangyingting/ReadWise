/**
 * Review assets — Today reflection bonus is OPTIONAL, SKIPPABLE, and NON-BLOCKING
 * (#812, Today v1.1).
 *
 * Pure tests (no database): prove the "write one sentence after reading" bonus
 * is purely additive in the Today view model and that it can NEVER influence the
 * completion tier engine. The completion functions don't even accept a
 * reflection input — so non-blocking is guaranteed by construction — and the
 * view model exposes the bonus without touching steps/progress/cta/status.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTodayViewModel,
  type TodayArticleDisplays,
} from "@/lib/engagement/today-session/view-model";
import {
  computeCompletionTier,
  isBestAvailableComplete,
  deriveCompletionState,
  type CompletionInputs,
} from "@/lib/engagement/today-session/completion";
import {
  TODAY_REFLECTION_PROMPT,
  type TodaySessionView,
} from "@/lib/engagement/today-session/types";
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
    backupArticleIds: [],
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

const displays = (primaryId: string | null): TodayArticleDisplays => ({
  primary: primaryId ? card(primaryId) : null,
  backups: [],
});

// ---------------------------------------------------------------------------
// View-model: the bonus is additive
// ---------------------------------------------------------------------------

test("reflection bonus is not offered until reading is complete", () => {
  const vm = buildTodayViewModel(makeSession(), "UTC", displays("a1"));
  assert.equal(vm.reflectionBonus.available, false);
  assert.equal(vm.reflectionBonus.label, TODAY_REFLECTION_PROMPT);
});

test("reflection bonus is offered once reading is complete", () => {
  const vm = buildTodayViewModel(
    makeSession({ readingCompletedAt: new Date("2026-06-27T01:00:00Z") }),
    "UTC",
    displays("a1"),
  );
  assert.equal(vm.reflectionBonus.available, true);
});

test("reflection bonus does NOT change progress, steps, cta, or status", () => {
  // A fully completed day, with NO reflection involved at all.
  const completed = makeSession({
    status: "completed",
    completionTier: "comprehension",
    readingCompletedAt: new Date("2026-06-27T01:00:00Z"),
    comprehensionCompletedAt: new Date("2026-06-27T02:00:00Z"),
    completedAt: new Date("2026-06-27T02:00:00Z"),
  });
  const vm = buildTodayViewModel(completed, "UTC", displays("a1"));

  // The session is already complete regardless of any reflection.
  assert.equal(vm.status, "completed");
  assert.equal(vm.completionTier, "comprehension");
  assert.equal(vm.cta.kind, "completed");
  // Progress is derived purely from the reading/comprehension/word-review steps.
  assert.deepEqual(vm.progress, { completedSteps: 2, totalSteps: 2 });
  // The bonus is present and offered, but it lives outside the progress tally.
  assert.equal(vm.reflectionBonus.available, true);
});

// ---------------------------------------------------------------------------
// Completion engine: a reflection can never affect the tier (by construction)
// ---------------------------------------------------------------------------

test("completion engine ignores reflections — best-available completion stands", () => {
  // No target words → reading + comprehension is the best available tier.
  const inputs: CompletionInputs = {
    reading: true,
    comprehension: true,
    wordReview: false,
    hasTargetWords: false,
  };
  assert.equal(computeCompletionTier(inputs), "comprehension");
  assert.equal(isBestAvailableComplete(inputs), true);

  const decision = deriveCompletionState(
    { completionTier: "none", status: "active", completedAt: null },
    inputs,
    new Date("2026-06-27T03:00:00Z"),
  );
  // The day completes on reading + comprehension alone — writing (or skipping)
  // a reflection sentence plays no part in this decision.
  assert.equal(decision.status, "completed");
  assert.equal(decision.completionTier, "comprehension");
});

test("skipping the reflection never blocks completion", () => {
  // Reading + comprehension done, reflection intentionally skipped (not modeled
  // in CompletionInputs at all) → the session still completes.
  const inputs: CompletionInputs = {
    reading: true,
    comprehension: true,
    wordReview: false,
    hasTargetWords: false,
  };
  assert.equal(isBestAvailableComplete(inputs), true);
});
