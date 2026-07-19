/**
 * Unit tests for the candidate ingest ATTEMPT runner (#1095, Phase 2.5). Uses
 * injected fakes for the fetch/extract seam, identity resolver, and save-commit
 * (no DB, no network). Proves the runner honors the house architecture:
 *   - a fetch/extract FAILURE surfaces as `{ ok: false, outcome }` so #1093
 *     classifies + schedules it;
 *   - every NON-SAVING outcome (deterministic stop, known/baseline identity,
 *     a resolver non-keep, or a stale-generation refusal) returns `{ ok: true }`
 *     and creates NO Article and NO downstream job (no spurious retry loop);
 *   - only a `kept`/`transferred` resolution reaches the atomic save, with the
 *     correct winner id, provider key, and versioned prose fingerprint.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { CrawlCandidateStatus } from "@prisma/client";

import {
  createIngestAttemptRunner,
  type RunnerCandidate,
  type RunnerSource,
  type PreparedDraft,
} from "@/lib/scraper/incremental/ingest-runner";
import type { ApplyFinalIdentityResult } from "@/lib/scraper/incremental/final-identity-commit";
import type { SaveIncrementalArticleResult } from "@/lib/scraper/incremental/article-save-commit";

const logger = { info: () => {}, warn: () => {}, error: () => {} };
const ctx = { logger, job: { id: "job-1", payload: {} } as never };
const NOW = new Date("2026-07-19T19:00:00.000Z");

function runnerCandidate(overrides: Partial<RunnerCandidate> = {}): RunnerCandidate {
  return {
    id: "cand-1",
    providerKey: "prov-a",
    discoverySourceId: "src-1",
    status: CrawlCandidateStatus.DISCOVERED,
    observedInBaseline: false,
    articleId: null,
    ...overrides,
  };
}

function source(overrides: Partial<RunnerSource> = {}): RunnerSource {
  return { lifecycleMode: "ACTIVE", definitionVersion: 3, activatedAt: NOW, ...overrides };
}

const readyDraft: PreparedDraft = {
  kind: "draft",
  finalUrl: "https://example.com/a",
  canonicalUrl: "https://example.com/a",
  prose: "The quick brown fox jumped over the lazy dog many times over.",
  fields: { title: "A", content: "The quick brown fox." },
};

type RunnerHarness = {
  saveArgs: unknown[];
  applyArgs: unknown[];
  saveResult: SaveIncrementalArticleResult;
  applyResult: ApplyFinalIdentityResult;
};

function makeRunner(
  prepared: PreparedDraft,
  overrides: Partial<{
    candidate: RunnerCandidate;
    source: RunnerSource | null;
    context: null;
    applyResult: ApplyFinalIdentityResult;
    saveResult: SaveIncrementalArticleResult;
  }> = {},
) {
  const harness: RunnerHarness = {
    saveArgs: [],
    applyArgs: [],
    saveResult: overrides.saveResult ?? { action: "saved", candidateId: "cand-1", articleId: "art-1" },
    applyResult: overrides.applyResult ?? { action: "kept", winnerId: "cand-1", mergedLoserIds: [], jobsCancelled: 0 },
  };
  const runner = createIngestAttemptRunner({
    prepareDraft: async () => prepared,
    now: () => NOW,
    loadContext: async () =>
      overrides.context === null
        ? null
        : {
            candidate: overrides.candidate ?? runnerCandidate(),
            source: "source" in overrides ? (overrides.source ?? null) : source(),
          },
    applyFinalIdentityFn: async (args) => {
      harness.applyArgs.push(args);
      return harness.applyResult;
    },
    saveFn: async (args) => {
      harness.saveArgs.push(args);
      return harness.saveResult;
    },
  });
  return { runner, harness };
}

const ROW = { id: "cand-1", status: CrawlCandidateStatus.DISCOVERED, observedInBaseline: false, articleId: null, ingestAttemptCount: 0, firstIngestAttemptAt: null };

test("a fetch/extract failure surfaces as { ok: false, outcome } for #1093 to classify", async () => {
  const outcome = { kind: "fetch-timeout" } as const;
  const { runner, harness } = makeRunner({ kind: "failure", outcome });
  const res = await runner(ROW, ctx);
  assert.deepEqual(res, { ok: false, outcome });
  assert.equal(harness.saveArgs.length, 0, "no save on a fetch failure");
  assert.equal(harness.applyArgs.length, 0, "no resolution on a fetch failure");
});

test("a deterministic stop creates NO Article and returns { ok: true } (not a retry)", async () => {
  const { runner, harness } = makeRunner({ kind: "stop", reason: "trusted-outside-window" });
  const res = await runner(ROW, ctx);
  assert.deepEqual(res, { ok: true });
  assert.equal(harness.saveArgs.length, 0, "stop never saves");
  assert.equal(harness.applyArgs.length, 0, "stop never resolves");
});

test("a candidate that vanished between claim and attempt is a safe no-op", async () => {
  const { runner, harness } = makeRunner(readyDraft, { context: null });
  const res = await runner(ROW, ctx);
  assert.deepEqual(res, { ok: true });
  assert.equal(harness.saveArgs.length, 0);
});

test("a known / baseline identity is never re-ingested (no fetch, no save)", async () => {
  for (const c of [runnerCandidate({ articleId: "art-x" }), runnerCandidate({ observedInBaseline: true })]) {
    let prepared = false;
    const runner = createIngestAttemptRunner({
      prepareDraft: async () => {
        prepared = true;
        return readyDraft;
      },
      now: () => NOW,
      loadContext: async () => ({ candidate: c, source: source() }),
      applyFinalIdentityFn: async () => ({ action: "kept", winnerId: c.id, mergedLoserIds: [], jobsCancelled: 0 }),
      saveFn: async () => ({ action: "saved", candidateId: c.id, articleId: "art" }),
    });
    const res = await runner(ROW, ctx);
    assert.deepEqual(res, { ok: true });
    assert.equal(prepared, false, "a known/baseline identity never even fetches");
  }
});

for (const action of ["known-article-untouched", "noop-terminal", "routed-to-review"] as const) {
  test(`a '${action}' resolution creates NO Article and NO downstream job`, async () => {
    const applyResult =
      action === "noop-terminal"
        ? ({ action, candidateId: "cand-1", status: CrawlCandidateStatus.DUPLICATE_ALIAS } as ApplyFinalIdentityResult)
        : action === "routed-to-review"
          ? ({ action, candidateId: "cand-1", reason: "canonical-conflict", conflictId: "cf-1" } as ApplyFinalIdentityResult)
          : ({ action, candidateId: "cand-1" } as ApplyFinalIdentityResult);
    const { runner, harness } = makeRunner(readyDraft, { applyResult });
    const res = await runner(ROW, ctx);
    assert.deepEqual(res, { ok: true });
    assert.equal(harness.saveArgs.length, 0, "a non-keep resolution never saves");
  });
}

test("a 'kept' resolution saves with the winner id, owning provider key, and prose fingerprint", async () => {
  const { runner, harness } = makeRunner(readyDraft, {
    applyResult: { action: "kept", winnerId: "winner-7", mergedLoserIds: ["l1"], jobsCancelled: 1 },
  });
  const res = await runner(ROW, ctx);
  assert.deepEqual(res, { ok: true });
  assert.equal(harness.saveArgs.length, 1, "exactly one save");
  const arg = harness.saveArgs[0] as {
    candidateId: string;
    expectedProviderKey: string;
    draft: { sourceUrl: string; canonicalUrl: string | null };
    fingerprint: { version: number; hash: string } | null;
    sourceGeneration: { definitionVersion: number } | null;
  };
  assert.equal(arg.candidateId, "winner-7", "saves the resolved winner, not the raw candidate");
  assert.equal(arg.expectedProviderKey, "prov-a", "carries the owning provider key for revalidation");
  assert.equal(arg.draft.sourceUrl, "https://example.com/a");
  assert.ok(arg.fingerprint && arg.fingerprint.hash.length === 64, "versioned prose fingerprint attached");
  assert.equal(arg.sourceGeneration?.definitionVersion, 3, "source generation snapshot captured before fetch");
});

test("a 'transferred' resolution saves under the TARGET provider key", async () => {
  const { runner, harness } = makeRunner(readyDraft, {
    applyResult: { action: "transferred", winnerId: "w1", targetProviderKey: "prov-b", mergedLoserIds: [], jobsCancelled: 0 },
  });
  await runner(ROW, ctx);
  const arg = harness.saveArgs[0] as { expectedProviderKey: string };
  assert.equal(arg.expectedProviderKey, "prov-b", "revalidates against the transfer target owner");
});

test("a stale-generation save refusal returns { ok: true } — no retry loop, no job", async () => {
  const { runner, harness } = makeRunner(readyDraft, {
    saveResult: { action: "revalidation-failed", candidateId: "cand-1", reason: "stale-generation" },
  });
  const res = await runner(ROW, ctx);
  assert.deepEqual(res, { ok: true }, "a deterministic refusal completes the job, never a retry");
  assert.equal(harness.saveArgs.length, 1);
});

test("a source-less candidate passes a null generation snapshot (guard skipped)", async () => {
  const { runner, harness } = makeRunner(readyDraft, {
    candidate: runnerCandidate({ discoverySourceId: null }),
    source: null,
  });
  await runner(ROW, ctx);
  const arg = harness.saveArgs[0] as { sourceGeneration: unknown };
  assert.equal(arg.sourceGeneration, null, "no snapshot when the candidate has no source");
});
