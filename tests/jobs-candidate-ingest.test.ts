/**
 * Unit tests for the PURE candidate-based ARTICLE_INGEST payload / dedupe-key /
 * validation seam (#1091, Phase 2.1). No DB — covered by the unit coverage gate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CANDIDATE_INGEST_PROCESSING_VERSION,
  buildCandidateIngestPayload,
  candidateIngestDedupeKey,
  isCandidateIngestPayload,
  parseCandidateIngestPayload,
} from "@/lib/jobs/candidate-ingest";

test("candidateIngestDedupeKey has the exact documented shape", () => {
  assert.equal(candidateIngestDedupeKey("cand-1", 1), "article-ingest:candidate:cand-1:v1");
  assert.equal(candidateIngestDedupeKey("abc", 7), "article-ingest:candidate:abc:v7");
});

test("buildCandidateIngestPayload carries only candidateId + processingVersion (PII-free)", () => {
  const payload = buildCandidateIngestPayload("cand-1");
  assert.deepEqual(payload, {
    candidateId: "cand-1",
    processingVersion: CANDIDATE_INGEST_PROCESSING_VERSION,
  });
  // No URL / secret / article field ever leaks into the payload (AC4).
  assert.deepEqual(Object.keys(payload).sort(), ["candidateId", "processingVersion"]);
});

test("buildCandidateIngestPayload honors an explicit processing version", () => {
  assert.deepEqual(buildCandidateIngestPayload("cand-1", 3), {
    candidateId: "cand-1",
    processingVersion: 3,
  });
});

test("isCandidateIngestPayload only accepts a non-empty string candidateId", () => {
  assert.equal(isCandidateIngestPayload({ candidateId: "x", processingVersion: 1 }), true);
  assert.equal(isCandidateIngestPayload({ candidateId: "x" }), true);
  assert.equal(isCandidateIngestPayload({ candidateId: "" }), false);
  assert.equal(isCandidateIngestPayload({ url: "https://example.com" }), false);
  assert.equal(isCandidateIngestPayload({ articleId: "a1" }), false);
  assert.equal(isCandidateIngestPayload(null), false);
  assert.equal(isCandidateIngestPayload([]), false);
  assert.equal(isCandidateIngestPayload("candidate"), false);
});

test("parseCandidateIngestPayload normalizes and defaults processingVersion", () => {
  assert.deepEqual(parseCandidateIngestPayload({ candidateId: "c", processingVersion: 2 }), {
    candidateId: "c",
    processingVersion: 2,
  });
  // Missing / invalid version → controlled constant default.
  assert.deepEqual(parseCandidateIngestPayload({ candidateId: "c" }), {
    candidateId: "c",
    processingVersion: CANDIDATE_INGEST_PROCESSING_VERSION,
  });
  assert.deepEqual(parseCandidateIngestPayload({ candidateId: "c", processingVersion: 0 }), {
    candidateId: "c",
    processingVersion: CANDIDATE_INGEST_PROCESSING_VERSION,
  });
  assert.deepEqual(parseCandidateIngestPayload({ candidateId: "c", processingVersion: "2" }), {
    candidateId: "c",
    processingVersion: CANDIDATE_INGEST_PROCESSING_VERSION,
  });
});

test("parseCandidateIngestPayload rejects non-candidate payloads", () => {
  assert.equal(parseCandidateIngestPayload({ url: "https://example.com" }), null);
  assert.equal(parseCandidateIngestPayload({ articleId: "a1" }), null);
  assert.equal(parseCandidateIngestPayload({}), null);
  assert.equal(parseCandidateIngestPayload(null), null);
});
