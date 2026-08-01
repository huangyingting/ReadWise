/** Default database-context coverage for the candidate ingest runner. */
process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

import type { RunnerCandidate, RunnerSource } from "@/lib/scraper/incremental/ingest-runner";

let candidateRow: RunnerCandidate | null = null;
let sourceRow: RunnerSource | null = null;
const candidateFindCalls: unknown[] = [];
const sourceFindCalls: unknown[] = [];

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        crawlCandidate: {
          findUnique: async (args: unknown) => {
            candidateFindCalls.push(args);
            return candidateRow;
          },
        },
        discoverySource: {
          findUnique: async (args: unknown) => {
            sourceFindCalls.push(args);
            return sourceRow;
          },
        },
      },
    },
  });
});

beforeEach(() => {
  candidateRow = null;
  sourceRow = null;
  candidateFindCalls.length = 0;
  sourceFindCalls.length = 0;
});

const logger = { info: () => {}, warn: () => {}, error: () => {} };
const context = { logger, job: { id: "job-default-context", payload: {} } as never };
const claimedCandidate = {
  id: "candidate-default-context",
  status: "DISCOVERED",
  observedInBaseline: false,
  articleId: null,
  ingestAttemptCount: 0,
  firstIngestAttemptAt: null,
} as never;

function candidate(overrides: Partial<RunnerCandidate> = {}): RunnerCandidate {
  return {
    id: "candidate-default-context",
    providerKey: "provider-default-context",
    discoverySourceId: "source-default-context",
    status: "DISCOVERED",
    observedInBaseline: false,
    articleId: null,
    ...overrides,
  } as RunnerCandidate;
}

function source(): RunnerSource {
  return {
    lifecycleMode: "ACTIVE",
    definitionVersion: 4,
    activatedAt: new Date("2026-07-31T13:00:00.000Z"),
    activationGeneration: 2,
  };
}

test("default context treats a candidate deleted after claim as a safe no-op", async () => {
  const { createIngestAttemptRunner } = await import("@/lib/scraper/incremental/ingest-runner");
  let prepared = false;
  const runner = createIngestAttemptRunner({
    prepareDraft: async () => {
      prepared = true;
      return { kind: "stop", reason: "unexpected" };
    },
  });

  assert.deepEqual(await runner(claimedCandidate, context), { ok: true });
  assert.equal(prepared, false);
  assert.equal(candidateFindCalls.length, 1);
  assert.equal(sourceFindCalls.length, 0);
});

test("default context passes a null source for a source-less candidate", async () => {
  const { createIngestAttemptRunner } = await import("@/lib/scraper/incremental/ingest-runner");
  candidateRow = candidate({ discoverySourceId: null });
  let preparedSource: RunnerSource | null | undefined;
  const runner = createIngestAttemptRunner({
    prepareDraft: async ({ source: loadedSource }) => {
      preparedSource = loadedSource;
      return { kind: "stop", reason: "covered" };
    },
  });

  assert.deepEqual(await runner(claimedCandidate, context), { ok: true });
  assert.equal(preparedSource, null);
  assert.equal(candidateFindCalls.length, 1);
  assert.equal(sourceFindCalls.length, 0);
});

test("default context loads and passes the candidate discovery source", async () => {
  const { createIngestAttemptRunner } = await import("@/lib/scraper/incremental/ingest-runner");
  candidateRow = candidate();
  sourceRow = source();
  let preparedSource: RunnerSource | null | undefined;
  const runner = createIngestAttemptRunner({
    prepareDraft: async ({ source: loadedSource }) => {
      preparedSource = loadedSource;
      return { kind: "stop", reason: "covered" };
    },
  });

  assert.deepEqual(await runner(claimedCandidate, context), { ok: true });
  assert.deepEqual(preparedSource, sourceRow);
  assert.equal(candidateFindCalls.length, 1);
  assert.equal(sourceFindCalls.length, 1);
});
