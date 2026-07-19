/**
 * THIN guarded persistence that APPLIES a trusted-final-identity resolution to
 * the discovery ledger (issue #1092, Phase 2.2).
 *
 * The pure DECISION logic lives in `final-identity.ts` / `prose-fingerprint.ts`.
 * This module owns only the atomic, concurrency-safe DB effects that fold URL
 * variants and identical provider content onto ONE winning candidate BEFORE any
 * Article is created (the future #1095 pipeline calls these after it fetches +
 * extracts a body). It NEVER fetches, NEVER creates an Article, and NEVER
 * touches a KNOWN identity (governing invariant / AC4).
 *
 * Concurrency model (mirrors `page-commit.ts`):
 *   - Reads-before-tx, a single interactive `$transaction`, and guarded
 *     `updateMany` re-validation inside the tx.
 *   - Idempotent writes inside the tx use `upsert` — NEVER a caught-P2002 (which
 *     poisons a PostgreSQL transaction).
 *   - Convergence-after-conflict: the canonical `@@unique([providerKey,
 *     canonicalKey])` slot is the collision point. A concurrent claim makes the
 *     tx throw P2002; the STANDALONE wrapper here catches it, re-queries the
 *     winner, and folds into it — so two racing workers converge on ONE
 *     candidate instead of both failing (AC1).
 *
 * Privacy: every persisted value is a SANITIZED versioned key or a prose HASH;
 * no URL, token, cookie, credential, or article text is written or logged.
 */
import {
  CrawlCandidateStatus,
  JobStatus,
  JobType,
  Prisma,
  UrlAliasKind,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { ACTIVE_STATUSES } from "@/lib/jobs";
import { candidateIngestDedupeKey } from "@/lib/jobs/candidate-ingest";

import {
  resolveFinalIdentity,
  selectMergeWinner,
  decideFingerprintMatches,
  type FinalIdentityInput,
  type FinalIdentityReviewReason,
  type MergeParticipant,
} from "./final-identity";
import { computeProseFingerprint } from "./prose-fingerprint";

/** Bounded retries for convergence-after-conflict on the canonical unique slot. */
const MAX_CONVERGENCE_RETRIES = 5;

/** Candidate statuses at which final-identity resolution is a no-op. */
const RESOLVED_TERMINAL_STATUSES: CrawlCandidateStatus[] = [
  CrawlCandidateStatus.INGESTED,
  CrawlCandidateStatus.DUPLICATE_ALIAS,
  CrawlCandidateStatus.NEEDS_REVIEW,
  CrawlCandidateStatus.REJECTED,
  CrawlCandidateStatus.SKIPPED,
  CrawlCandidateStatus.SKIPPED_REVIEW,
];

/** Selection of candidate columns this module reads (all secret-free). */
const CANDIDATE_SELECT = {
  id: true,
  providerKey: true,
  identityVersion: true,
  provisionalKey: true,
  canonicalKey: true,
  status: true,
  observedInBaseline: true,
  articleId: true,
  firstObservedAt: true,
  createdAt: true,
} satisfies Prisma.CrawlCandidateSelect;

type CandidateRow = Prisma.CrawlCandidateGetPayload<{ select: typeof CANDIDATE_SELECT }>;

/** Inputs the (future) ingest pipeline PROVIDES after fetch + extraction. */
export type ApplyFinalIdentityInput = FinalIdentityInput & {
  /** The candidate whose trusted final identity is being resolved. */
  candidateId: string;
  /** Extracted prose for the versioned fingerprint. Omit to skip fingerprinting. */
  prose?: string | null;
  /** Override "now" (testing / determinism). */
  now?: Date;
};

/** Outcome of {@link applyFinalIdentity}. */
export type ApplyFinalIdentityResult =
  /** A KNOWN identity (Article or baseline) — left untouched (AC4). */
  | { action: "known-article-untouched"; candidateId: string }
  /** Already terminal (duplicate/review/ingested) — idempotent no-op. */
  | { action: "noop-terminal"; candidateId: string; status: CrawlCandidateStatus }
  /** Parked before Article creation with an auditable conflict (AC2). */
  | { action: "routed-to-review"; candidateId: string; reason: string; conflictId: string }
  /** Kept under the owning provider; may have folded losers. */
  | { action: "kept"; winnerId: string; mergedLoserIds: string[]; jobsCancelled: number }
  /** Ownership transferred to another registered provider; may have folded losers. */
  | {
      action: "transferred";
      winnerId: string;
      targetProviderKey: string;
      mergedLoserIds: string[];
      jobsCancelled: number;
    };

/** Raised when the target candidate does not exist. */
export class CandidateNotFoundError extends Error {
  constructor(candidateId: string) {
    super(`CrawlCandidate not found: ${candidateId}`);
    this.name = "CandidateNotFoundError";
  }
}

/** Internal signal: a guarded update lost a concurrency race → roll back + retry. */
class MergeRaceError extends Error {
  constructor() {
    super("final-identity merge lost a concurrency guard");
    this.name = "MergeRaceError";
  }
}

function isKnownIdentity(c: Pick<CandidateRow, "articleId" | "observedInBaseline">): boolean {
  return c.articleId != null || c.observedInBaseline;
}

function toParticipant(c: CandidateRow): MergeParticipant {
  return {
    id: c.id,
    firstObservedAt: c.firstObservedAt,
    createdAt: c.createdAt,
    hasArticle: c.articleId != null,
    observedInBaseline: c.observedInBaseline,
  };
}

/** True when a thrown error is a unique conflict on the canonical-identity slot. */
function isCanonicalUniqueConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  const asText = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return asText.includes("canonicalKey");
}

