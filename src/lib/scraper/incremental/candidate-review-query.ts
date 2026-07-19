/**
 * Thin candidate-review QUERY layer (issue #1100, Phase 3.1).
 *
 * Reads the review queue (NEEDS_REVIEW candidates) and single-candidate detail as
 * SANITIZED, metadata-only DTOs for the capability-gated admin API. Every field
 * is a controlled id, versioned identity HASH (`<version>:<sha256hex>` — never a
 * raw URL), status enum, count, timestamp, or sanitized reason CATEGORY. It never
 * reads or returns a raw URL, response body, secret, article text, or any
 * user-private content, and it NEVER mutates state or enqueues work.
 *
 * The review queue deliberately spans the two operator-facing review statuses:
 * NEEDS_REVIEW (awaiting a decision) and SKIPPED_REVIEW (rejected — visible so an
 * operator can reactivate one). The `status` filter defaults to NEEDS_REVIEW.
 */
import {
  CrawlCandidateStatus,
  type CandidateDateProvenance,
  type CanonicalConflictStatus,
  type Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

/** The two operator-facing review statuses a candidate-review list may filter on. */
export const REVIEW_QUEUE_STATUSES = [
  CrawlCandidateStatus.NEEDS_REVIEW,
  CrawlCandidateStatus.SKIPPED_REVIEW,
] as const;
export type ReviewQueueStatus = (typeof REVIEW_QUEUE_STATUSES)[number];

/** A sanitized canonical-conflict summary surfaced in the detail DTO. */
export type ReviewConflictDto = {
  id: string;
  status: CanonicalConflictStatus;
  /** Machine reason category — never a URL/body. */
  reason: string | null;
  detectedAt: Date;
  resolvedAt: Date | null;
};

/** A single sanitized review-candidate DTO (list + detail share these fields). */
export type ReviewCandidateDto = {
  id: string;
  providerKey: string;
  discoverySourceId: string | null;
  identityVersion: number;
  /** Sanitized versioned identity hash (`<version>:<sha256hex>`) — never a URL. */
  provisionalKey: string;
  canonicalKey: string | null;
  status: CrawlCandidateStatus;
  /** True when first seen during the source baseline (a known, pre-existing id). */
  observedInBaseline: boolean;
  firstObservedAt: Date;
  lastObservedAt: Date;
  observationCount: number;
  /** Why the candidate is parked for review (sanitized reason category). */
  reviewReason: string | null;
  terminalAt: Date | null;
  dateProvenance: CandidateDateProvenance;
  trustedPublishedAt: Date | null;
  /** Last machine ingest-failure reason category (never a body/secret). */
  lastFailureReason: string | null;
  ingestAttemptCount: number;
  /** True when the candidate already links a public Article (blocks all review actions). */
  hasArticle: boolean;
};

/** The detail DTO adds the candidate's sanitized conflict history. */
export type ReviewCandidateDetailDto = ReviewCandidateDto & {
  conflicts: ReviewConflictDto[];
};

/** A bounded, filtered page of review candidates + the total match count. */
export type ReviewCandidatePage = {
  candidates: ReviewCandidateDto[];
  total: number;
  offset: number;
  limit: number;
};

/** Filters for {@link listReviewCandidates}. */
export type ReviewCandidateFilter = {
  /** Which review status to list (defaults to NEEDS_REVIEW). */
  status?: ReviewQueueStatus;
  providerKey?: string;
  discoverySourceId?: string;
  offset?: number;
  limit?: number;
};

const CANDIDATE_DTO_SELECT = {
  id: true,
  providerKey: true,
  discoverySourceId: true,
  identityVersion: true,
  provisionalKey: true,
  canonicalKey: true,
  status: true,
  observedInBaseline: true,
  firstObservedAt: true,
  lastObservedAt: true,
  observationCount: true,
  terminalReason: true,
  terminalAt: true,
  dateProvenance: true,
  trustedPublishedAt: true,
  lastFailureReason: true,
  ingestAttemptCount: true,
  articleId: true,
} satisfies Prisma.CrawlCandidateSelect;

type CandidateRow = Prisma.CrawlCandidateGetPayload<{ select: typeof CANDIDATE_DTO_SELECT }>;

function toDto(row: CandidateRow): ReviewCandidateDto {
  return {
    id: row.id,
    providerKey: row.providerKey,
    discoverySourceId: row.discoverySourceId,
    identityVersion: row.identityVersion,
    provisionalKey: row.provisionalKey,
    canonicalKey: row.canonicalKey,
    status: row.status,
    observedInBaseline: row.observedInBaseline,
    firstObservedAt: row.firstObservedAt,
    lastObservedAt: row.lastObservedAt,
    observationCount: row.observationCount,
    reviewReason: row.terminalReason,
    terminalAt: row.terminalAt,
    dateProvenance: row.dateProvenance,
    trustedPublishedAt: row.trustedPublishedAt,
    lastFailureReason: row.lastFailureReason,
    ingestAttemptCount: row.ingestAttemptCount,
    hasArticle: row.articleId !== null,
  };
}

function whereFromFilter(filter: ReviewCandidateFilter): Prisma.CrawlCandidateWhereInput {
  const where: Prisma.CrawlCandidateWhereInput = {
    status: filter.status ?? CrawlCandidateStatus.NEEDS_REVIEW,
  };
  if (filter.providerKey) where.providerKey = filter.providerKey;
  if (filter.discoverySourceId) where.discoverySourceId = filter.discoverySourceId;
  return where;
}

/**
 * Lists review candidates (default NEEDS_REVIEW) with optional provider/source
 * filters and offset/limit pagination, ordered oldest-first (FIFO review). Reads
 * only sanitized columns and returns the total match count for the UI.
 */
export async function listReviewCandidates(
  filter: ReviewCandidateFilter = {},
): Promise<ReviewCandidatePage> {
  const where = whereFromFilter(filter);
  const offset = Math.max(0, filter.offset ?? 0);
  const limit = Math.min(Math.max(1, filter.limit ?? 50), 200);

  const [total, rows] = await Promise.all([
    prisma.crawlCandidate.count({ where }),
    prisma.crawlCandidate.findMany({
      where,
      select: CANDIDATE_DTO_SELECT,
      orderBy: [{ firstObservedAt: "asc" }, { id: "asc" }],
      skip: offset,
      take: limit,
    }),
  ]);

  return { candidates: rows.map(toDto), total, offset, limit };
}

/**
 * Returns the sanitized detail DTO (candidate + conflict history) for ONE
 * candidate, or `null` when it does not exist. Not status-restricted so an
 * operator can inspect an already-decided candidate.
 */
export async function getReviewCandidate(id: string): Promise<ReviewCandidateDetailDto | null> {
  const row = await prisma.crawlCandidate.findUnique({
    where: { id },
    select: {
      ...CANDIDATE_DTO_SELECT,
      conflicts: {
        select: {
          id: true,
          status: true,
          reason: true,
          detectedAt: true,
          resolvedAt: true,
        },
        orderBy: { detectedAt: "desc" },
      },
    },
  });
  if (!row) return null;

  const { conflicts, ...candidate } = row;
  return {
    ...toDto(candidate),
    conflicts: conflicts.map((c) => ({
      id: c.id,
      status: c.status,
      reason: c.reason,
      detectedAt: c.detectedAt,
      resolvedAt: c.resolvedAt,
    })),
  };
}
