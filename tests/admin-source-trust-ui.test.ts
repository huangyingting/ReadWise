/**
 * Unit tests for the source-trust promotion admin UI (issue #1100, Phase 3.1,
 * frontend half).
 *
 * Covers:
 *  - The pure evidence/drift formatting (`formatRate`, `volumeAnomalyLabel`).
 *  - The blocker/warning label maps — keyed on the EXACT literals the backend
 *    `source-trust-policy.ts` emits (a fallback echo proves no crash on drift).
 *  - The promote/demote enablement gates (`canPromote` requires reported
 *    eligibility AND not-already-trusted; `canDemote` requires trusted).
 *  - The old-item-false-positive tripwire flag.
 *  - The promote/demote mutation-outcome classification (version-mismatch, busy,
 *    ineligible + blockers, stale, not-found, validation, auth).
 *  - The panel posts to the documented trust endpoint, carries definitionVersion
 *    + reason, gates promote on eligibility, and renders only sanitized evidence.
 *
 * No React, no DOM, no database — source-string + pure-logic checks only.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

import {
  canDemote,
  canPromote,
  formatRate,
  hasOldItemFalsePositive,
  trustBlockerLabel,
  trustMutationErrorFrom,
  trustStatusBadge,
  trustWarningLabel,
  volumeAnomalyLabel,
  TRUST_BLOCKER_LABELS,
  TRUST_WARNING_LABELS,
  type SourceTrustBlocker,
  type SourceTrustEvidence,
  type SourceTrustSnapshot,
  type SourceTrustWarning,
} from "@/lib/scraper/incremental/source-trust-ui";
import type {
  SourceTrustBlocker as BackendBlocker,
  SourceTrustWarning as BackendWarning,
} from "@/lib/scraper/incremental/source-trust-policy";

const WORKTREE = resolve(import.meta.dirname, "..");

// Compile-time drift guard: the client-side blocker/warning unions MUST equal
// the backend's. `tsc --noEmit` fails if these unions ever diverge.
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _blockersMatchBackend: Equals<SourceTrustBlocker, BackendBlocker> = true;
const _warningsMatchBackend: Equals<SourceTrustWarning, BackendWarning> = true;
void _blockersMatchBackend;
void _warningsMatchBackend;

// The API-contract literals (source of truth mirrored from source-trust-policy.ts).
const EXPECTED_BLOCKERS: SourceTrustBlocker[] = [
  "insufficient-sample",
  "insufficient-decisions",
  "low-approval-rate",
  "old-item-false-positive",
  "active-drift",
];
const EXPECTED_WARNINGS: SourceTrustWarning[] = [
  "volume-anomaly",
  "elevated-conflict-rate",
  "recent-failures",
];

function readSrc(relPath: string): string {
  return readFileSync(join(WORKTREE, relPath), "utf8");
}

function evidence(overrides: Partial<SourceTrustEvidence> = {}): SourceTrustEvidence {
  return {
    sampleSize: 40,
    acceptedCount: 30,
    reviewRejectedCount: 5,
    decidedCount: 35,
    approvalRate: 0.857,
    oldItemFalsePositives: 0,
    oldItemFalsePositiveRate: 0,
    drift: {
      zeroDiscoveryStreak: 0,
      consecutiveFailures: 0,
      volumeAnomaly: "none",
      conflictRate: 0,
      oldItemFalsePositives: 0,
    },
    ...overrides,
  };
}

function snapshot(overrides: Partial<SourceTrustSnapshot> = {}): SourceTrustSnapshot {
  const ev = overrides.evidence ?? evidence();
  return {
    id: "src-1",
    providerKey: "acme",
    sourceKey: "feed-a",
    definitionVersion: 3,
    lifecycleMode: "ACTIVE",
    policy: { autoPublishTrusted: false, canRepublishPublicly: false, canFetchAuthenticated: false },
    evidence: ev,
    eligibility: { eligible: true, blockers: [], warnings: [], evidence: ev },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

test("formatRate renders a 1-decimal percentage or an em-dash for null", () => {
  assert.equal(formatRate(0.857), "85.7%");
  assert.equal(formatRate(0), "0.0%");
  assert.equal(formatRate(1), "100.0%");
  assert.equal(formatRate(null), "—");
  assert.equal(formatRate(undefined), "—");
});

test("volumeAnomalyLabel maps the three anomaly states + echoes unknown", () => {
  assert.equal(volumeAnomalyLabel("none"), "None");
  assert.equal(volumeAnomalyLabel("spike"), "Spike");
  assert.equal(volumeAnomalyLabel("drop"), "Drop");
  assert.equal(volumeAnomalyLabel("weird"), "weird");
});

test("trustStatusBadge reflects the auto-publish flag", () => {
  assert.deepEqual(trustStatusBadge(true), { variant: "success", label: "Trusted (auto-publish)" });
  assert.deepEqual(trustStatusBadge(false), { variant: "neutral", label: "Untrusted" });
});

// ---------------------------------------------------------------------------
// Blocker / warning label maps match the backend literals (no drift)
// ---------------------------------------------------------------------------

test("every backend blocker literal has a human label", () => {
  const labelKeys = Object.keys(TRUST_BLOCKER_LABELS).sort();
  assert.deepEqual(labelKeys, [...EXPECTED_BLOCKERS].sort());
  for (const blocker of EXPECTED_BLOCKERS) {
    const label = TRUST_BLOCKER_LABELS[blocker];
    assert.equal(typeof label, "string");
    assert.ok(label.length > 0, `missing label for blocker "${blocker}"`);
    assert.equal(trustBlockerLabel(blocker), label);
  }
});

test("every backend warning literal has a human label", () => {
  const labelKeys = Object.keys(TRUST_WARNING_LABELS).sort();
  assert.deepEqual(labelKeys, [...EXPECTED_WARNINGS].sort());
  for (const warning of EXPECTED_WARNINGS) {
    const label = TRUST_WARNING_LABELS[warning];
    assert.equal(typeof label, "string");
    assert.ok(label.length > 0, `missing label for warning "${warning}"`);
    assert.equal(trustWarningLabel(warning), label);
  }
});

test("blocker/warning label helpers echo unknown keys (crash-free on drift)", () => {
  assert.equal(trustBlockerLabel("brand-new-blocker"), "brand-new-blocker");
  assert.equal(trustWarningLabel("brand-new-warning"), "brand-new-warning");
});

// ---------------------------------------------------------------------------
// Promote / demote enablement gates + tripwire
// ---------------------------------------------------------------------------

test("canPromote requires reported eligibility AND not-already-trusted", () => {
  assert.equal(canPromote(snapshot()), true);
  // Already trusted → cannot promote again.
  assert.equal(
    canPromote(snapshot({ policy: { autoPublishTrusted: true, canRepublishPublicly: true, canFetchAuthenticated: false } })),
    false,
  );
  // Ineligible → promote disabled.
  const ev = evidence();
  assert.equal(
    canPromote(snapshot({ eligibility: { eligible: false, blockers: ["low-approval-rate"], warnings: [], evidence: ev }, evidence: ev })),
    false,
  );
});

test("canDemote requires the source to be currently trusted", () => {
  assert.equal(canDemote(snapshot()), false);
  assert.equal(
    canDemote(snapshot({ policy: { autoPublishTrusted: true, canRepublishPublicly: true, canFetchAuthenticated: false } })),
    true,
  );
});

test("hasOldItemFalsePositive fires only when the tripwire count is positive", () => {
  assert.equal(hasOldItemFalsePositive(evidence({ oldItemFalsePositives: 0 })), false);
  assert.equal(hasOldItemFalsePositive(evidence({ oldItemFalsePositives: 1 })), true);
});

// ---------------------------------------------------------------------------
// Promote / demote mutation outcome classification
// ---------------------------------------------------------------------------

test("trustMutationErrorFrom classifies version-mismatch, busy, ineligible, stale", () => {
  assert.equal(trustMutationErrorFrom(409, { reason: "version-mismatch" }, "x").kind, "versionMismatch");
  assert.equal(trustMutationErrorFrom(409, { reason: "busy" }, "x").kind, "busy");

  const ineligible = trustMutationErrorFrom(409, { reason: "ineligible", blockers: ["active-drift", "low-approval-rate"] }, "x");
  assert.equal(ineligible.kind, "ineligible");
  assert.deepEqual(ineligible.kind === "ineligible" && ineligible.blockers, ["active-drift", "low-approval-rate"]);

  // Ineligible with no blockers array → empty list, still classified.
  const ineligibleBare = trustMutationErrorFrom(409, { reason: "ineligible" }, "x");
  assert.deepEqual(ineligibleBare.kind === "ineligible" && ineligibleBare.blockers, []);

  assert.equal(trustMutationErrorFrom(409, { reason: "stale", stale: true }, "x").kind, "stale");
  assert.equal(trustMutationErrorFrom(404, { reason: "source-not-found" }, "x").kind, "notFound");
  assert.equal(trustMutationErrorFrom(400, {}, "x").kind, "validation");
  assert.equal(trustMutationErrorFrom(401, {}, "x").kind, "auth");
  assert.equal(trustMutationErrorFrom(403, {}, "x").kind, "auth");
  assert.equal(trustMutationErrorFrom(500, {}, "x").kind, "generic");
});

// ---------------------------------------------------------------------------
// Client island + detail-page wiring
// ---------------------------------------------------------------------------

test("SourceTrustPanel posts to the trust endpoint with action + definitionVersion + reason", () => {
  const src = readSrc("src/components/admin/SourceTrustPanel.tsx");
  assert.ok(src.includes("/trust`"));
  assert.ok(src.includes("getJson"));
  assert.ok(src.includes("postJson"));
  assert.ok(src.includes("definitionVersion"));
  assert.ok(src.includes("reason"));
  // Promote gated on eligibility; blockers + warnings surfaced.
  assert.ok(src.includes("canPromote"));
  assert.ok(src.includes("blockers"));
  assert.ok(src.includes("warnings"));
  // Required states.
  assert.ok(src.includes("Skeleton"));
  assert.ok(src.includes('role="alert"'));
  assert.ok(src.includes("forbidden"));
});

test("discovery-source detail page renders the SourceTrustPanel", () => {
  const src = readSrc("src/app/admin/discovery-sources/[id]/page.tsx");
  assert.ok(src.includes("SourceTrustPanel"));
  assert.ok(src.includes("requireCapability"));
  assert.ok(src.includes("CAPABILITIES.sourcesManage"));
});

test("source-trust UI never references raw URL / content / credential fields", () => {
  const src = readSrc("src/components/admin/SourceTrustPanel.tsx");
  const forbiddenFields = ["rawUrl", "sourceUrl", "articleText", "articleHtml", "rawContent", "htmlContent"];
  const forbiddenAccess = /[.[]"?\b(secret|password|credentials?|cookie)\b/;
  for (const term of forbiddenFields) {
    assert.ok(!src.includes(term), `SourceTrustPanel must not reference "${term}"`);
  }
  assert.ok(!forbiddenAccess.test(src), "SourceTrustPanel must not access a secret/credential field");
});