/**
 * Cancels a candidate's pending downstream ARTICLE_INGEST job(s) (any processing
 * version) INSIDE the caller's transaction, so a merged loser or a parked
 * candidate never does expensive downstream work (AC3). Mirrors `cancelJob`'s
 * guarded transition but stays tx-local for atomicity. Returns the count moved.
 */
async function cancelCandidateIngestJobsInTx(
  tx: Prisma.TransactionClient,
  candidateId: string,
  now: Date,
  reason: string,
): Promise<number> {
  // `candidateIngestDedupeKey` ends with `:v<version>`; strip the version to
  // match every processing version for this candidate.
  const versionedKey = candidateIngestDedupeKey(candidateId, 0);
  const prefix = versionedKey.slice(0, versionedKey.length - 1);
  const res = await tx.job.updateMany({
    where: {
      type: JobType.ARTICLE_INGEST,
      status: { in: ACTIVE_STATUSES },
      dedupeKey: { startsWith: prefix },
    },
    data: {
      status: JobStatus.DEAD_LETTER,
      lastError: reason,
      deadLetteredAt: now,
      lockedBy: null,
      lockedAt: null,
      updatedAt: now,
    },
  });
  return res.count;
}

/** Idempotently records an auditable OPEN conflict (upsert; never catch-P2002-in-tx). */
async function upsertConflictInTx(
  tx: Prisma.TransactionClient,
  params: {
    providerKey: string;
    identityVersion: number;
    canonicalKey: string;
    challengerKey: string;
    incumbentCandidateId: string | null;
    reason: string;
    now: Date;
  },
): Promise<string> {
  const conflict = await tx.canonicalConflict.upsert({
    where: {
      providerKey_identityVersion_canonicalKey: {
        providerKey: params.providerKey,
        identityVersion: params.identityVersion,
        canonicalKey: params.canonicalKey,
      },
    },
    create: {
      providerKey: params.providerKey,
      identityVersion: params.identityVersion,
      canonicalKey: params.canonicalKey,
      challengerKey: params.challengerKey,
      incumbentCandidateId: params.incumbentCandidateId,
      status: "OPEN",
      reason: params.reason,
      detectedAt: params.now,
    },
    // Refresh the reason but never silently re-open a RESOLVED/DISMISSED row.
    update: { reason: params.reason, updatedAt: params.now },
    select: { id: true },
  });
  return conflict.id;
}

