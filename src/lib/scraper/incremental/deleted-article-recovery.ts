/**
 * Deletion governance + explicit recovery for the discovery ledger (issue #1104,
 * Phase 3.5).
 *
 * When an operator deletes a public Article, its producing CrawlCandidate SURVIVES
 * (`articleId` is SetNull) so the identity is never auto-recreated. This module:
 *
 *   - {@link markArticleCandidatesDeletedInTx} — stamps a permanent DELETED
 *     outcome (`articleDeletedAt` + a controlled `governance:article-deleted`
 *     terminalReason) on every candidate that produced the Article, INSIDE the
 *     Article-delete transaction (atomic, AC2). Normal discovery/backfill then
 *     treat the surviving candidate as a KNOWN identity and never revive it.
 *   - {@link recoverDeletedCandidate} — the EXPLICIT, audited operator action that
 *     RE-ADMITS a deleted identity for re-ingestion (clears the deleted terminal,
 *     bumps the extractor/processing version for a FRESH ingest dedupe key, and
 *     enqueues one ARTICLE_INGEST Job). This is NOT a content restore. Mirrors the
 *     guarded reactivation in `ingest-recovery.ts` (AC4).
 *   - {@link listDeletedCandidates} — the sanitized queue of deleted identities an
 *     operator may recover.
 *
 * GOVERNING INVARIANT: nothing here runs automatically — normal incremental
 * scheduling never polls or mutates old Articles; recovery is operator-only.
 *
 * PRIVACY: only ids, versioned identity HASHES, counts, timestamps, and machine
 * reason CATEGORIES are read/written — never a URL, body, secret, or article text.
 */
import { CrawlCandidateStatus, JobType, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  CANDIDATE_INGEST_PROCESSING_VERSION,
  buildCandidateIngestPayload,
  candidateIngestDedupeKey,
  enqueueJobInTx,
} from "@/lib/jobs";

// Re-export the Article-delete stamp from its dependency-light leaf so callers can
// import all deletion-governance helpers from this module.
export { markArticleCandidatesDeletedInTx } from "./candidate-deletion-stamp";

// ---------------------------------------------------------------------------
// Explicit, audited recovery (re-admission for re-ingestion).
// ---------------------------------------------------------------------------

export type RecoverDeletedCandidateOutcome =
  | {
      ok: true;
      kind: "recovered";
      candidateId: string;
      jobId: string;
      dedupeKey: string;
      processingVersion: number;
    }
  | { ok: false; reason: "not-found"; candidateId: string }
  | { ok: false; reason: "ineligible"; candidateId: string; status: CrawlCandidateStatus }
  | { ok: false; reason: "conflict"; candidateId: string };

/** Internal signal that the guarded re-admission matched zero rows → roll back. */
class RecoveryRaceError extends Error {
  constructor() {
    super("deleted-candidate recovery guarded update matched no rows (state changed concurrently)");
    this.name = "RecoveryRaceError";
  }
}

/**
 * Re-admits ONE deleted identity for re-ingestion, atomically. Eligible only when
 * the candidate is a DELETED outcome (`articleDeletedAt` set AND `articleId` null);
 * a candidate that still links an Article is NEVER touched (governing invariant).
 * Clears the deleted terminal, resets ingest metadata, bumps the extractor/
 * processing version so the enqueued ARTICLE_INGEST Job uses a FRESH dedupe key
 * (the historical terminal Job is left intact for audit), and returns the new Job.
 */
