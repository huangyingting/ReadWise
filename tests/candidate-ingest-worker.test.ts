/**
 * Unit tests for the candidate-based ARTICLE_INGEST worker handler (#1091,
 * Phase 2.1). Uses an injected `loadCandidate` fake (no DB). Proves the handler
 * resolves + validates the candidate, guards the governing invariant (known /
 * terminal / linked candidates are a safe no-op — never re-ingested), and stops
 * at the #1095 hand-off boundary without fetching/creating an Article.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { CrawlCandidateStatus } from "@prisma/client";

import { makeCandidateIngestHandler, type CandidateIngestRow } from "@/lib/worker/registry";
import { JobError } from "@/lib/jobs";

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function job(payload: unknown): never {
  return { id: "job-1", payload } as never;
}

function candidate(overrides: Partial<CandidateIngestRow> = {}): CandidateIngestRow {
  return {
    id: "cand-1",
    status: CrawlCandidateStatus.DISCOVERED,
    observedInBaseline: false,
    articleId: null,
    ...overrides,
  };
}

test("rejects a payload with no candidateId as a permanent validation failure", async () => {
  const handler = makeCandidateIngestHandler(async () => candidate());
  await assert.rejects(
    () => handler(job({ url: "https://example.com" }), { logger }),
    (err: unknown) => err instanceof JobError && err.kind === "validation" && err.permanent,
  );
});

test("missing candidate is a permanent 'missing' failure", async () => {
  const handler = makeCandidateIngestHandler(async () => null);
  await assert.rejects(
    () => handler(job({ candidateId: "gone", processingVersion: 1 }), { logger }),
    (err: unknown) => err instanceof JobError && err.kind === "missing" && err.permanent,
  );
});

test("resolves an eligible DISCOVERED candidate and stops at the #1095 hand-off (no throw)", async () => {
  let loadedId: string | undefined;
  const handler = makeCandidateIngestHandler(async (id) => {
    loadedId = id;
    return candidate({ id });
  });
  await handler(job({ candidateId: "cand-9", processingVersion: 1 }), { logger });
  assert.equal(loadedId, "cand-9", "candidate resolved by id at execution time");
});

test("terminal / baseline / already-linked candidates are a safe no-op (never re-ingested)", async () => {
  for (const c of [
    candidate({ status: CrawlCandidateStatus.INGESTED }),
    candidate({ status: CrawlCandidateStatus.REJECTED }),
    candidate({ status: CrawlCandidateStatus.SKIPPED }),
    candidate({ observedInBaseline: true }),
    candidate({ articleId: "article-1" }),
  ]) {
    const handler = makeCandidateIngestHandler(async () => c);
    // Must NOT throw — a known/terminal identity is a completed no-op.
    await handler(job({ candidateId: c.id, processingVersion: 1 }), { logger });
  }
});