/**
 * Folds a loser candidate into the winner INSIDE the tx: re-points its aliases
 * (relabelled DUPLICATE) and observations to the winner, clears its canonical
 * slot, marks it DUPLICATE_ALIAS, and cancels its pending ingest job. Aliases +
 * observations are RETAINED so every place a variant was discovered is preserved.
 */
async function foldLoserInTx(
  tx: Prisma.TransactionClient,
  loserId: string,
  winnerId: string,
  now: Date,
): Promise<number> {
  await tx.urlAlias.updateMany({
    where: { candidateId: loserId },
    data: { candidateId: winnerId, kind: UrlAliasKind.DUPLICATE, lastSeenAt: now },
  });
  await tx.discoveryObservation.updateMany({
    where: { candidateId: loserId },
    data: { candidateId: winnerId },
  });
  await tx.crawlCandidate.update({
    where: { id: loserId },
    data: {
      status: CrawlCandidateStatus.DUPLICATE_ALIAS,
      canonicalKey: null,
      terminalReason: `final-identity: duplicate of ${winnerId}`,
      terminalAt: now,
      updatedAt: now,
    },
  });
  return cancelCandidateIngestJobsInTx(tx, loserId, now, "final-identity: duplicate alias merged");
}

type MergeTxOutcome =
  | { action: "known-article-untouched"; candidateId: string }
  | { action: "noop-terminal"; candidateId: string; status: CrawlCandidateStatus }
  | { action: "routed-to-review"; candidateId: string; reason: string; conflictId: string }
  | { action: "kept"; winnerId: string; mergedLoserIds: string[]; jobsCancelled: number }
  | {
      action: "transferred";
      winnerId: string;
      targetProviderKey: string;
      mergedLoserIds: string[];
      jobsCancelled: number;
    };

/**
 * Single guarded transaction that assigns the trusted canonical identity to the
 * candidate and folds any final-identity collision onto the winning candidate.
 * Throws {@link MergeRaceError} / P2002 to roll back so the standalone wrapper
 * can converge on a retry.
 */
