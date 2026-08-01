/**
 * Pure unit tests for the canonical-conflict KIND classifier + the by-construction
 * agreement guarantee (issue #1158).
 *
 * `classifyConflictKind` is the SINGLE source of truth for whether a conflict is a
 * baseline (Type A) or runtime (Type B) conflict: `incumbentCandidateId == null`
 * ⇒ `type-a`, else `type-b`. The resolver (`canonical-conflict-commit.ts`) and the
 * queue query (`canonical-conflict-query.ts`) BOTH call it, so the detail DTO's
 * `kind` can never disagree with the selector the resolver will accept. These
 * tests pin the mapping and prove — at the source level — that neither module
 * hand-rolls its own kind rule.
 *
 * No DB/network/clock — pure-logic + source-string checks only.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CanonicalConflictStatus } from "@prisma/client";

import {
  classifyConflictKind,
  decideConflictResolution,
  decideTypeBResolution,
} from "@/lib/scraper/incremental/canonical-conflict-policy";

const WORKTREE = resolve(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(join(WORKTREE, relPath), "utf8");
}

test("classifyConflictKind maps incumbent linkage to the conflict kind", () => {
  assert.equal(classifyConflictKind(null), "type-a");
  assert.equal(classifyConflictKind("cand-123"), "type-b");
  assert.equal(classifyConflictKind(""), "type-b");
});

test("resolver + query derive kind from the SAME classifyConflictKind helper (agreement by construction)", () => {
  const commit = readSrc("src/lib/scraper/incremental/canonical-conflict-commit.ts");
  const query = readSrc("src/lib/scraper/incremental/canonical-conflict-query.ts");

  // Both import the shared helper from the policy module.
  assert.ok(commit.includes("classifyConflictKind"), "resolver imports classifyConflictKind");
  assert.ok(query.includes("classifyConflictKind"), "query imports classifyConflictKind");
  assert.match(commit, /from "\.\/canonical-conflict-policy"/);
  assert.match(query, /from "\.\/canonical-conflict-policy"/);

  // Both call it against `incumbentCandidateId` rather than re-implementing the rule.
  assert.match(commit, /classifyConflictKind\(conflict\.incumbentCandidateId\)/);
  assert.match(query, /classifyConflictKind\(row\.incumbentCandidateId\)/);
});

test("resolved and dismissed Type-A conflicts are idempotent no-ops", () => {
  const input = {
    survivingArticleId: "article-1",
    participantArticleIds: ["article-1", "article-2"],
  };

  assert.deepEqual(
    decideConflictResolution({ ...input, status: CanonicalConflictStatus.RESOLVED }),
    {
      kind: "noop",
      reason: "already-resolved",
      status: CanonicalConflictStatus.RESOLVED,
    },
  );
  assert.deepEqual(
    decideConflictResolution({ ...input, status: CanonicalConflictStatus.DISMISSED }),
    {
      kind: "noop",
      reason: "already-dismissed",
      status: CanonicalConflictStatus.DISMISSED,
    },
  );
});

test("Type-B resolution rejects terminal and structurally invalid conflicts", () => {
  const base = {
    canonical: "incumbent" as const,
    incumbentCandidateId: "incumbent-1",
    incumbentExists: true,
    challengerCandidateId: "challenger-1",
  };

  assert.deepEqual(
    decideTypeBResolution({ ...base, status: CanonicalConflictStatus.DISMISSED }),
    {
      kind: "noop",
      reason: "already-dismissed",
      status: CanonicalConflictStatus.DISMISSED,
    },
  );
  assert.deepEqual(
    decideTypeBResolution({
      ...base,
      status: CanonicalConflictStatus.OPEN,
      incumbentCandidateId: null,
    }),
    {
      kind: "illegal",
      reason: "wrong-conflict-type",
      status: CanonicalConflictStatus.OPEN,
    },
  );
  assert.deepEqual(
    decideTypeBResolution({
      ...base,
      status: CanonicalConflictStatus.OPEN,
      incumbentExists: false,
    }),
    {
      kind: "illegal",
      reason: "incumbent-candidate-missing",
      status: CanonicalConflictStatus.OPEN,
    },
  );
});