export async function recoverDeletedCandidate(
  candidateId: string,
  now: Date = new Date(),
): Promise<RecoverDeletedCandidateOutcome> {
  try {
    return await prisma.$transaction(async (tx) => {
      const candidate = await tx.crawlCandidate.findUnique({
        where: { id: candidateId },
        select: { id: true, status: true, articleId: true, articleDeletedAt: true, extractorVersion: true },
      });
      if (!candidate) return { ok: false, reason: "not-found", candidateId } as const;
      if (candidate.articleId != null || candidate.articleDeletedAt == null) {
        return { ok: false, reason: "ineligible", candidateId, status: candidate.status } as const;
      }

      const processingVersion = Math.max(
        CANDIDATE_INGEST_PROCESSING_VERSION,
        (candidate.extractorVersion ?? 0) + 1,
      );

      // Guarded re-admission: re-check the DELETED predicate under the lock so two
      // concurrent recoveries cannot both win (AC4).
      const updated = await tx.crawlCandidate.updateMany({
        where: { id: candidateId, articleId: null, articleDeletedAt: { not: null } },
        data: {
          status: CrawlCandidateStatus.DISCOVERED,
          articleDeletedAt: null,
          terminalReason: null,
          terminalAt: null,
          ingestedAt: null,
          ingestAttemptCount: 0,
          nextAttemptAt: null,
          firstIngestAttemptAt: null,
          lastFailureReason: null,
          extractorVersion: processingVersion,
          processingVersion: String(processingVersion),
          updatedAt: now,
        },
      });
      if (updated.count === 0) throw new RecoveryRaceError();

      const dedupeKey = candidateIngestDedupeKey(candidateId, processingVersion);
      const job = await enqueueJobInTx(
        tx,
        JobType.ARTICLE_INGEST,
        buildCandidateIngestPayload(candidateId, processingVersion),
        dedupeKey,
        { runAfter: now },
      );

      return {
        ok: true,
        kind: "recovered",
        candidateId,
        jobId: job.id,
        dedupeKey,
        processingVersion,
      } as const;
    });
  } catch (error) {
    if (error instanceof RecoveryRaceError) return { ok: false, reason: "conflict", candidateId };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Deleted-identity queue query (sanitized DTOs).
// ---------------------------------------------------------------------------

/** A single sanitized deleted-identity DTO (never a URL/body/content). */
export type DeletedCandidateDto = {
  id: string;
  providerKey: string;
  discoverySourceId: string | null;
  identityVersion: number;
  /** Sanitized versioned identity hash (`<version>:<sha256hex>`) — never a URL. */
  provisionalKey: string;
  canonicalKey: string | null;
  status: CrawlCandidateStatus;
  /** Machine reason CATEGORY (`governance:article-deleted`). */
  terminalReason: string | null;
  articleDeletedAt: Date | null;
  ingestedAt: Date | null;
  firstObservedAt: Date;
  lastObservedAt: Date;
  observationCount: number;
};

export type DeletedCandidatePage = {
  candidates: DeletedCandidateDto[];
  total: number;
  offset: number;
  limit: number;
};

export type DeletedCandidateFilter = {
  providerKey?: string;
  offset?: number;
  limit?: number;
};

const DELETED_CANDIDATE_SELECT = {
  id: true,
  providerKey: true,
  discoverySourceId: true,
  identityVersion: true,
  provisionalKey: true,
  canonicalKey: true,
  status: true,
  terminalReason: true,
  articleDeletedAt: true,
  ingestedAt: true,
  firstObservedAt: true,
  lastObservedAt: true,
  observationCount: true,
} satisfies Prisma.CrawlCandidateSelect;

/**
 * Lists deleted identities (candidates with a stamped `articleDeletedAt` and no
 * live Article) an operator may explicitly recover, most-recently-deleted first,
 * with an optional provider filter and offset/limit pagination.
 */
export async function listDeletedCandidates(
  filter: DeletedCandidateFilter = {},
): Promise<DeletedCandidatePage> {
  const where: Prisma.CrawlCandidateWhereInput = {
    articleDeletedAt: { not: null },
    articleId: null,
  };
  if (filter.providerKey) where.providerKey = filter.providerKey;

  const offset = Math.max(0, filter.offset ?? 0);
  const limit = Math.min(Math.max(1, filter.limit ?? 50), 200);

  const [total, rows] = await Promise.all([
    prisma.crawlCandidate.count({ where }),
    prisma.crawlCandidate.findMany({
      where,
      select: DELETED_CANDIDATE_SELECT,
      orderBy: [{ articleDeletedAt: "desc" }, { id: "asc" }],
      skip: offset,
      take: limit,
    }),
  ]);

  return { candidates: rows, total, offset, limit };
}