async function runCanonicalMergeTx(params: {
  candidateId: string;
  targetProviderKey: string;
  canonicalKey: string;
  transfer: boolean;
  now: Date;
}): Promise<MergeTxOutcome> {
  const { candidateId, targetProviderKey, canonicalKey, transfer, now } = params;

  return prisma.$transaction(async (tx) => {
    const c = await tx.crawlCandidate.findUnique({
      where: { id: candidateId },
      select: CANDIDATE_SELECT,
    });
    if (!c) throw new CandidateNotFoundError(candidateId);

    // AC4 re-check inside the tx: a KNOWN identity is never touched.
    if (isKnownIdentity(c)) {
      return { action: "known-article-untouched", candidateId: c.id };
    }
    if (RESOLVED_TERMINAL_STATUSES.includes(c.status)) {
      return { action: "noop-terminal", candidateId: c.id, status: c.status };
    }

    // The existing holder of the target (provider, canonicalKey) unique slot.
    const holder = await tx.crawlCandidate.findFirst({
      where: { providerKey: targetProviderKey, canonicalKey },
      select: CANDIDATE_SELECT,
    });

    // Idempotent no-op: this candidate already holds the exact final identity.
    if (holder && holder.id === c.id && (!transfer || c.providerKey === targetProviderKey)) {
      return transfer
        ? { action: "transferred", winnerId: c.id, targetProviderKey, mergedLoserIds: [], jobsCancelled: 0 }
        : { action: "kept", winnerId: c.id, mergedLoserIds: [], jobsCancelled: 0 };
    }

    const participants: MergeParticipant[] = [toParticipant(c)];
    if (holder && holder.id !== c.id) participants.push(toParticipant(holder));

    const decision = selectMergeWinner(participants);
    if (decision.kind === "review") {
      // Two KNOWN Articles collide — unmergeable without touching one (AC4).
      const conflictId = await upsertConflictInTx(tx, {
        providerKey: targetProviderKey,
        identityVersion: c.identityVersion,
        canonicalKey,
        challengerKey: c.provisionalKey,
        incumbentCandidateId: holder?.id ?? null,
        reason: `final-identity:${decision.reason}`,
        now,
      });
      await tx.crawlCandidate.updateMany({
        where: { id: c.id, articleId: null },
        data: {
          status: CrawlCandidateStatus.NEEDS_REVIEW,
          terminalReason: `final-identity:${decision.reason}`,
          updatedAt: now,
        },
      });
      await cancelCandidateIngestJobsInTx(tx, c.id, now, "final-identity: routed to review");
      return { action: "routed-to-review", candidateId: c.id, reason: decision.reason, conflictId };
    }

    const { winnerId, loserIds } = decision;

    // Apply the cross-provider transfer on THIS candidate before claiming the
    // canonical slot, so the slot is owned by the correct provider.
    if (transfer && c.providerKey !== targetProviderKey) {
      const moved = await tx.crawlCandidate.updateMany({
        where: { id: c.id, providerKey: c.providerKey },
        data: { providerKey: targetProviderKey, updatedAt: now },
      });
      if (moved.count === 0) throw new MergeRaceError();
    }

    // Free the canonical slot from any loser holding it, THEN assign it to the
    // winner. Clearing first avoids a transient unique violation when the slot
    // moves from a (later) holder to an EARLIER winning candidate.
    for (const loserId of loserIds) {
      await tx.crawlCandidate.updateMany({
        where: { id: loserId, canonicalKey },
        data: { canonicalKey: null, updatedAt: now },
      });
    }

    // Guarded assign to the winner. A concurrent claim of the same slot throws
    // P2002 here → rollback → the standalone wrapper re-queries + folds.
    await tx.crawlCandidate.update({
      where: { id: winnerId },
      data: { canonicalKey, updatedAt: now },
    });

    let jobsCancelled = 0;
    const mergedLoserIds: string[] = [];
    for (const loserId of loserIds) {
      jobsCancelled += await foldLoserInTx(tx, loserId, winnerId, now);
      mergedLoserIds.push(loserId);
    }

    return transfer
      ? { action: "transferred", winnerId, targetProviderKey, mergedLoserIds, jobsCancelled }
      : { action: "kept", winnerId, mergedLoserIds, jobsCancelled };
  });
}

/** Standalone convergence wrapper: retry the merge tx on a canonical-slot conflict. */
async function convergeCanonicalMerge(params: {
  candidateId: string;
  targetProviderKey: string;
  canonicalKey: string;
  transfer: boolean;
  now: Date;
}): Promise<MergeTxOutcome> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_CONVERGENCE_RETRIES; attempt += 1) {
    try {
      return await runCanonicalMergeTx(params);
    } catch (error) {
      if (
        (isCanonicalUniqueConflict(error) || error instanceof MergeRaceError) &&
        attempt < MAX_CONVERGENCE_RETRIES
      ) {
        lastError = error;
        continue; // re-query the (now-existing) winner on the next attempt
      }
      throw error;
    }
  }
  throw lastError ?? new Error("canonical merge did not converge");
}

/** Prose-fingerprint match row (secret-free). */
const FINGERPRINT_MATCH_SELECT = {
  id: true,
  providerKey: true,
  provisionalKey: true,
  canonicalKey: true,
  identityVersion: true,
  status: true,
  observedInBaseline: true,
  articleId: true,
  firstObservedAt: true,
  createdAt: true,
} satisfies Prisma.CrawlCandidateSelect;

type FingerprintRow = Prisma.CrawlCandidateGetPayload<{ select: typeof FINGERPRINT_MATCH_SELECT }>;

