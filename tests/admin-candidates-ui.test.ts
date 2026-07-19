/**
 * Unit tests for the candidate-review admin UI (issue #1100, Phase 3.1,
 * frontend half).
 *
 * Covers:
 *  - AdminNav includes /admin/candidates with label "Review".
 *  - The candidate-review page gates on `sources.manage` via requireCapability.
 *  - The pure review-action legality MIRROR (`availableReviewActions` /
 *    `batchActionsForStatus` / `blockedActionReason`) — kept in lock-step with
 *    the backend `candidate-review-policy.ts` state machine.
 *  - The mutation-outcome classification (stale / illegal+detail / not-found /
 *    validation / auth) and the partial-batch shaping helpers.
 *  - The single-action + batch success copy.
 *  - The client islands post to the documented endpoints and render only
 *    sanitized provenance (never a raw URL, article body, or credential).
 *
 * No React, no DOM, no database — source-string + pure-logic checks only,
 * mirroring tests/admin-discovery-sources-ui.test.ts.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

import {
  availableReviewActions,
  batchActionsForStatus,
  batchHasStale,
  blockedActionReason,
  candidateStatusBadge,
  conflictStatusBadge,
  dateProvenanceLabel,
  describeBatchItem,
  describeSingleReview,
  illegalDetailLabel,
  isReviewQueueStatus,
  noopReasonLabel,
  reviewActionNeedsReason,
  reviewMutationErrorFrom,
  summarizeBatch,
  DEFAULT_REVIEW_LIMIT,
  MAX_REVIEW_BATCH,
  MAX_REVIEW_LIMIT,
  REVIEW_ACTION_VARIANT,
  REVIEW_QUEUE_STATUSES,
  type BatchResultItem,
  type BatchReviewResponse,
  type SingleReviewResponse,
} from "@/lib/scraper/incremental/candidate-review-ui";
import {
  CANDIDATE_REVIEW_ACTIONS,
  REASON_REQUIRED_ACTIONS,
} from "@/lib/scraper/incremental/candidate-review-policy";

const WORKTREE = resolve(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(join(WORKTREE, relPath), "utf8");
}

// ---------------------------------------------------------------------------
// AdminNav — "Review" link present
// ---------------------------------------------------------------------------

test("AdminNav includes /admin/candidates with label 'Review'", () => {
  const src = readSrc("src/components/AdminNav.tsx");
  assert.ok(src.includes('href: "/admin/candidates"'));
  assert.ok(src.includes('label: "Review"'));
});

// ---------------------------------------------------------------------------
// Page gates on sources.manage
// ---------------------------------------------------------------------------

test("candidate-review page gates on sourcesManage", () => {
  const src = readSrc("src/app/admin/candidates/page.tsx");
  assert.ok(src.includes("requireCapability"));
  assert.ok(src.includes("CAPABILITIES.sourcesManage"));
  assert.ok(src.includes('"/admin/candidates"'));
  assert.ok(src.includes("CandidateReviewQueue"));
});

// ---------------------------------------------------------------------------
// Queue-status guard + constants match the API contract
// ---------------------------------------------------------------------------

test("isReviewQueueStatus only accepts the two operator statuses", () => {
  assert.equal(isReviewQueueStatus("NEEDS_REVIEW"), true);
  assert.equal(isReviewQueueStatus("SKIPPED_REVIEW"), true);
  assert.equal(isReviewQueueStatus("QUEUED"), false);
  assert.equal(isReviewQueueStatus("REJECTED"), false);
  assert.equal(isReviewQueueStatus(""), false);
  assert.deepEqual([...REVIEW_QUEUE_STATUSES], ["NEEDS_REVIEW", "SKIPPED_REVIEW"]);
});

test("pagination constants match the API bounds", () => {
  assert.equal(DEFAULT_REVIEW_LIMIT, 50);
  assert.equal(MAX_REVIEW_LIMIT, 200);
  assert.equal(MAX_REVIEW_BATCH, 100);
});

// ---------------------------------------------------------------------------
// Review-action legality mirror (must match candidate-review-policy.ts)
// ---------------------------------------------------------------------------

test("availableReviewActions mirrors the backend state machine", () => {
  // A linked article hard-blocks EVERY action (governing invariant).
  assert.deepEqual(availableReviewActions("NEEDS_REVIEW", true), []);
  assert.deepEqual(availableReviewActions("SKIPPED_REVIEW", true), []);
  // NEEDS_REVIEW → approve | reject.
  assert.deepEqual(availableReviewActions("NEEDS_REVIEW", false), ["approve", "reject"]);
  // SKIPPED_REVIEW → reactivate only.
  assert.deepEqual(availableReviewActions("SKIPPED_REVIEW", false), ["reactivate"]);
  // Any already-decided / terminal state offers nothing.
  for (const status of ["QUEUED", "INGESTED", "REJECTED", "QUARANTINED", "CONFLICT"]) {
    assert.deepEqual(availableReviewActions(status, false), []);
  }
});

test("batchActionsForStatus offers the right bulk verbs per queue", () => {
  assert.deepEqual(batchActionsForStatus("NEEDS_REVIEW"), ["approve", "reject"]);
  assert.deepEqual(batchActionsForStatus("SKIPPED_REVIEW"), ["reactivate"]);
});

test("blockedActionReason explains hasArticle and dead-end states", () => {
  assert.match(
    blockedActionReason({ hasArticle: true, status: "NEEDS_REVIEW" }) ?? "",
    /invariant/i,
  );
  assert.match(
    blockedActionReason({ hasArticle: false, status: "QUEUED" }) ?? "",
    /no review action/i,
  );
  assert.equal(blockedActionReason({ hasArticle: false, status: "NEEDS_REVIEW" }), null);
});

test("reviewActionNeedsReason requires a reason for reject/reactivate only", () => {
  assert.equal(reviewActionNeedsReason("approve"), false);
  assert.equal(reviewActionNeedsReason("reject"), true);
  assert.equal(reviewActionNeedsReason("reactivate"), true);
  // Cross-check against the backend's canonical list.
  assert.deepEqual([...REASON_REQUIRED_ACTIONS].sort(), ["reactivate", "reject"]);
});

test("the three actions are single-sourced from the backend policy", () => {
  assert.deepEqual([...CANDIDATE_REVIEW_ACTIONS].sort(), ["approve", "reactivate", "reject"]);
  for (const action of CANDIDATE_REVIEW_ACTIONS) {
    assert.ok(REVIEW_ACTION_VARIANT[action] === "primary" || REVIEW_ACTION_VARIANT[action] === "danger");
  }
  assert.equal(REVIEW_ACTION_VARIANT.reject, "danger");
});

// ---------------------------------------------------------------------------
// Badge + label maps (sanitized categories, graceful fallback)
// ---------------------------------------------------------------------------

test("candidateStatusBadge maps known statuses and falls back gracefully", () => {
  assert.deepEqual(candidateStatusBadge("NEEDS_REVIEW"), { variant: "warning", label: "Needs review" });
  assert.deepEqual(candidateStatusBadge("INGESTED"), { variant: "success", label: "Ingested" });
  assert.deepEqual(candidateStatusBadge("QUARANTINED"), { variant: "danger", label: "Quarantined" });
  // Unknown → neutral echo (never throws).
  assert.deepEqual(candidateStatusBadge("SOMETHING_NEW"), { variant: "neutral", label: "SOMETHING_NEW" });
});

test("dateProvenanceLabel + conflictStatusBadge map + fall back", () => {
  assert.equal(dateProvenanceLabel("PAGE_METADATA"), "Page metadata");
  assert.equal(dateProvenanceLabel("MYSTERY"), "MYSTERY");
  assert.deepEqual(conflictStatusBadge("OPEN"), { variant: "warning", label: "Open" });
  assert.deepEqual(conflictStatusBadge("RESOLVED"), { variant: "success", label: "Resolved" });
  assert.equal(conflictStatusBadge("WHAT").label, "WHAT");
});

test("noop + illegal reason labels are human-readable", () => {
  assert.equal(noopReasonLabel("already-approved"), "Already approved");
  assert.equal(illegalDetailLabel("has-article"), "Linked to a public article");
  assert.equal(illegalDetailLabel("not-rejected"), "Not rejected — cannot reactivate");
});

// ---------------------------------------------------------------------------
// Single-action mutation error classification (409 stale / illegal, etc.)
// ---------------------------------------------------------------------------

test("reviewMutationErrorFrom classifies stale, illegal, not-found, validation, auth", () => {
  assert.equal(reviewMutationErrorFrom(409, { reason: "stale", stale: true }, "x").kind, "stale");

  const illegal = reviewMutationErrorFrom(409, { reason: "illegal", detail: "has-article" }, "x");
  assert.equal(illegal.kind, "illegal");
  assert.equal(illegal.kind === "illegal" && illegal.detail, "has-article");

  // A 409 illegal with no detail defaults to a safe reason.
  const illegalNoDetail = reviewMutationErrorFrom(409, { reason: "illegal" }, "x");
  assert.equal(illegalNoDetail.kind === "illegal" && illegalNoDetail.detail, "not-reviewable");

  assert.equal(reviewMutationErrorFrom(404, { error: "nope" }, "x").kind, "notFound");
  assert.equal(reviewMutationErrorFrom(400, { error: "bad" }, "x").kind, "validation");
  assert.equal(reviewMutationErrorFrom(401, {}, "x").kind, "auth");
  assert.equal(reviewMutationErrorFrom(403, {}, "x").kind, "auth");
  assert.equal(reviewMutationErrorFrom(500, {}, "x").kind, "generic");
});

// ---------------------------------------------------------------------------
// Partial-batch shaping (HTTP is always 200 — per-item outcomes)
// ---------------------------------------------------------------------------

const APPLIED: BatchResultItem = {
  candidateId: "c1",
  ok: true,
  outcome: "applied",
  fromStatus: "NEEDS_REVIEW",
  toStatus: "QUEUED",
  enqueued: true,
};
const NOOP: BatchResultItem = { candidateId: "c2", ok: true, outcome: "noop", reason: "already-approved", status: "QUEUED" };
const ILLEGAL: BatchResultItem = { candidateId: "c3", ok: false, reason: "illegal", detail: "has-article", status: "INGESTED" };
const STALE: BatchResultItem = { candidateId: "c4", ok: false, reason: "stale", stale: true, status: "NEEDS_REVIEW" };
const NOT_FOUND: BatchResultItem = { candidateId: "c5", ok: false, reason: "not-found" };

test("describeBatchItem tones each per-item outcome", () => {
  assert.equal(describeBatchItem(APPLIED).tone, "success");
  assert.match(describeBatchItem(APPLIED).label, /queued/i);
  assert.equal(describeBatchItem(NOOP).tone, "neutral");
  assert.equal(describeBatchItem(ILLEGAL).tone, "danger");
  assert.match(describeBatchItem(ILLEGAL).label, /article/i);
  assert.equal(describeBatchItem(STALE).tone, "warning");
  assert.equal(describeBatchItem(NOT_FOUND).tone, "neutral");
});

test("batchHasStale flags a batch containing any stale item", () => {
  const withStale: BatchReviewResponse = {
    ok: true,
    action: "approve",
    results: [APPLIED, STALE],
    summary: { total: 2, applied: 1, noop: 0, failed: 1 },
  };
  const clean: BatchReviewResponse = {
    ok: true,
    action: "approve",
    results: [APPLIED, NOOP],
    summary: { total: 2, applied: 1, noop: 1, failed: 0 },
  };
  assert.equal(batchHasStale(withStale), true);
  assert.equal(batchHasStale(clean), false);
});

test("summarizeBatch renders the applied/noop/failed tallies", () => {
  const res: BatchReviewResponse = {
    ok: true,
    action: "reject",
    results: [APPLIED, NOOP, ILLEGAL],
    summary: { total: 3, applied: 1, noop: 1, failed: 1 },
  };
  const summary = summarizeBatch(res);
  assert.match(summary, /reject/);
  assert.match(summary, /1 applied/);
  assert.match(summary, /1 no-op/);
  assert.match(summary, /1 failed/);
  assert.match(summary, /of 3/);
});

// ---------------------------------------------------------------------------
// Single-action success copy
// ---------------------------------------------------------------------------

test("describeSingleReview describes applied (enqueued) vs no-op", () => {
  const appliedEnqueued: SingleReviewResponse = {
    ok: true,
    outcome: "applied",
    action: "approve",
    candidateId: "c1",
    fromStatus: "NEEDS_REVIEW",
    toStatus: "QUEUED",
    enqueued: true,
  };
  const appliedNoQueue: SingleReviewResponse = { ...appliedEnqueued, action: "reject", toStatus: "SKIPPED_REVIEW", enqueued: false };
  const noop: SingleReviewResponse = {
    ok: true,
    outcome: "noop",
    action: "approve",
    candidateId: "c1",
    reason: "already-approved",
    status: "QUEUED",
  };
  assert.match(describeSingleReview(appliedEnqueued), /queued for ingest/i);
  assert.match(describeSingleReview(appliedNoQueue), /Rejected\./);
  assert.match(describeSingleReview(noop), /no change/i);
});

// ---------------------------------------------------------------------------
// Client islands: correct endpoints + only sanitized provenance
// ---------------------------------------------------------------------------

test("CandidateReviewQueue posts to the documented review endpoints", () => {
  const src = readSrc("src/components/admin/candidate-review/CandidateReviewQueue.tsx");
  assert.ok(src.includes("/api/admin/candidates?"));
  assert.ok(src.includes("/review`")); // single: /api/admin/candidates/{id}/review
  assert.ok(src.includes("/api/admin/candidates/review`")); // bounded batch
  assert.ok(src.includes("getJson"));
  assert.ok(src.includes("postJson"));
  // Required states present.
  assert.ok(src.includes("EmptyState"));
  assert.ok(src.includes("Skeleton"));
  assert.ok(src.includes('role="alert"'));
  assert.ok(src.includes("forbidden"));
});

test("CandidateDetailSheet fetches the sanitized detail DTO", () => {
  const src = readSrc("src/components/admin/candidate-review/CandidateDetailSheet.tsx");
  assert.ok(src.includes("/api/admin/candidates/"));
  assert.ok(src.includes("getJson"));
  assert.ok(src.includes("conflicts"));
});

test("candidate-review UI never references raw URL / content / credential fields", () => {
  const files = [
    "src/app/admin/candidates/page.tsx",
    "src/components/admin/candidate-review/CandidateReviewQueue.tsx",
    "src/components/admin/candidate-review/CandidateDetailSheet.tsx",
    "src/components/admin/candidate-review/ReviewActionButton.tsx",
  ];
  // The API never returns these; the UI must never invent them. Specific
  // camelCase field names are unambiguous leaks even as bare substrings.
  const forbiddenFields = [
    "rawUrl",
    "sourceUrl",
    "articleUrl",
    "articleText",
    "articleHtml",
    "contentHtml",
    "htmlContent",
    "rawContent",
  ];
  // Generic words only matter as PROPERTY ACCESS or object KEYS — not in the
  // sanitization prose ("no URL, body, secret, or article content").
  const forbiddenAccess = /[.[]"?\b(secret|password|credentials?|cookie)\b/;
  for (const file of files) {
    const src = readSrc(file);
    for (const term of forbiddenFields) {
      assert.ok(!src.includes(term), `${file} must not reference "${term}"`);
    }
    assert.ok(!forbiddenAccess.test(src), `${file} must not access a secret/credential field`);
  }
});
