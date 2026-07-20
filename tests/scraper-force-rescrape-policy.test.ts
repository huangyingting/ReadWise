/**
 * Pure force-rescrape policy tests (#1102, Phase 3.3).
 *
 * Exercises the decision core with NO database/network/clock: the per-target
 * eligibility pre-flight, the FAIL-CLOSED annotation-migration gate (the #1103
 * seam), and the ordered activation validation gate + its deterministic failure
 * precedence. These are the pure building blocks the runner/commit compose, so
 * they stay covered by the fast unit gate (`npm test`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { ArticleVisibility } from "@prisma/client";

import {
  FAILED_STATUS_REASONS,
  FORCE_RESCRAPE_FAILURE_REASONS,
  decideAnnotationMigrationGate,
  decideForceRescrapeActivation,
  decideForceRescrapeEligibility,
  type RescrapeValidationSignals,
} from "@/lib/scraper/incremental/force-rescrape-policy";

const ELIGIBLE_INPUT = {
  exists: true,
  visibility: ArticleVisibility.PUBLIC,
  hasSourceUrl: true,
  takedownState: "active",
};

const CLEAN_SIGNALS: RescrapeValidationSignals = {
  bodyPresent: true,
  canonical: "match",
  safety: "safe",
  quality: "pass",
};

// ---- eligibility ----------------------------------------------------------

test("eligibility: a public, active, url-bearing article is eligible", () => {
  assert.deepEqual(decideForceRescrapeEligibility(ELIGIBLE_INPUT), { eligible: true });
});

test("eligibility: a missing article is not-found", () => {
  const d = decideForceRescrapeEligibility({ ...ELIGIBLE_INPUT, exists: false });
  assert.deepEqual(d, { eligible: false, reason: "not-found" });
});

test("eligibility: a non-public article is not-public (private imports out of scope)", () => {
  for (const visibility of [ArticleVisibility.PRIVATE, ArticleVisibility.UNLISTED, ArticleVisibility.ORG, null]) {
    const d = decideForceRescrapeEligibility({ ...ELIGIBLE_INPUT, visibility });
    assert.deepEqual(d, { eligible: false, reason: "not-public" }, `visibility=${visibility}`);
  }
});

test("eligibility: an article with no source URL is missing-source-url", () => {
  const d = decideForceRescrapeEligibility({ ...ELIGIBLE_INPUT, hasSourceUrl: false });
  assert.deepEqual(d, { eligible: false, reason: "missing-source-url" });
});

test("eligibility: a non-active takedown state is taken-down", () => {
  for (const state of ["unpublished", "archived", "takedown"]) {
    const d = decideForceRescrapeEligibility({ ...ELIGIBLE_INPUT, takedownState: state });
    assert.deepEqual(d, { eligible: false, reason: "taken-down" }, `state=${state}`);
  }
});

test("eligibility: a null takedown state is treated as active (eligible)", () => {
  assert.deepEqual(
    decideForceRescrapeEligibility({ ...ELIGIBLE_INPUT, takedownState: null }),
    { eligible: true },
  );
});

// ---- annotation-migration gate (fail-closed; #1103 seam) ------------------

test("annotation gate: passes when there are no annotations to re-anchor", () => {
  assert.deepEqual(
    decideAnnotationMigrationGate({ annotationCount: 0, migratorWired: false }),
    { pass: true, reason: "no-annotations" },
  );
});

test("annotation gate: BLOCKS an annotated article when no migrator is wired (#1102 state)", () => {
  assert.deepEqual(
    decideAnnotationMigrationGate({ annotationCount: 3, migratorWired: false }),
    { pass: false, reason: "annotation-migration-required" },
  );
});

test("annotation gate: opens once a migrator is wired and every anchor is reliable (#1103)", () => {
  assert.deepEqual(
    decideAnnotationMigrationGate({ annotationCount: 3, migratorWired: true }),
    { pass: true, reason: "migrator-available" },
  );
  assert.deepEqual(
    decideAnnotationMigrationGate({ annotationCount: 3, migratorWired: true, unreliableAnchorCount: 0 }),
    { pass: true, reason: "migrator-available" },
  );
});

test("annotation gate: a wired migrator still BLOCKS when any anchor is unreliable (#1103)", () => {
  // Even with a migrator wired, an ambiguous/missing anchor must retain the old
  // version and be surfaced for confirmation — never silently dropped or moved.
  for (const unreliableAnchorCount of [1, 2, 7]) {
    assert.deepEqual(
      decideAnnotationMigrationGate({ annotationCount: 3, migratorWired: true, unreliableAnchorCount }),
      { pass: false, reason: "annotation-migration-required" },
      `unreliableAnchorCount=${unreliableAnchorCount}`,
    );
  }
});

test("annotation gate: no-annotations passes regardless of migrator/reliability inputs", () => {
  assert.deepEqual(
    decideAnnotationMigrationGate({ annotationCount: 0, migratorWired: true, unreliableAnchorCount: 5 }),
    { pass: true, reason: "no-annotations" },
  );
});

// ---- activation validation gate (ordered precedence) ----------------------

test("activation: proceeds when every signal is clean and there is nothing to migrate", () => {
  assert.deepEqual(
    decideForceRescrapeActivation({
      signals: CLEAN_SIGNALS,
      annotation: { annotationCount: 0, migratorWired: false },
    }),
    { proceed: true },
  );
});

test("activation: an empty body is refused first (never overwrite with nothing)", () => {
  const d = decideForceRescrapeActivation({
    signals: { bodyPresent: false, canonical: "conflict", safety: "unsafe", quality: "reject" },
    annotation: { annotationCount: 5, migratorWired: false },
  });
  assert.deepEqual(d, { proceed: false, reason: "empty_body" });
});

test("activation: a blocked identity outranks a canonical conflict", () => {
  const d = decideForceRescrapeActivation({
    signals: { ...CLEAN_SIGNALS, canonical: "blocked" },
    annotation: { annotationCount: 0, migratorWired: false },
  });
  assert.deepEqual(d, { proceed: false, reason: "blocked_identity" });
});

test("activation: a conflicting canonical fails closed (identity is sacred)", () => {
  const d = decideForceRescrapeActivation({
    signals: { ...CLEAN_SIGNALS, canonical: "conflict" },
    annotation: { annotationCount: 0, migratorWired: false },
  });
  assert.deepEqual(d, { proceed: false, reason: "canonical_conflict" });
});

test("activation: an unsafe body is refused before the quality gate", () => {
  const d = decideForceRescrapeActivation({
    signals: { ...CLEAN_SIGNALS, safety: "unsafe", quality: "reject" },
    annotation: { annotationCount: 0, migratorWired: false },
  });
  assert.deepEqual(d, { proceed: false, reason: "unsafe_body" });
});

test("activation: a quality rejection is refused", () => {
  const d = decideForceRescrapeActivation({
    signals: { ...CLEAN_SIGNALS, quality: "reject" },
    annotation: { annotationCount: 0, migratorWired: false },
  });
  assert.deepEqual(d, { proceed: false, reason: "quality_rejected" });
});

test("activation: clean signals but pending annotation migration is refused LAST", () => {
  const d = decideForceRescrapeActivation({
    signals: CLEAN_SIGNALS,
    annotation: { annotationCount: 2, migratorWired: false },
  });
  assert.deepEqual(d, { proceed: false, reason: "annotation_migration_required" });
});

test("activation: clean signals + annotations + wired migrator proceeds", () => {
  assert.deepEqual(
    decideForceRescrapeActivation({
      signals: CLEAN_SIGNALS,
      annotation: { annotationCount: 2, migratorWired: true },
    }),
    { proceed: true },
  );
});

test("activation: wired migrator but an unreliable anchor is refused LAST (#1103)", () => {
  const d = decideForceRescrapeActivation({
    signals: CLEAN_SIGNALS,
    annotation: { annotationCount: 2, migratorWired: true, unreliableAnchorCount: 1 },
  });
  assert.deepEqual(d, { proceed: false, reason: "annotation_migration_required" });
});

// ---- failure taxonomy -----------------------------------------------------

test("failure taxonomy: fetch/internal reasons map to FAILED, the rest to REJECTED", () => {
  assert.ok(FAILED_STATUS_REASONS.has("fetch_failed"));
  assert.ok(FAILED_STATUS_REASONS.has("internal_error"));
  const rejectedReasons = FORCE_RESCRAPE_FAILURE_REASONS.filter((r) => !FAILED_STATUS_REASONS.has(r));
  assert.deepEqual(
    [...rejectedReasons].sort(),
    ["annotation_migration_required", "blocked_identity", "canonical_conflict", "empty_body", "quality_rejected", "unsafe_body"],
  );
});