/**
 * Applies the versioned prose fingerprint to the winning candidate and resolves
 * fingerprint collisions: EXACT same-provider duplicates fold into the earliest
 * winner; a CROSS-PROVIDER match parks the candidate for review (rights/
 * attribution may differ). Runs in one guarded transaction. A known-Article /
 * terminal winner is left untouched (AC4).
 */
async function applyProseFingerprint(params: {
  winnerId: string;
  version: number;
  hash: string;
  now: Date;
}): Promise<{ mergedLoserIds: string[]; jobsCancelled: number; routedToReview: string | null }> {
  const { winnerId, version, hash, now } = params;

  return prisma.$transaction(async (tx) => {
    const winner = await tx.crawlCandidate.findUnique({
      where: { id: winnerId },
      select: FINGERPRINT_MATCH_SELECT,
    });
    if (!winner) throw new CandidateNotFoundError(winnerId);
    if (winner.articleId != null || RESOLVED_TERMINAL_STATUSES.includes(winner.status)) {
      return { mergedLoserIds: [], jobsCancelled: 0, routedToReview: null };
    }

    const matches = await tx.crawlCandidate.findMany({
      where: {
        bodyFingerprintVersion: version,
        bodyFingerprint: hash,
        id: { not: winnerId },
        status: { notIn: [CrawlCandidateStatus.DUPLICATE_ALIAS, CrawlCandidateStatus.REJECTED] },
      },
      select: FINGERPRINT_MATCH_SELECT,
    });

    const { sameProviderIds, crossProviderIds } = decideFingerprintMatches(
      winner.providerKey,
      matches.map((m) => ({ candidateId: m.id, providerKey: m.providerKey })),
    );

    // Cross-provider identical content → stop BEFORE Article creation (AC2).
    if (crossProviderIds.length > 0) {
      const other = matches.find((m) => m.id === crossProviderIds[0])!;
      const conflictKey = winner.canonicalKey ?? winner.provisionalKey;
      const conflictId = await upsertConflictInTx(tx, {
        providerKey: winner.providerKey,
        identityVersion: winner.identityVersion,
        canonicalKey: conflictKey,
        challengerKey: other.provisionalKey,
        incumbentCandidateId: other.id,
        reason: `final-identity:cross-provider-prose-fingerprint:v${version}`,
        now,
      });
      // Record the fingerprint AND park for review; do NOT merge across providers.
      await tx.crawlCandidate.updateMany({
        where: { id: winnerId, articleId: null },
        data: {
          bodyFingerprint: hash,
          bodyFingerprintVersion: version,
          status: CrawlCandidateStatus.NEEDS_REVIEW,
          terminalReason: `final-identity:cross-provider-prose-fingerprint`,
          updatedAt: now,
        },
      });
      await cancelCandidateIngestJobsInTx(tx, winnerId, now, "final-identity: cross-provider content review");
      return { mergedLoserIds: [], jobsCancelled: 0, routedToReview: conflictId };
    }

    // Record the fingerprint on the winner (guarded to not touch a known Article).
    await tx.crawlCandidate.updateMany({
      where: { id: winnerId, articleId: null },
      data: { bodyFingerprint: hash, bodyFingerprintVersion: version, updatedAt: now },
    });

    if (sameProviderIds.length === 0) {
      return { mergedLoserIds: [], jobsCancelled: 0, routedToReview: null };
    }

    // EXACT same-provider duplicates: fold into the earliest winner.
    const sameProvider = matches.filter((m) => sameProviderIds.includes(m.id));
    const participants: MergeParticipant[] = [winner, ...sameProvider].map(fingerprintParticipant);
    const decision = selectMergeWinner(participants);
    if (decision.kind === "review") {
      // Multiple known Articles share this fingerprint — park for review.
      const other = sameProvider[0];
      const conflictId = await upsertConflictInTx(tx, {
        providerKey: winner.providerKey,
        identityVersion: winner.identityVersion,
        canonicalKey: winner.canonicalKey ?? winner.provisionalKey,
        challengerKey: other.provisionalKey,
        incumbentCandidateId: other.id,
        reason: `final-identity:multiple-known-articles`,
        now,
      });
      await tx.crawlCandidate.updateMany({
        where: { id: winnerId, articleId: null },
        data: {
          status: CrawlCandidateStatus.NEEDS_REVIEW,
          terminalReason: `final-identity:multiple-known-articles`,
          updatedAt: now,
        },
      });
      await cancelCandidateIngestJobsInTx(tx, winnerId, now, "final-identity: routed to review");
      return { mergedLoserIds: [], jobsCancelled: 0, routedToReview: conflictId };
    }

    let jobsCancelled = 0;
    const mergedLoserIds: string[] = [];
    for (const loserId of decision.loserIds) {
      jobsCancelled += await foldLoserInTx(tx, loserId, decision.winnerId, now);
      mergedLoserIds.push(loserId);
    }
    // Ensure the fingerprint is recorded on the FINAL winner (may differ from the
    // canonical-merge winner when an earlier same-provider duplicate wins).
    await tx.crawlCandidate.updateMany({
      where: { id: decision.winnerId, articleId: null },
      data: { bodyFingerprint: hash, bodyFingerprintVersion: version, updatedAt: now },
    });
    return { mergedLoserIds, jobsCancelled, routedToReview: null };
  });
}

