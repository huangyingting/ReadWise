/**
 * THIN guarded persistence for candidate-based ingest recovery (#1093, Phase 2.3).
 *
 * Applies a PURE {@link IngestClassification} (from `ingest-outcome.ts`) to a
 * candidate — and, optionally, its in-flight ARTICLE_INGEST Job — and performs
 * bounded extractor-version REACTIVATION. Mirrors the house guarded-update
 * concurrency pattern (page-commit / claim): reads happen first, then a single
 * interactive transaction re-validates state via a guarded `updateMany` whose
 * `count === 0` throws and rolls the whole transaction back. That is what makes
 * retry / quarantine / reactivation DETERMINISTIC under worker restart and
 * stale-Job reclaim (AC4).
 *
 * GOVERNING INVARIANT (enforced in every guarded where-clause): recovery and
 * reactivation act ONLY on candidates with NO Article (`articleId == null`) that
 * are NOT baseline-observed and are in a recoverable/quarantined state. A known
 * public Article is NEVER retried, quarantined, reactivated, or refetched; an
 * extractor upgrade NEVER performs a content refresh of an existing Article.
 *
 * PRIVACY: only machine reason codes, counts, and timestamps are written — never
 * a response body, article text, URL, secret, cookie, or authorization detail.
 */
import { CrawlCandidateStatus, JobStatus, JobType, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/observability/logger";
import { enqueueJobInTx } from "@/lib/jobs/enqueue";
import {
  buildCandidateIngestPayload,
  candidateIngestDedupeKey,
} from "@/lib/jobs/candidate-ingest";

import {
  REACTIVATABLE_FAILURE_REASONS,
  isReactivationEligible,
  type IngestClassification,
  type IngestFailureReason,
} from "./ingest-outcome";

const log = createLogger("ingest-recovery");

/**
 * Candidate statuses from which an ingest attempt outcome may still transition
 * the candidate: an in-progress, no-Article ingest. Excludes every terminal /
 * parked / known state (INGESTED, REJECTED, SKIPPED, QUARANTINED, CONFLICT,
 * DUPLICATE_ALIAS, NEEDS_REVIEW, BASELINE) so a known/terminal identity is never
 * revived (governing invariant).
 */
export const RECOVERABLE_CANDIDATE_STATUSES: readonly CrawlCandidateStatus[] = [
  CrawlCandidateStatus.DISCOVERED,
  CrawlCandidateStatus.QUEUED,
  CrawlCandidateStatus.INGESTING,
  CrawlCandidateStatus.FAILED,
];

/** Reactivatable machine reason codes as plain strings for a Prisma `in` filter. */
const REACTIVATABLE_REASON_STRINGS: string[] = [...REACTIVATABLE_FAILURE_REASONS];

/** Optional in-flight Job context to transition ATOMICALLY with the candidate. */
export type IngestJobContext = {
  jobId: string;
  /** Lock owner; the guarded Job update requires RUNNING + this owner (AC4). */
  workerId: string;
};

export type ApplyIngestClassificationParams = {
  candidateId: string;
  classification: IngestClassification;
  now: Date;
  /** Extractor/processing version that produced this outcome (recorded for reactivation gating). */
  extractorVersion: number;
  /** When present, the ARTICLE_INGEST Job is transitioned in the SAME transaction. */
  job?: IngestJobContext;
};

export type ApplyIngestClassificationResult =
  | { applied: "retry" | "quarantine" | "terminal" }
  | { skipped: "not-found" | "invariant" | "conflict" };

/** Internal signal that a guarded update matched zero rows → roll the tx back. */
class RecoveryConflictError extends Error {
  constructor() {
    super("ingest recovery guarded update matched no rows (state changed concurrently)");
    this.name = "RecoveryConflictError";
  }
}

type CandidateRecoveryRow = {
  status: CrawlCandidateStatus;
  observedInBaseline: boolean;
  articleId: string | null;
  firstIngestAttemptAt: Date | null;
};

function releaseLock(): { lockedBy: null; lockedAt: null } {
  return { lockedBy: null, lockedAt: null };
}

/**
 * Applies an ingest-attempt classification to a candidate atomically.
 *
 * - `retry`      → keep the candidate recoverable, bump `ingestAttemptCount`,
 *                  record `nextAttemptAt` + `lastFailureReason`; reschedule the
 *                  Job (FAILED, `runAfter = nextAttemptAt`) when a Job context is
 *                  supplied.
 * - `quarantine-on-exhaustion` → move the candidate to QUARANTINED (ONE visible
 *                  resting state, never re-enqueued by rescans); dead-letter the
 *                  Job when supplied.
 * - `terminal`   → move the candidate to REJECTED (permanent 410 / access /
 *                  client error); dead-letter the Job when supplied.
 *
 * Returns `{ skipped }` without mutating when the candidate is missing, violates
 * the governing invariant (has an Article / is baseline / is not recoverable),
 * or the guarded update lost a concurrency race (safe under restart + reclaim).
 */
export async function applyIngestClassification(
  params: ApplyIngestClassificationParams,
): Promise<ApplyIngestClassificationResult> {
  const { candidateId, classification, now, extractorVersion, job } = params;

  try {
    return await prisma.$transaction(async (tx) => {
      const candidate = (await tx.crawlCandidate.findUnique({
        where: { id: candidateId },
        select: {
          status: true,
          observedInBaseline: true,
          articleId: true,
          firstIngestAttemptAt: true,
        },
      })) as CandidateRecoveryRow | null;

      if (!candidate) return { skipped: "not-found" } as const;
      if (
        candidate.articleId != null ||
        candidate.observedInBaseline ||
        !RECOVERABLE_CANDIDATE_STATUSES.includes(candidate.status)
      ) {
        return { skipped: "invariant" } as const;
      }

      const firstIngestAttemptAt = candidate.firstIngestAttemptAt ?? now;
      const reason = classification.reason;

      const candidateData = buildCandidateRecoveryData(
        classification,
        reason,
        now,
        extractorVersion,
        firstIngestAttemptAt,
      );

      // Guarded candidate transition: re-validates the governing invariant under
      // the lock. A zero-row update means the candidate changed concurrently
      // (already terminal / linked / reclaimed) → roll back.
      const updated = await tx.crawlCandidate.updateMany({
        where: {
          id: candidateId,
          articleId: null,
          observedInBaseline: false,
          status: { in: [...RECOVERABLE_CANDIDATE_STATUSES] },
        },
        data: candidateData.data,
      });
      if (updated.count === 0) throw new RecoveryConflictError();

      if (job) {
        await transitionIngestJob(tx, job, classification, reason, now);
      }

      return { applied: candidateData.applied } as const;
    });
  } catch (error) {
    if (error instanceof RecoveryConflictError) return { skipped: "conflict" };
    throw error;
  }
}

function buildCandidateRecoveryData(
  classification: IngestClassification,
  reason: IngestFailureReason,
  now: Date,
  extractorVersion: number,
  firstIngestAttemptAt: Date,
): { applied: "retry" | "quarantine" | "terminal"; data: Prisma.CrawlCandidateUpdateManyMutationInput } {
  const base = {
    lastFailureReason: reason,
    extractorVersion,
    firstIngestAttemptAt,
    updatedAt: now,
  };

  if (classification.disposition === "retry") {
    return {
      applied: "retry",
      data: {
        ...base,
        ingestAttemptCount: { increment: 1 },
        nextAttemptAt: classification.nextAttemptAt ?? null,
      },
    };
  }

  if (classification.disposition === "terminal") {
    return {
      applied: "terminal",
      data: {
        ...base,
        status: CrawlCandidateStatus.REJECTED,
        terminalReason: reason,
        terminalAt: now,
        nextAttemptAt: null,
      },
    };
  }

  // quarantine-on-exhaustion
  return {
    applied: "quarantine",
    data: {
      ...base,
      status: CrawlCandidateStatus.QUARANTINED,
      terminalReason: reason,
      terminalAt: now,
      ingestAttemptCount: { increment: 1 },
      nextAttemptAt: null,
    },
  };
}

async function transitionIngestJob(
  tx: Prisma.TransactionClient,
  job: IngestJobContext,
  classification: IngestClassification,
  reason: IngestFailureReason,
  now: Date,
): Promise<void> {
  const data =
    classification.disposition === "retry"
      ? {
          status: JobStatus.FAILED,
          runAfter: classification.nextAttemptAt ?? now,
          attempts: { increment: 1 },
          lastError: reason,
          failedAt: now,
          ...releaseLock(),
          updatedAt: now,
        }
      : {
          status: JobStatus.DEAD_LETTER,
          attempts: { increment: 1 },
          lastError: reason,
          failedAt: now,
          deadLetteredAt: now,
          ...releaseLock(),
          updatedAt: now,
        };

  // Guarded Job transition: only the current RUNNING owner may finalize it, so a
  // stale worker whose lock was reclaimed cannot overwrite the reclaimer's state.
  // A zero-row update rolls back the candidate transition too (AC4 atomicity).
  const updated = await tx.job.updateMany({
    where: { id: job.jobId, lockedBy: job.workerId, status: JobStatus.RUNNING },
    data,
  });
  if (updated.count === 0) throw new RecoveryConflictError();
}

// ---------------------------------------------------------------------------
// Extractor-version reactivation (thin persistence).
// ---------------------------------------------------------------------------

export type ReactivateCandidateResult =
  | { reactivated: true; jobId: string; dedupeKey: string; processingVersion: number }
  | { reactivated: false; reason: "not-found" | "ineligible" | "conflict" };

/**
 * Reactivates ONE quarantined no-Article extraction/quality failure for a newer
 * extractor version, atomically:
 *   1. re-checks eligibility under the guarded update,
 *   2. bumps the candidate's ingest/extractor version + resets attempt metadata
 *      and returns it to DISCOVERED, and
 *   3. enqueues a NEW ARTICLE_INGEST Job keyed on the BUMPED processing-version
 *      dedupe key.
 *
 * The prior terminal Job (keyed on the old version) is left INTACT for audit
 * history — reactivation never resets or deletes it. `newExtractorVersion`
 * doubles as the new dedupe-key processing version, so it MUST exceed the
 * candidate's recorded `extractorVersion` (guaranteed by the eligibility check).
 */
export async function reactivateCandidate(
  candidateId: string,
  newExtractorVersion: number,
  now: Date = new Date(),
): Promise<ReactivateCandidateResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const candidate = await tx.crawlCandidate.findUnique({
        where: { id: candidateId },
        select: {
          id: true,
          status: true,
          observedInBaseline: true,
          articleId: true,
          lastFailureReason: true,
          extractorVersion: true,
        },
      });
      if (!candidate) return { reactivated: false, reason: "not-found" } as const;
      if (
        !isReactivationEligible(
          {
            id: candidate.id,
            status: candidate.status,
            observedInBaseline: candidate.observedInBaseline,
            articleId: candidate.articleId,
            lastFailureReason: candidate.lastFailureReason,
            extractorVersion: candidate.extractorVersion,
          },
          newExtractorVersion,
        )
      ) {
        return { reactivated: false, reason: "ineligible" } as const;
      }

      // Guarded reactivation: re-validate the full eligibility predicate under
      // the lock so two concurrent reactivations cannot both win (AC4).
      const updated = await tx.crawlCandidate.updateMany({
        where: {
          id: candidateId,
          articleId: null,
          observedInBaseline: false,
          status: CrawlCandidateStatus.QUARANTINED,
          lastFailureReason: { in: REACTIVATABLE_REASON_STRINGS },
          OR: [{ extractorVersion: null }, { extractorVersion: { lt: newExtractorVersion } }],
        },
        data: {
          status: CrawlCandidateStatus.DISCOVERED,
          extractorVersion: newExtractorVersion,
          processingVersion: String(newExtractorVersion),
          ingestAttemptCount: 0,
          nextAttemptAt: null,
          firstIngestAttemptAt: null,
          lastFailureReason: null,
          terminalReason: null,
          terminalAt: null,
          updatedAt: now,
        },
      });
      if (updated.count === 0) throw new RecoveryConflictError();

      // Enqueue a fresh ARTICLE_INGEST Job on the BUMPED dedupe key. The prior
      // terminal Job (old version key) is untouched → audit history preserved.
      const dedupeKey = candidateIngestDedupeKey(candidateId, newExtractorVersion);
      const enqueued = await enqueueJobInTx(
        tx,
        JobType.ARTICLE_INGEST,
        buildCandidateIngestPayload(candidateId, newExtractorVersion),
        dedupeKey,
        { runAfter: now },
      );

      return {
        reactivated: true,
        jobId: enqueued.id,
        dedupeKey,
        processingVersion: newExtractorVersion,
      } as const;
    });
  } catch (error) {
    if (error instanceof RecoveryConflictError) {
      return { reactivated: false, reason: "conflict" };
    }
    throw error;
  }
}

