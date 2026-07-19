/**
 * Candidate-based ARTICLE_INGEST payload, dedupe-key, and validation (#1091,
 * Phase 2.1).
 *
 * PURE logic only — no database or network access — so it is unit-testable
 * without a DB and stays covered by the unit-only coverage gate.
 *
 * Incremental ingestion enqueues durable work keyed on the ledger CANDIDATE
 * identity, never on a URL: the Job payload carries ONLY `{ candidateId,
 * processingVersion }`. It never stores a URL, provider policy, credentials,
 * article data, or any mutable candidate field (governing privacy rule + AC4).
 * The worker resolves the candidate from the database at execution time.
 *
 * The dedupe key `article-ingest:candidate:<candidateId>:v<processingVersion>`
 * makes concurrent/replayed enqueues converge on ONE Job and makes a terminal
 * Job for that candidate/version reused (never recreated) by ordinary
 * rediscovery (AC2/AC3).
 */
import type { CandidateIngestPayload } from "./types";

export type { CandidateIngestPayload };

/**
 * Controlled processing version for candidate-based ingestion enqueue. A
 * code-defined constant (no candidate column needed): bumping it in code starts
 * a fresh, independently-deduped ingestion attempt for the same candidate
 * without disturbing prior terminal Job history.
 */
export const CANDIDATE_INGEST_PROCESSING_VERSION = 1;

/**
 * Deterministic dedupe key for candidate-based ingest work. Concurrent or
 * replayed enqueues of the same candidate/version converge on one Job.
 */
export function candidateIngestDedupeKey(
  candidateId: string,
  processingVersion: number,
): string {
  return `article-ingest:candidate:${candidateId}:v${processingVersion}`;
}

/** Builds the PII-free candidate-based ingest payload. */
export function buildCandidateIngestPayload(
  candidateId: string,
  processingVersion: number = CANDIDATE_INGEST_PROCESSING_VERSION,
): CandidateIngestPayload {
  return { candidateId, processingVersion };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * True when a Job payload is a candidate-based ingest payload (has a non-empty
 * string `candidateId`). Used by the worker to distinguish the incremental
 * candidate path from the legacy url/articleId ArticleIngest path.
 */
export function isCandidateIngestPayload(payload: unknown): payload is CandidateIngestPayload {
  return isRecord(payload) && typeof payload.candidateId === "string" && payload.candidateId.length > 0;
}

/**
 * Validates + normalizes a candidate-based ingest payload. Returns the parsed
 * payload, or `null` when it is not a well-formed candidate payload. A missing
 * or non-numeric `processingVersion` defaults to the controlled constant.
 */
export function parseCandidateIngestPayload(payload: unknown): CandidateIngestPayload | null {
  if (!isCandidateIngestPayload(payload)) return null;
  const raw = (payload as Record<string, unknown>).processingVersion;
  const processingVersion =
    typeof raw === "number" && Number.isInteger(raw) && raw > 0
      ? raw
      : CANDIDATE_INGEST_PROCESSING_VERSION;
  return { candidateId: payload.candidateId, processingVersion };
}