function fingerprintParticipant(c: FingerprintRow): MergeParticipant {
  return {
    id: c.id,
    firstObservedAt: c.firstObservedAt,
    createdAt: c.createdAt,
    hasArticle: c.articleId != null,
    observedInBaseline: c.observedInBaseline,
  };
}

/**
 * Applies a candidate's trusted final identity to the ledger. The orchestration
 * a future ingest pipeline (#1095) calls AFTER it fetches + extracts a body:
 *
 *   1. Guard: a KNOWN identity (Article / baseline) or an already-terminal
 *      candidate is left untouched (AC4).
 *   2. Resolve the trusted final identity (pure) — keep, transfer, or review.
 *   3. Unknown cross-domain / rejected transfer → park with an auditable
 *      CanonicalConflict + NEEDS_REVIEW status; cancel its ingest job (AC2).
 *   4. Keep / transfer → assign the canonical identity and fold any collision
 *      onto the earliest winner (guarded tx + convergence-after-conflict, AC1);
 *      re-point aliases/observations, mark losers DUPLICATE_ALIAS, cancel their
 *      ingest jobs (AC3).
 *   5. When prose is provided → apply the versioned fingerprint, merging exact
 *      same-provider duplicates and parking cross-provider matches for review.
 */
export async function applyFinalIdentity(
  input: ApplyFinalIdentityInput,
): Promise<ApplyFinalIdentityResult> {
  const now = input.now ?? new Date();

  // Read-before-tx guard so we skip resolution work for a known/terminal identity.
  const candidate = await prisma.crawlCandidate.findUnique({
    where: { id: input.candidateId },
    select: CANDIDATE_SELECT,
  });
  if (!candidate) throw new CandidateNotFoundError(input.candidateId);
  if (isKnownIdentity(candidate)) {
    return { action: "known-article-untouched", candidateId: candidate.id };
  }
  if (RESOLVED_TERMINAL_STATUSES.includes(candidate.status)) {
    return { action: "noop-terminal", candidateId: candidate.id, status: candidate.status };
  }

  const resolution = resolveFinalIdentity({
    owningProviderKey: input.owningProviderKey,
    finalUrl: input.finalUrl,
    canonicalUrl: input.canonicalUrl,
  });

  if (resolution.decision === "route-to-review") {
    return routeToReview(candidate, resolution.reason, now);
  }

  const targetProviderKey =
    resolution.decision === "transfer-to-provider"
      ? resolution.targetProviderKey
      : candidate.providerKey;
  const canonicalKey = resolution.identity.key;
  const transfer = resolution.decision === "transfer-to-provider";

  const merge = await convergeCanonicalMerge({
    candidateId: candidate.id,
    targetProviderKey,
    canonicalKey,
    transfer,
    now,
  });

  if (merge.action === "known-article-untouched") {
    return { action: "known-article-untouched", candidateId: candidate.id };
  }
  if (merge.action === "noop-terminal") {
    return { action: "noop-terminal", candidateId: candidate.id, status: merge.status };
  }
  if (merge.action === "routed-to-review") {
    return {
      action: "routed-to-review",
      candidateId: merge.candidateId,
      reason: merge.reason,
      conflictId: merge.conflictId,
    };
  }

  let winnerId = merge.winnerId;
  let mergedLoserIds = [...merge.mergedLoserIds];
  let jobsCancelled = merge.jobsCancelled;

  // Optional prose fingerprint (exact same-provider merge / cross-provider review).
  if (input.prose != null) {
    const fingerprint = computeProseFingerprint(input.prose);
    if (fingerprint) {
      const fp = await applyProseFingerprint({
        winnerId,
        version: fingerprint.version,
        hash: fingerprint.hash,
        now,
      });
      if (fp.routedToReview) {
        return {
          action: "routed-to-review",
          candidateId: winnerId,
          reason: "cross-provider-prose-fingerprint",
          conflictId: fp.routedToReview,
        };
      }
      mergedLoserIds = [...mergedLoserIds, ...fp.mergedLoserIds];
      jobsCancelled += fp.jobsCancelled;
      // The fingerprint merge may elect an earlier same-provider winner.
      if (fp.mergedLoserIds.includes(winnerId)) {
        const survivor = await prisma.crawlCandidate.findFirst({
          where: {
            bodyFingerprintVersion: fingerprint.version,
            bodyFingerprint: fingerprint.hash,
            status: { notIn: RESOLVED_TERMINAL_STATUSES },
          },
          select: { id: true },
        });
        if (survivor) winnerId = survivor.id;
      }
    }
  }

  return merge.action === "transferred"
    ? {
        action: "transferred",
        winnerId,
        targetProviderKey: merge.targetProviderKey,
        mergedLoserIds,
        jobsCancelled,
      }
    : { action: "kept", winnerId, mergedLoserIds, jobsCancelled };
}

