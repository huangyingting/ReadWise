/**
 * Pure unit tests for the candidate-review transition policy (issue #1100).
 *
 * `candidate-review-policy.ts` is PURE — no DB/network/clock. These tests prove
 * the approve/reject/reactivate state machine: legal transitions, idempotent
 * no-ops (the AC1 "approve twice" safety), illegal transitions, and the
 * governing-invariant `hasArticle` hard block.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";

import { CrawlCandidateStatus } from "@prisma/client";

import {
  CANDIDATE_REVIEW_ACTIONS,
  REASON_REQUIRED_ACTIONS,
  decideCandidateReview,
} from "@/lib/scraper/incremental/candidate-review-policy";

const S = CrawlCandidateStatus;

test("action set + reason-required set are exactly as specified", () => {
  assert.deepEqual([...CANDIDATE_REVIEW_ACTIONS], ["approve", "reject", "reactivate"]);
  // reject + reactivate are policy-sensitive; approve is not.
  assert.deepEqual([...REASON_REQUIRED_ACTIONS].sort(), ["reactivate", "reject"]);
  assert.equal(REASON_REQUIRED_ACTIONS.includes("approve"), false);
});

// ---- approve --------------------------------------------------------------

test("approve NEEDS_REVIEW applies NEEDS_REVIEW→QUEUED and enqueues ingest", () => {
  const d = decideCandidateReview({ action: "approve", status: S.NEEDS_REVIEW, hasArticle: false });
  assert.equal(d.kind, "apply");
  assert.equal(d.kind === "apply" && d.toStatus, S.QUEUED);
  assert.equal(d.kind === "apply" && d.enqueueIngest, true);
});

test("approve is idempotent once accepted (QUEUED/INGESTING/INGESTED → noop, no enqueue)", () => {
  for (const status of [S.QUEUED, S.INGESTING, S.INGESTED]) {
    const d = decideCandidateReview({ action: "approve", status, hasArticle: false });
    assert.equal(d.kind, "noop", `expected noop for ${status}`);
    assert.equal(d.kind === "noop" && d.reason, "already-approved");
  }
});

test("approve on a rejected candidate is illegal (must reactivate first)", () => {
  const d = decideCandidateReview({ action: "approve", status: S.SKIPPED_REVIEW, hasArticle: false });
  assert.equal(d.kind, "illegal");
  assert.equal(d.kind === "illegal" && d.reason, "not-reviewable");
});

test("approve on a non-review status (DISCOVERED) is illegal", () => {
  const d = decideCandidateReview({ action: "approve", status: S.DISCOVERED, hasArticle: false });
  assert.equal(d.kind, "illegal");
  assert.equal(d.kind === "illegal" && d.reason, "not-reviewable");
});

// ---- reject ---------------------------------------------------------------

test("reject NEEDS_REVIEW applies NEEDS_REVIEW→SKIPPED_REVIEW and never enqueues", () => {
  const d = decideCandidateReview({ action: "reject", status: S.NEEDS_REVIEW, hasArticle: false });
  assert.equal(d.kind, "apply");
  assert.equal(d.kind === "apply" && d.toStatus, S.SKIPPED_REVIEW);
  assert.equal(d.kind === "apply" && d.enqueueIngest, false);
});

test("reject is idempotent once rejected (SKIPPED_REVIEW → noop)", () => {
  const d = decideCandidateReview({ action: "reject", status: S.SKIPPED_REVIEW, hasArticle: false });
  assert.equal(d.kind, "noop");
  assert.equal(d.kind === "noop" && d.reason, "already-rejected");
});

test("reject on an accepted/in-flight candidate is illegal", () => {
  const d = decideCandidateReview({ action: "reject", status: S.QUEUED, hasArticle: false });
  assert.equal(d.kind, "illegal");
  assert.equal(d.kind === "illegal" && d.reason, "not-reviewable");
});

// ---- reactivate -----------------------------------------------------------

test("reactivate SKIPPED_REVIEW applies SKIPPED_REVIEW→NEEDS_REVIEW and never enqueues", () => {
  const d = decideCandidateReview({ action: "reactivate", status: S.SKIPPED_REVIEW, hasArticle: false });
  assert.equal(d.kind, "apply");
  assert.equal(d.kind === "apply" && d.toStatus, S.NEEDS_REVIEW);
  assert.equal(d.kind === "apply" && d.enqueueIngest, false);
});

test("reactivate is idempotent when already in review (NEEDS_REVIEW → noop)", () => {
  const d = decideCandidateReview({ action: "reactivate", status: S.NEEDS_REVIEW, hasArticle: false });
  assert.equal(d.kind, "noop");
  assert.equal(d.kind === "noop" && d.reason, "already-in-review");
});

test("reactivate on a non-rejected candidate is illegal", () => {
  const d = decideCandidateReview({ action: "reactivate", status: S.INGESTED, hasArticle: false });
  assert.equal(d.kind, "illegal");
  assert.equal(d.kind === "illegal" && d.reason, "not-rejected");
});

// ---- governing-invariant hard block --------------------------------------

test("a linked Article hard-blocks EVERY action (governing invariant)", () => {
  for (const action of CANDIDATE_REVIEW_ACTIONS) {
    for (const status of [S.NEEDS_REVIEW, S.SKIPPED_REVIEW, S.QUEUED, S.INGESTED]) {
      const d = decideCandidateReview({ action, status, hasArticle: true });
      assert.equal(d.kind, "illegal", `${action}/${status} with article should be illegal`);
      assert.equal(d.kind === "illegal" && d.reason, "has-article");
    }
  }
});