export type ReactivateEligibleResult = {
  scanned: number;
  reactivated: number;
  conflicts: number;
  skipped: number;
};

/**
 * Bounded batch reactivation for an extractor-version upgrade. Selects at most
 * `budget` eligible quarantined no-Article extraction/quality failures (oldest
 * first) and reactivates each. Budget-limited so a version bump can never
 * stampede the whole quarantine backlog (AC3).
 */
export async function reactivateEligibleCandidates(
  newExtractorVersion: number,
  budget: number,
  now: Date = new Date(),
): Promise<ReactivateEligibleResult> {
  const summary: ReactivateEligibleResult = { scanned: 0, reactivated: 0, conflicts: 0, skipped: 0 };
  if (budget <= 0) return summary;

  const eligible = await prisma.crawlCandidate.findMany({
    where: {
      status: CrawlCandidateStatus.QUARANTINED,
      articleId: null,
      observedInBaseline: false,
      lastFailureReason: { in: REACTIVATABLE_REASON_STRINGS },
      OR: [{ extractorVersion: null }, { extractorVersion: { lt: newExtractorVersion } }],
    },
    orderBy: [{ firstObservedAt: "asc" }, { id: "asc" }],
    take: budget,
    select: { id: true },
  });

  summary.scanned = eligible.length;
  for (const candidate of eligible) {
    const result = await reactivateCandidate(candidate.id, newExtractorVersion, now);
    if (result.reactivated) summary.reactivated += 1;
    else if (result.reason === "conflict") summary.conflicts += 1;
    else summary.skipped += 1;
  }

  log.info("extractor-version reactivation pass complete", {
    newExtractorVersion,
    budget,
    ...summary,
  });
  return summary;
}
