/**
 * Unit tests for the deleted-article recovery admin UI (issue #1104, Phase 3.5,
 * AC2, frontend half).
 *
 * Covers:
 *  - AdminNav includes /admin/deleted-articles with label "Deleted".
 *  - The page gates on `sources.manage` via requireCapability.
 *  - The pure searchParams parsing + pagination clamping, the terminal-reason /
 *    status label maps, and the recover reason validity bound.
 *  - The recovery mutation-outcome classification (conflict → refresh & retry,
 *    ineligible, not-found, validation, auth, generic) and the success copy.
 *  - The client island fetches the documented endpoint, posts an explicit
 *    `confirm` + `reason` to the recover endpoint, renders the required states,
 *    and surfaces the concurrent-change refresh affordance.
 *  - The UI renders ONLY sanitized identity (never a raw URL, article body,
 *    credential), no raw hex colour, no inline font-size.
 *
 * No React, no DOM, no database — source-string + pure-logic checks only,
 * mirroring tests/admin-candidates-ui.test.ts.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

import {
  DEFAULT_DELETED_LIMIT,
  GOVERNANCE_DELETED_REASON,
  MAX_DELETED_LIMIT,
  classifyRecoverError,
  deletedCandidateBadge,
  describeRecoverOutcome,
  isRecoverReasonValid,
  parseDeletedLimit,
  parseDeletedOffset,
  recoverErrorFrom,
  recoverNeedsRefresh,
  terminalReasonLabel,
  type RecoverResponse,
} from "@/lib/scraper/incremental/deleted-article-ui";
import { ApiResponseError } from "@/lib/client-fetch";

const WORKTREE = resolve(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(join(WORKTREE, relPath), "utf8");
}

// ---------------------------------------------------------------------------
// AdminNav — "Deleted" link present
// ---------------------------------------------------------------------------

test("AdminNav includes /admin/deleted-articles with label 'Deleted'", () => {
  const src = readSrc("src/components/AdminNav.tsx");
  assert.ok(src.includes('href: "/admin/deleted-articles"'));
  assert.ok(src.includes('label: "Deleted"'));
});

// ---------------------------------------------------------------------------
// Page gates on sources.manage
// ---------------------------------------------------------------------------

test("deleted-articles page gates on sourcesManage", () => {
  const src = readSrc("src/app/admin/deleted-articles/page.tsx");
  assert.ok(src.includes("requireCapability"));
  assert.ok(src.includes("CAPABILITIES.sourcesManage"));
  assert.ok(src.includes('"/admin/deleted-articles"'));
  assert.ok(src.includes("DeletedArticleQueue"));
});

// ---------------------------------------------------------------------------
// searchParams parsing/clamping + constants
// ---------------------------------------------------------------------------

test("parseDeletedLimit + parseDeletedOffset clamp to the API bounds", () => {
  assert.equal(DEFAULT_DELETED_LIMIT, 50);
  assert.equal(MAX_DELETED_LIMIT, 200);
  assert.equal(parseDeletedLimit(undefined), 50);
  assert.equal(parseDeletedLimit("10"), 10);
  assert.equal(parseDeletedLimit("5000"), 200);
  assert.equal(parseDeletedLimit("0"), 1);
  assert.equal(parseDeletedLimit("abc"), 50);
  assert.equal(parseDeletedOffset(undefined), 0);
  assert.equal(parseDeletedOffset("25"), 25);
  assert.equal(parseDeletedOffset("-3"), 0);
});

// ---------------------------------------------------------------------------
// Terminal-reason + status badge (sanitized categories, graceful fallback)
// ---------------------------------------------------------------------------

test("terminalReasonLabel maps the governance category and falls back", () => {
  assert.equal(GOVERNANCE_DELETED_REASON, "governance:article-deleted");
  assert.equal(terminalReasonLabel(GOVERNANCE_DELETED_REASON), "Article deleted (governance)");
  assert.equal(terminalReasonLabel(null), "Unknown");
  assert.equal(terminalReasonLabel("some:other"), "some:other");
});

test("deletedCandidateBadge tones a governance-deleted identity", () => {
  assert.deepEqual(deletedCandidateBadge(GOVERNANCE_DELETED_REASON), { variant: "danger", label: "Deleted" });
  assert.deepEqual(deletedCandidateBadge(null), { variant: "neutral", label: "Unknown" });
  assert.deepEqual(deletedCandidateBadge("weird"), { variant: "neutral", label: "weird" });
});

// ---------------------------------------------------------------------------
// Recover reason validity (explicit re-admission — 1..500 chars)
// ---------------------------------------------------------------------------

test("isRecoverReasonValid enforces the 1–500 char audit-reason bound", () => {
  assert.equal(isRecoverReasonValid(""), false);
  assert.equal(isRecoverReasonValid("   "), false);
  assert.equal(isRecoverReasonValid("re-admit after appeal"), true);
  assert.equal(isRecoverReasonValid("a".repeat(500)), true);
  assert.equal(isRecoverReasonValid("a".repeat(501)), false);
});

// ---------------------------------------------------------------------------
// Recover mutation error classification (409 conflict/ineligible / 404 / auth)
// ---------------------------------------------------------------------------

test("recoverErrorFrom classifies conflict, ineligible, not-found, validation, auth", () => {
  const conflict = recoverErrorFrom(409, { reason: "conflict", stale: true }, "x");
  assert.equal(conflict.kind, "conflict");
  assert.equal(recoverNeedsRefresh(conflict), true);

  const ineligible = recoverErrorFrom(409, { reason: "ineligible", status: "INGESTED" }, "x");
  assert.equal(ineligible.kind, "ineligible");
  assert.equal(recoverNeedsRefresh(ineligible), false);

  assert.equal(recoverErrorFrom(404, { error: "nope" }, "x").kind, "notFound");
  assert.equal(recoverErrorFrom(400, { error: "confirm required" }, "x").kind, "validation");
  assert.equal(recoverErrorFrom(401, {}, "x").kind, "auth");
  assert.equal(recoverErrorFrom(403, {}, "x").kind, "auth");
  assert.equal(recoverErrorFrom(500, {}, "x").kind, "generic");
});

test("classifyRecoverError unwraps an ApiResponseError body", () => {
  const err = Object.assign(new ApiResponseError(409, "Candidate changed concurrently"), {
    cause: { reason: "conflict", stale: true },
  });
  assert.equal(classifyRecoverError(err).kind, "conflict");
  assert.equal(classifyRecoverError(new Error("boom")).kind, "generic");
});

// ---------------------------------------------------------------------------
// Recover success copy
// ---------------------------------------------------------------------------

test("describeRecoverOutcome describes the re-admission (not a content restore)", () => {
  const res: RecoverResponse = {
    ok: true,
    outcome: "recovered",
    candidateId: "cand1",
    jobId: "job1",
    dedupeKey: "dedupe1",
    processingVersion: 3,
  };
  const copy = describeRecoverOutcome(res);
  assert.match(copy, /re-admitted/i);
  assert.match(copy, /processing v3/);
  assert.match(copy, /not a content restore/i);
});

// ---------------------------------------------------------------------------
// Client islands: correct endpoint, required states, confirm+reason
// ---------------------------------------------------------------------------

test("DeletedArticleQueue posts an explicit confirm + reason to the recover endpoint", () => {
  const src = readSrc("src/components/admin/deleted-articles/DeletedArticleQueue.tsx");
  assert.ok(src.includes("/api/admin/deleted-articles?"));
  assert.ok(src.includes("/recover`"));
  assert.ok(src.includes("confirm: true"));
  assert.ok(src.includes("reason"));
  assert.ok(src.includes("getJson"));
  assert.ok(src.includes("postJson"));
  assert.ok(src.includes("EmptyState"));
  assert.ok(src.includes("Skeleton"));
  assert.ok(src.includes('role="alert"'));
  assert.ok(src.includes("forbidden"));
  // Concurrent-change 409 → refresh & retry affordance.
  assert.ok(src.includes("refresh"));
});

test("DeletedRecoverButton requires a reason + an explicit confirm toggle", () => {
  const src = readSrc("src/components/admin/deleted-articles/DeletedRecoverButton.tsx");
  assert.ok(src.includes("Popover"));
  assert.ok(src.includes("Switch"));
  assert.ok(src.includes("isRecoverReasonValid"));
  assert.ok(src.includes("confirm"));
  assert.ok(src.includes("Textarea"));
});

// ---------------------------------------------------------------------------
// Privacy + design tokens (never a URL/content/credential; no raw hex/font-size)
// ---------------------------------------------------------------------------

test("deleted-article UI never references raw URL / content / credential fields", () => {
  const files = [
    "src/app/admin/deleted-articles/page.tsx",
    "src/components/admin/deleted-articles/DeletedArticleQueue.tsx",
    "src/components/admin/deleted-articles/DeletedRecoverButton.tsx",
    "src/lib/scraper/incremental/deleted-article-ui.ts",
  ];
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
  const forbiddenAccess = /[.[]"?\b(secret|password|credentials?|cookie)\b/;
  for (const file of files) {
    const src = readSrc(file);
    for (const term of forbiddenFields) {
      assert.ok(!src.includes(term), `${file} must not reference "${term}"`);
    }
    assert.ok(!forbiddenAccess.test(src), `${file} must not access a secret/credential field`);
  }
});

test("deleted-article UI is token-driven (no raw hex colour, no inline font-size)", () => {
  const files = [
    "src/components/admin/deleted-articles/DeletedArticleQueue.tsx",
    "src/components/admin/deleted-articles/DeletedRecoverButton.tsx",
  ];
  for (const file of files) {
    // Strip `#1104`-style issue references before scanning for CSS hex colours.
    const src = readSrc(file).replace(/#\d+/g, "");
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), `${file} must not use a raw hex colour`);
    assert.ok(!src.includes("fontSize"), `${file} must not set an inline fontSize`);
    assert.ok(!src.includes("style={{"), `${file} must not use inline styles`);
  }
});
