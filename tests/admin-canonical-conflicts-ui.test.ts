/**
 * Unit tests for the canonical-conflict admin UI (issue #1104, Phase 3.5, AC1,
 * frontend half).
 *
 * Covers:
 *  - AdminNav includes /admin/canonical-conflicts with label "Conflicts".
 *  - The page gates on `sources.manage` via requireCapability.
 *  - The pure searchParams parsing + pagination clamping, status guard, and the
 *    sanitized dependent-data COUNT formatters.
 *  - The resolution mutation-outcome classification (stale / survivor-not-a-
 *    participant / no-participants / not-found / validation / auth / generic) and
 *    the applied/no-op success copy.
 *  - The client island fetches the documented endpoint and renders the required
 *    states; the detail sheet posts an explicit `confirm` + `reason` +
 *    `survivingArticleId`, offers survivor selection, and surfaces stale/refresh.
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
  CONFLICT_STATUSES,
  DEFAULT_CONFLICT_LIMIT,
  MAX_CONFLICT_LIMIT,
  classifyConflictResolveError,
  conflictResolveErrorFrom,
  conflictResolveNeedsRefresh,
  conflictStatusBadge,
  dependentDataItems,
  describeResolveOutcome,
  isConflictStatus,
  isResolveReasonValid,
  parseConflictLimit,
  parseConflictOffset,
  parseConflictStatus,
  resolveNoopLabel,
  summarizeDependentData,
  summarizeMigration,
  totalDependentData,
  type ConflictResolveResponse,
  type DependentDataCounts,
} from "@/lib/scraper/incremental/canonical-conflict-ui";
import type { ReaderDataMigrationSummary } from "@/lib/scraper/incremental/canonical-conflict-migrate";
import { ApiResponseError } from "@/lib/client-fetch";

const WORKTREE = resolve(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(join(WORKTREE, relPath), "utf8");
}

function counts(partial: Partial<DependentDataCounts>): DependentDataCounts {
  return {
    highlights: 0,
    readingProgress: 0,
    readingListItems: 0,
    articleMastery: 0,
    quizAttempts: 0,
    pronunciationAttempts: 0,
    tutorMessages: 0,
    difficultyFeedback: 0,
    ...partial,
  };
}

function zeroMigration(): ReaderDataMigrationSummary {
  const zero = { repointed: 0, merged: 0, skipped: 0 };
  return {
    readingProgress: { ...zero },
    readingListItems: { ...zero },
    highlights: { ...zero },
    articleMastery: { ...zero },
    difficultyFeedback: { ...zero },
    tutorMessages: { ...zero },
    quizAttempts: { ...zero },
    pronunciationAttempts: { ...zero },
  };
}

// ---------------------------------------------------------------------------
// AdminNav — "Conflicts" link present
// ---------------------------------------------------------------------------

test("AdminNav includes /admin/canonical-conflicts with label 'Conflicts'", () => {
  const src = readSrc("src/components/AdminNav.tsx");
  assert.ok(src.includes('href: "/admin/canonical-conflicts"'));
  assert.ok(src.includes('label: "Conflicts"'));
});

// ---------------------------------------------------------------------------
// Page gates on sources.manage
// ---------------------------------------------------------------------------

test("canonical-conflicts page gates on sourcesManage", () => {
  const src = readSrc("src/app/admin/canonical-conflicts/page.tsx");
  assert.ok(src.includes("requireCapability"));
  assert.ok(src.includes("CAPABILITIES.sourcesManage"));
  assert.ok(src.includes('"/admin/canonical-conflicts"'));
  assert.ok(src.includes("CanonicalConflictQueue"));
});

// ---------------------------------------------------------------------------
// Status guard + searchParams parsing/clamping + constants
// ---------------------------------------------------------------------------

test("isConflictStatus only accepts the three conflict statuses", () => {
  assert.equal(isConflictStatus("OPEN"), true);
  assert.equal(isConflictStatus("RESOLVED"), true);
  assert.equal(isConflictStatus("DISMISSED"), true);
  assert.equal(isConflictStatus("QUEUED"), false);
  assert.equal(isConflictStatus(""), false);
  assert.deepEqual([...CONFLICT_STATUSES], ["OPEN", "RESOLVED", "DISMISSED"]);
});

test("parseConflictStatus defaults to OPEN and echoes valid statuses", () => {
  assert.equal(parseConflictStatus(undefined), "OPEN");
  assert.equal(parseConflictStatus("garbage"), "OPEN");
  assert.equal(parseConflictStatus("RESOLVED"), "RESOLVED");
  assert.equal(parseConflictStatus("DISMISSED"), "DISMISSED");
});

test("parseConflictLimit + parseConflictOffset clamp to the API bounds", () => {
  assert.equal(DEFAULT_CONFLICT_LIMIT, 50);
  assert.equal(MAX_CONFLICT_LIMIT, 200);
  // Limit: fallback, clamp-high, clamp-low, non-numeric.
  assert.equal(parseConflictLimit(undefined), 50);
  assert.equal(parseConflictLimit("10"), 10);
  assert.equal(parseConflictLimit("5000"), 200);
  assert.equal(parseConflictLimit("0"), 1);
  assert.equal(parseConflictLimit("abc"), 50);
  // Offset: fallback, echo, clamp-negative.
  assert.equal(parseConflictOffset(undefined), 0);
  assert.equal(parseConflictOffset("25"), 25);
  assert.equal(parseConflictOffset("-3"), 0);
});

// ---------------------------------------------------------------------------
// Status badge (sanitized categories, graceful fallback)
// ---------------------------------------------------------------------------

test("conflictStatusBadge maps known statuses and falls back gracefully", () => {
  assert.deepEqual(conflictStatusBadge("OPEN"), { variant: "warning", label: "Open" });
  assert.deepEqual(conflictStatusBadge("RESOLVED"), { variant: "success", label: "Resolved" });
  assert.deepEqual(conflictStatusBadge("DISMISSED"), { variant: "neutral", label: "Dismissed" });
  assert.deepEqual(conflictStatusBadge("MYSTERY"), { variant: "neutral", label: "MYSTERY" });
});

// ---------------------------------------------------------------------------
// Dependent-data COUNT formatting (never content)
// ---------------------------------------------------------------------------

test("totalDependentData sums every dependent-data field", () => {
  assert.equal(totalDependentData(counts({ highlights: 2, readingProgress: 1, quizAttempts: 3 })), 6);
  assert.equal(totalDependentData(counts({})), 0);
});

test("dependentDataItems lists only non-zero fields in a stable order", () => {
  const items = dependentDataItems(counts({ highlights: 2, quizAttempts: 3, tutorMessages: 1 }));
  assert.deepEqual(items, [
    { label: "Highlights", value: 2 },
    { label: "Quiz attempts", value: 3 },
    { label: "Tutor messages", value: 1 },
  ]);
  assert.deepEqual(dependentDataItems(counts({})), []);
});

test("summarizeDependentData renders a compact count-only summary", () => {
  assert.equal(summarizeDependentData(counts({})), "No reader data");
  const summary = summarizeDependentData(counts({ highlights: 2, quizAttempts: 3 }));
  assert.match(summary, /5 records/);
  assert.match(summary, /2 highlights/);
  assert.match(summary, /3 quiz attempts/);
  assert.equal(summarizeDependentData(counts({ highlights: 1 })), "1 record · 1 highlights");
});

// ---------------------------------------------------------------------------
// Resolve reason validity (destructive action — 1..500 chars)
// ---------------------------------------------------------------------------

test("isResolveReasonValid enforces the 1–500 char audit-reason bound", () => {
  assert.equal(isResolveReasonValid(""), false);
  assert.equal(isResolveReasonValid("   "), false);
  assert.equal(isResolveReasonValid("duplicate of canonical"), true);
  assert.equal(isResolveReasonValid("a".repeat(500)), true);
  assert.equal(isResolveReasonValid("a".repeat(501)), false);
});

// ---------------------------------------------------------------------------
// Resolve mutation error classification (400 / 409 / 404 / auth)
// ---------------------------------------------------------------------------

test("conflictResolveErrorFrom classifies stale, bad-survivor, no-participants, etc.", () => {
  const stale = conflictResolveErrorFrom(409, { reason: "stale", stale: true }, "x");
  assert.equal(stale.kind, "stale");
  assert.equal(conflictResolveNeedsRefresh(stale), true);

  const notParticipant = conflictResolveErrorFrom(
    400,
    { reason: "illegal", detail: "survivor-not-a-participant" },
    "x",
  );
  assert.equal(notParticipant.kind, "notParticipant");
  assert.equal(conflictResolveNeedsRefresh(notParticipant), false);

  const noParticipants = conflictResolveErrorFrom(
    409,
    { reason: "illegal", detail: "no-participants" },
    "x",
  );
  assert.equal(noParticipants.kind, "noParticipants");

  // A bare 400 (confirm:false) is a plain validation error.
  assert.equal(conflictResolveErrorFrom(400, { error: "confirm required" }, "x").kind, "validation");
  assert.equal(conflictResolveErrorFrom(404, { error: "nope" }, "x").kind, "notFound");
  assert.equal(conflictResolveErrorFrom(401, {}, "x").kind, "auth");
  assert.equal(conflictResolveErrorFrom(403, {}, "x").kind, "auth");
  assert.equal(conflictResolveErrorFrom(500, {}, "x").kind, "generic");
});

test("classifyConflictResolveError unwraps an ApiResponseError body", () => {
  const err = Object.assign(new ApiResponseError(409, "Conflict changed concurrently"), {
    cause: { reason: "stale", stale: true },
  });
  assert.equal(classifyConflictResolveError(err).kind, "stale");
  assert.equal(classifyConflictResolveError(new Error("boom")).kind, "generic");
});

// ---------------------------------------------------------------------------
// Resolve success copy (applied vs idempotent no-op)
// ---------------------------------------------------------------------------

test("describeResolveOutcome describes applied vs no-op", () => {
  const applied: ConflictResolveResponse = {
    ok: true,
    outcome: "applied",
    conflictId: "cf1",
    survivingArticleId: "a1",
    loserArticleIds: ["a2", "a3"],
    survivorCandidateId: "cand1",
  };
  const noop: ConflictResolveResponse = {
    ok: true,
    outcome: "noop",
    conflictId: "cf1",
    reason: "already-resolved",
    status: "RESOLVED",
  };
  assert.match(describeResolveOutcome(applied), /Resolved/);
  assert.match(describeResolveOutcome(applied), /2 losing articles/);
  assert.match(describeResolveOutcome(noop), /no change/i);
  assert.match(describeResolveOutcome(noop), /already resolved/);
  assert.equal(resolveNoopLabel("already-dismissed"), "already dismissed");
  assert.equal(resolveNoopLabel("whatever"), "whatever");
});

// ---------------------------------------------------------------------------
// Type A opt-in migration summary (#1134) + Type B resolution copy (#1135)
// ---------------------------------------------------------------------------

test("summarizeMigration reports moved + skipped reader records (counts only)", () => {
  assert.equal(summarizeMigration(zeroMigration()), "no reader data to migrate");

  const moved: ReaderDataMigrationSummary = {
    ...zeroMigration(),
    highlights: { repointed: 3, merged: 1, skipped: 2 },
    readingProgress: { repointed: 4, merged: 0, skipped: 0 },
  };
  const summary = summarizeMigration(moved);
  // repointed + merged = 3+1+4 = 8 migrated; skipped = 2 left behind.
  assert.match(summary, /8 reader records migrated/);
  assert.match(summary, /2 left on the original articles/);

  const one: ReaderDataMigrationSummary = {
    ...zeroMigration(),
    highlights: { repointed: 1, merged: 0, skipped: 1 },
  };
  assert.match(summarizeMigration(one), /1 reader record migrated/);
  assert.match(summarizeMigration(one), /1 left on the original article\b/);
});

test("describeResolveOutcome surfaces the opt-in migration summary when present", () => {
  const withMigration: ConflictResolveResponse = {
    ok: true,
    outcome: "applied",
    conflictId: "cf1",
    survivingArticleId: "a1",
    loserArticleIds: ["a2"],
    survivorCandidateId: "cand1",
    migration: { ...zeroMigration(), highlights: { repointed: 2, merged: 0, skipped: 0 } },
  };
  const msg = describeResolveOutcome(withMigration);
  assert.match(msg, /Resolved/);
  assert.match(msg, /1 losing article/);
  assert.match(msg, /2 reader records migrated/);
  assert.doesNotMatch(msg, /reader data retained/);
});

test("describeResolveOutcome describes both Type-B canonical decisions", () => {
  const incumbent: ConflictResolveResponse = {
    ok: true,
    outcome: "applied-type-b",
    conflictId: "cf1",
    canonical: "incumbent",
    winnerCandidateId: "inc1",
    loserCandidateId: "chal1",
    archivedArticleId: null,
  };
  const challengerArchived: ConflictResolveResponse = {
    ok: true,
    outcome: "applied-type-b",
    conflictId: "cf1",
    canonical: "challenger",
    winnerCandidateId: "chal1",
    loserCandidateId: "inc1",
    archivedArticleId: "art-inc",
  };
  const challengerNoArticle: ConflictResolveResponse = {
    ...challengerArchived,
    archivedArticleId: null,
  };

  assert.match(describeResolveOutcome(incumbent), /incumbent kept canonical/i);
  assert.match(describeResolveOutcome(incumbent), /challenger.*folded/i);

  assert.match(describeResolveOutcome(challengerArchived), /challenger promoted canonical/i);
  assert.match(describeResolveOutcome(challengerArchived), /archived/i);
  assert.doesNotMatch(describeResolveOutcome(challengerNoArticle), /archived/i);
});

test("conflictResolveErrorFrom treats a Type-B kind/candidate mismatch as a refreshable stale", () => {
  for (const detail of [
    "wrong-conflict-type",
    "incumbent-candidate-missing",
    "challenger-candidate-missing",
  ]) {
    const err = conflictResolveErrorFrom(409, { reason: "illegal", detail }, "x");
    assert.equal(err.kind, "stale", `${detail} → stale`);
    assert.equal(conflictResolveNeedsRefresh(err), true);
  }
});

// ---------------------------------------------------------------------------
// Client islands: correct endpoint, required states, confirm+reason, survivor
// ---------------------------------------------------------------------------

test("CanonicalConflictQueue fetches the documented endpoint and renders required states", () => {
  const src = readSrc("src/components/admin/canonical-conflicts/CanonicalConflictQueue.tsx");
  assert.ok(src.includes("/api/admin/canonical-conflicts?"));
  assert.ok(src.includes("getJson"));
  assert.ok(src.includes("EmptyState"));
  assert.ok(src.includes("Skeleton"));
  assert.ok(src.includes('role="alert"'));
  assert.ok(src.includes("forbidden"));
  assert.ok(src.includes("ConflictDetailSheet"));
});

test("ConflictDetailSheet posts an explicit confirm + reason + survivor selection", () => {
  const src = readSrc("src/components/admin/canonical-conflicts/ConflictDetailSheet.tsx");
  // Destructive resolve endpoint + explicit confirm + audit reason.
  assert.ok(src.includes("/resolve`"));
  assert.ok(src.includes("confirm: true"));
  assert.ok(src.includes("survivingArticleId"));
  assert.ok(src.includes("reason:"));
  // Operator selects the survivor from the contested participants.
  assert.ok(src.includes('type="radio"'));
  assert.ok(src.includes("setSurvivor"));
  // Explicit confirm toggle + stale refresh & retry affordance.
  assert.ok(src.includes("Switch"));
  assert.ok(src.includes("Refresh"));
  assert.ok(src.includes("classifyConflictResolveError"));
});

test("ConflictDetailSheet is kind-aware: Type-A migrate opt-in + Type-B canonical decision", () => {
  const src = readSrc("src/components/admin/canonical-conflicts/ConflictDetailSheet.tsx");
  // Branches on the resolver-agreeing kind discriminator.
  assert.ok(src.includes('detail.kind === "type-b"'));
  assert.ok(src.includes("ResolveFormTypeA"));
  assert.ok(src.includes("ResolveFormTypeB"));
  // Type A opt-in: the migrateReaderData flag is a Switch and is posted in the body.
  assert.ok(src.includes("migrateReaderData"));
  assert.ok(src.includes("setMigrateReaderData"));
  // Type B: the incumbent-vs-challenger canonical decision is posted (never a survivor).
  assert.ok(src.includes("canonical,"));
  assert.ok(src.includes('setCanonical("incumbent")'));
  assert.ok(src.includes('setCanonical("challenger")'));
  // Type B surfaces the sanitized incumbent metadata + challenger key (never a URL/body).
  assert.ok(src.includes("incumbentArticle"));
  assert.ok(src.includes("challengerKey"));
});

// ---------------------------------------------------------------------------
// Privacy + design tokens (never a URL/content/credential; no raw hex/font-size)
// ---------------------------------------------------------------------------

test("canonical-conflict UI never references raw URL / content / credential fields", () => {
  const files = [
    "src/app/admin/canonical-conflicts/page.tsx",
    "src/components/admin/canonical-conflicts/CanonicalConflictQueue.tsx",
    "src/components/admin/canonical-conflicts/ConflictDetailSheet.tsx",
    "src/lib/scraper/incremental/canonical-conflict-ui.ts",
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

test("canonical-conflict UI is token-driven (no raw hex colour, no inline font-size)", () => {
  const files = [
    "src/components/admin/canonical-conflicts/CanonicalConflictQueue.tsx",
    "src/components/admin/canonical-conflicts/ConflictDetailSheet.tsx",
  ];
  for (const file of files) {
    // Strip `#1104`-style issue references before scanning for CSS hex colours.
    const src = readSrc(file).replace(/#\d+/g, "");
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), `${file} must not use a raw hex colour`);
    assert.ok(!src.includes("fontSize"), `${file} must not set an inline fontSize`);
    assert.ok(!src.includes("style={{"), `${file} must not use inline styles`);
  }
});