/** Parks a candidate for review with an auditable conflict (AC2). */
async function routeToReview(
  candidate: CandidateRow,
  reason: FinalIdentityReviewReason,
  now: Date,
): Promise<ApplyFinalIdentityResult> {
  const conflictKey = candidate.canonicalKey ?? candidate.provisionalKey;
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.crawlCandidate.findUnique({
      where: { id: candidate.id },
      select: { id: true, articleId: true, observedInBaseline: true, status: true },
    });
    if (!current) throw new CandidateNotFoundError(candidate.id);
    if (current.articleId != null || current.observedInBaseline) {
      return { action: "known-article-untouched" as const, candidateId: candidate.id };
    }
    const conflictId = await upsertConflictInTx(tx, {
      providerKey: candidate.providerKey,
      identityVersion: candidate.identityVersion,
      canonicalKey: conflictKey,
      challengerKey: candidate.provisionalKey,
      incumbentCandidateId: null,
      reason: `final-identity:${reason}`,
      now,
    });
    await tx.crawlCandidate.updateMany({
      where: { id: candidate.id, articleId: null },
      data: {
        status: CrawlCandidateStatus.NEEDS_REVIEW,
        terminalReason: `final-identity:${reason}`,
        updatedAt: now,
      },
    });
    await cancelCandidateIngestJobsInTx(tx, candidate.id, now, "final-identity: routed to review");
    return { action: "routed-to-review" as const, candidateId: candidate.id, reason, conflictId };
  });
  return result;
}
