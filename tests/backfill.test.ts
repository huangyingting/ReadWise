/**
 * Unit tests for src/lib/backfill.ts (RW-018).
 *
 * Uses the module's injectable `deps` so no DB or job queue is touched. Covers:
 * dry-run (enqueues/clears nothing), real enqueue (creates jobs for missing
 * content), idempotency (skips an article+feature that already has an active
 * job), the batch cap, rebuild mode (clears derived caches), translation
 * language scoping, and input validation.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

before(() => {
  // backfill.ts pulls in @/lib/jobs → @/lib/prisma at import; stub prisma so no
  // real client is constructed. The default deps are never used (we inject).
  mock.module("@/lib/prisma", { namedExports: { prisma: {} } });
});

type EnqueueCall = {
  type: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
};
type ClearCall = { articleId: string; stepKeys: string[] };

type Candidate = {
  id: string;
  difficulty: string | null;
  translations: { targetLang: string }[];
  speech: { articleId: string } | null;
  _count: {
    tags: number;
    vocabulary: number;
    quizQuestions: number;
    grammarExplanations: number;
  };
};

function candidate(partial: Partial<Candidate> = {}): Candidate {
  return {
    id: "article-1",
    difficulty: "B1",
    translations: [],
    speech: null,
    _count: { tags: 0, vocabulary: 1, quizQuestions: 0, grammarExplanations: 0 },
    ...partial,
  };
}

function makeDeps(candidates: Candidate[], activeKeys: string[] = []) {
  const enqueueCalls: EnqueueCall[] = [];
  const clearCalls: ClearCall[] = [];
  const deps = {
    loadCandidates: async () => candidates,
    findActiveDedupeKeys: async () => new Set(activeKeys),
    clearFeatures: async (articleId: string, stepKeys: string[]) => {
      clearCalls.push({ articleId, stepKeys });
    },
    enqueue: async (
      type: string,
      payload: Record<string, unknown>,
      dedupeKey: string,
    ) => {
      enqueueCalls.push({ type, payload, dedupeKey });
      return { id: `job-${enqueueCalls.length}` };
    },
  };
  return { deps, enqueueCalls, clearCalls };
}

test("dry-run reports the plan but enqueues and clears nothing", async () => {
  const { runBackfill } = await import("@/lib/processing/backfill");
  const { deps, enqueueCalls, clearCalls } = makeDeps([candidate()]);

  const result = await runBackfill({
    features: ["tags", "quiz"],
    reason: "new prompts",
    dryRun: true,
    deps,
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.matched, 2); // tags (0) + quiz (0); vocabulary already has 1
  assert.equal(result.enqueued, 0);
  assert.equal(enqueueCalls.length, 0);
  assert.equal(clearCalls.length, 0);
  assert.equal(result.plan.length, 2);
});

test("missing mode enqueues ARTICLE_PROCESS jobs only for missing features", async () => {
  const { runBackfill } = await import("@/lib/processing/backfill");
  const { deps, enqueueCalls } = makeDeps([candidate()]);

  const result = await runBackfill({
    features: ["tags", "vocabulary", "quiz"],
    reason: "backfill missing",
    deps,
  });

  assert.equal(result.enqueued, 2);
  const keys = enqueueCalls.map((c) => c.dedupeKey).sort();
  assert.deepEqual(keys, ["backfill:quiz:article-1", "backfill:tags:article-1"]);
  for (const call of enqueueCalls) {
    assert.equal(call.type, "ARTICLE_PROCESS");
    assert.equal(call.payload.articleId, "article-1");
    assert.equal(call.payload.reason, "backfill missing");
  }
});

test("idempotency: an active dedupeKey is skipped", async () => {
  const { runBackfill } = await import("@/lib/processing/backfill");
  const { deps, enqueueCalls } = makeDeps(
    [candidate()],
    ["backfill:tags:article-1"],
  );

  const result = await runBackfill({
    features: ["tags", "quiz"],
    reason: "retry",
    deps,
  });

  assert.equal(result.skippedExisting, 1);
  assert.equal(result.enqueued, 1);
  assert.deepEqual(
    enqueueCalls.map((c) => c.dedupeKey),
    ["backfill:quiz:article-1"],
  );
});

test("batch cap limits how many jobs are enqueued", async () => {
  const { runBackfill } = await import("@/lib/processing/backfill");
  const candidates = Array.from({ length: 5 }, (_, i) =>
    candidate({ id: `article-${i}`, _count: { tags: 0, vocabulary: 1, quizQuestions: 1, grammarExplanations: 1 } }),
  );
  const { deps, enqueueCalls } = makeDeps(candidates);

  const result = await runBackfill({
    features: ["tags"],
    reason: "capped",
    batchCap: 3,
    deps,
  });

  assert.equal(result.scanned, 5);
  assert.equal(result.matched, 5);
  assert.equal(result.cap, 3);
  assert.equal(result.enqueued, 3);
  assert.equal(enqueueCalls.length, 3);
});

test("rebuild mode clears derived caches and enqueues AI_REBUILD jobs", async () => {
  const { runBackfill } = await import("@/lib/processing/backfill");
  const { deps, enqueueCalls, clearCalls } = makeDeps([candidate()]);

  const result = await runBackfill({
    features: ["tags", "quiz"],
    mode: "rebuild",
    reason: "force rebuild",
    deps,
  });

  assert.equal(result.cleared, 1);
  assert.equal(clearCalls.length, 1);
  assert.deepEqual(clearCalls[0].stepKeys.sort(), ["quiz", "tags"]);
  assert.equal(enqueueCalls.length, 2);
  for (const call of enqueueCalls) {
    assert.equal(call.type, "AI_REBUILD");
  }
});

test("rebuild clearing never targets user-owned study data", async () => {
  const { runBackfill } = await import("@/lib/processing/backfill");
  const { deps, clearCalls } = makeDeps([candidate()]);

  await runBackfill({
    features: ["tags", "vocabulary", "quiz", "speech"],
    mode: "rebuild",
    reason: "rebuild",
    deps,
  });

  // Only derived feature keys are ever cleared — SavedWord/progress are not.
  for (const call of clearCalls) {
    for (const key of call.stepKeys) {
      assert.ok(
        ["tags", "vocabulary", "quiz", "speech"].includes(key),
        `unexpected clear target: ${key}`,
      );
    }
  }
});

test("translation backfill scopes work to each missing language", async () => {
  const { runBackfill } = await import("@/lib/processing/backfill");
  const { deps, enqueueCalls } = makeDeps([
    candidate({ translations: [{ targetLang: "es" }] }),
  ]);

  const result = await runBackfill({
    features: ["translation"],
    reason: "add french",
    translateLangs: ["es", "fr"],
    deps,
  });

  assert.equal(result.enqueued, 1);
  assert.equal(enqueueCalls[0].dedupeKey, "backfill:translation:fr:article-1");
  assert.deepEqual(enqueueCalls[0].payload.translateLangs, ["fr"]);
});

test("speech backfill carries the tts flag in the payload", async () => {
  const { runBackfill } = await import("@/lib/processing/backfill");
  const { deps, enqueueCalls } = makeDeps([candidate({ speech: null })]);

  await runBackfill({ features: ["speech"], reason: "narrate", deps });

  assert.equal(enqueueCalls.length, 1);
  assert.equal(enqueueCalls[0].payload.tts, true);
});

test("runBackfill rejects an empty feature set", async () => {
  const { runBackfill, BackfillError } = await import("@/lib/processing/backfill");
  await assert.rejects(
    () => runBackfill({ features: [], reason: "x" }),
    (err: unknown) => err instanceof BackfillError,
  );
});

test("runBackfill requires a reason", async () => {
  const { runBackfill, BackfillError } = await import("@/lib/processing/backfill");
  await assert.rejects(
    () => runBackfill({ features: ["tags"], reason: "  " }),
    (err: unknown) => err instanceof BackfillError,
  );
});
