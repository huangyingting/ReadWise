/**
 * ATOMIC save-commit that turns one fully-validated new candidate into EXACTLY
 * one DRAFT public-library Article plus its required durable follow-up work
 * (issue #1095, Phase 2.5) — the pivotal Phase-2 step every prior issue deferred.
 *
 * The pure identity/fingerprint DECISION and the URL-variant / cross-provider
 * convergence live upstream in `final-identity.ts` / `final-identity-commit.ts`
 * (#1092). Fetch + extraction + all final checks (canonical, fingerprint, date,
 * source ownership, quality, access) happen IMPURELY OUTSIDE any transaction in
 * the ingest runner (`ingest-runner.ts`). This module owns ONLY the final,
 * all-or-nothing commit: it is called AFTER the resolver has produced a genuinely
 * new public identity (a `kept`/`transferred` winning candidate with NO existing
 * Article) and performs, in ONE interactive `$transaction`:
 *
 *   1. REVALIDATION immediately before writing — re-read the candidate + its
 *      discovery source under the transaction and guard the governing invariant
 *      (no existing Article, not baseline-observed, saveable status), provider
 *      OWNERSHIP, and the source ACTIVATION GENERATION (lifecycle mode ACTIVE,
 *      definition version, and `activatedAt` unchanged since extraction). A
 *      failed guard rolls the whole transaction back and creates NOTHING — this
 *      is exactly the stale-generation stop (active → shadow between extraction
 *      and commit ⇒ the stale worker writes no Article).
 *   2. CREATE the ownerless public-library Article as `DRAFT` (`ownerId = null`,
 *      `sourceType = SCRAPED`) with its public canonical identity, source +
 *      canonical URL, provenance, and extracted article fields.
 *   3. In the SAME transaction: mark the candidate terminal (`INGESTED`) with the
 *      Article id attached, record the versioned prose fingerprint, and enqueue
 *      the DEDUPLICATED required `ARTICLE_PROCESS` enrichment job.
 *
 * Concurrency model (mirrors `final-identity-commit.ts` / `page-commit.ts`):
 *   - Reads-before-tx, a single interactive `$transaction`, guarded `updateMany`
 *     re-validation inside the tx (`count === 0` ⇒ roll back).
 *   - Idempotent writes use `upsert`; a `P2002` is NEVER caught INSIDE the
 *     transaction (it poisons a PostgreSQL tx). The candidate `articleId == null`
 *     guarded update — in the SAME tx as the Article insert — is the effective
 *     serialization point: a losing concurrent worker's guard matches zero rows,
 *     rolling back its Article insert too, so there is never a duplicate Article.
 *   - Convergence-after-conflict: on the guarded-update race OR the Article
 *     `@@unique([sourceUrl, ownerId])` conflict, the standalone wrapper re-reads
 *     the winner, attaches this candidate to the existing Article, ensures its
 *     required `ARTICLE_PROCESS` job, and converges — never a duplicate Article,
 *     never a saved candidate without its required job (req6).
 *
 * GOVERNING INVARIANT / AC4: this module ONLY ever CREATES a new Article or
 * CONVERGES onto an existing winner; it NEVER updates an existing Article's
 * content, even when the freshly-fetched body differs. A candidate with
 * `articleId != null` or `observedInBaseline == true` is untouchable.
 *
 * PRIVACY: the Article row legitimately stores product data (`content`,
 * `sourceUrl`, `canonicalUrl`). LOGS and candidate reason/terminal fields stay
 * METADATA ONLY — machine codes, ids, counts, timestamps; never article prose,
 * a raw query string, secret, cookie, or credential. URLs in logs pass through
 * {@link redactUrlForLog}.
 */
import {
  ArticleSourceType,
  ArticleStatus,
  CrawlCandidateStatus,
  DiscoverySourceLifecycleMode,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/observability/logger";
import { enqueueArticleProcess, enqueueArticleProcessInTx } from "@/lib/jobs/enqueue";

import { RECOVERABLE_CANDIDATE_STATUSES } from "./ingest-recovery";

const log = createLogger("article-save-commit");

/** Bounded retries for convergence-after-conflict on the Article/candidate race. */
const MAX_CONVERGENCE_RETRIES = 5;

/**
 * Candidate statuses from which a resolved winner may still be saved: an
 * in-progress, no-Article ingest. Reuses the #1093 recoverable set (DISCOVERED /
 * QUEUED / INGESTING / FAILED) so every terminal / parked / known state is
 * excluded and a resolved-but-already-terminal winner is a safe no-op.
 */
const SAVEABLE_CANDIDATE_STATUSES: readonly CrawlCandidateStatus[] = RECOVERABLE_CANDIDATE_STATUSES;

/** Terminal candidate statuses at which the save is an idempotent no-op. */
const SAVED_TERMINAL_STATUSES: readonly CrawlCandidateStatus[] = [
  CrawlCandidateStatus.INGESTED,
  CrawlCandidateStatus.DUPLICATE_ALIAS,
  CrawlCandidateStatus.NEEDS_REVIEW,
  CrawlCandidateStatus.REJECTED,
  CrawlCandidateStatus.SKIPPED,
  CrawlCandidateStatus.QUARANTINED,
  CrawlCandidateStatus.CONFLICT,
  CrawlCandidateStatus.SKIPPED_REVIEW,
];

/** Candidate columns the save reads (all secret-free). */
const SAVE_SELECT = {
  id: true,
  providerKey: true,
  discoverySourceId: true,
  canonicalKey: true,
  status: true,
  observedInBaseline: true,
  articleId: true,
} satisfies Prisma.CrawlCandidateSelect;

type SaveCandidateRow = Prisma.CrawlCandidateGetPayload<{ select: typeof SAVE_SELECT }>;

/**
 * A snapshot of the winning candidate's discovery source captured BEFORE the
 * fetch/extract, used to detect an activation-generation change at commit. When
 * omitted (a candidate with no linked source) the generation guard is skipped.
 */
export type SourceGenerationSnapshot = {
  /** Expected `DiscoverySource.definitionVersion`. */
  definitionVersion: number;
  /** Expected `DiscoverySource.activatedAt` at extraction time (the generation marker). */
  activatedAt: Date | null;
  /**
   * Expected `DiscoverySource.activationGeneration` at extraction time (#1097).
   * A rollback increments this, so a pre-rollback snapshot is strictly lower
   * than the source's current generation even after a later re-activation
   * (which leaves `activatedAt` unchanged) → the save fails closed.
   */
  activationGeneration: number;
};

/** Extracted, secret-free article fields the save writes onto the new Article. */
export type ArticleDraft = {
  /** Required article title from extraction. */
  title: string;
  /** Required extracted article body (product data — legitimately persisted). */
  content: string;
  author?: string | null;
  excerpt?: string | null;
  heroImage?: string | null;
  /** Human-readable source/publication name (e.g. provider display name). */
  source?: string | null;
  category?: string | null;
  /** The fetched final URL (product data — legitimately persisted on the Article). */
  sourceUrl: string;
  /** Declared `<link rel="canonical">` when present. */
  canonicalUrl?: string | null;
  wordCount?: number | null;
  readingMinutes?: number | null;
  /** Trusted publication date, when known (the Article stays DRAFT / unpublished). */
  publishedAt?: Date | null;
};

/** Inputs the ingest runner PROVIDES after fetch + extraction + resolution. */
export type SaveIncrementalArticleInput = {
  /** The winning candidate id (from a `kept`/`transferred` resolution). */
  candidateId: string;
  /** The candidate's owning provider key — revalidated under the transaction. */
  expectedProviderKey: string;
  /** Source activation-generation snapshot captured before the fetch. */
  sourceGeneration?: SourceGenerationSnapshot | null;
  /** Extracted article fields. */
  draft: ArticleDraft;
  /** Versioned prose fingerprint recorded on the candidate (never the prose). */
  fingerprint?: { version: number; hash: string } | null;
  /** Override "now" (testing / determinism). */
  now?: Date;
  /**
   * TEST-ONLY hook invoked INSIDE the transaction right before EACH commit
   * write, so a fault injected at any write proves all-or-nothing rollback.
   * Never set in production.
   */
  debugHooks?: {
    beforeArticleCreate?: (tx: Prisma.TransactionClient) => void | Promise<void>;
    beforeCandidateLink?: (tx: Prisma.TransactionClient) => void | Promise<void>;
    beforeJobEnqueue?: (tx: Prisma.TransactionClient) => void | Promise<void>;
  };
};

/** Machine-readable, secret-free reason a save was refused at revalidation. */
export type SaveRevalidationReason =
  /** Source lifecycle/generation changed since extraction (active→shadow, definition
   *  bump, activation-marker change, or the source vanished): the stale worker
   *  writes nothing. */
  | "stale-generation"
  /** The candidate's provider ownership changed since extraction. */
  | "provider-mismatch";

/** Outcome of {@link saveIncrementalArticle}. Exactly one action. */
export type SaveIncrementalArticleResult =
  /** Created a brand-new DRAFT Article + linked the candidate + enqueued its job. */
  | { action: "saved"; candidateId: string; articleId: string }
  /** Lost the Article/candidate race — converged onto the existing winner Article. */
  | { action: "converged"; candidateId: string; articleId: string }
  /** A KNOWN identity (already has an Article / baseline) — left untouched (AC4). */
  | { action: "known-article-untouched"; candidateId: string }
  /** Already terminal (duplicate/review/ingested) — idempotent no-op. */
  | { action: "noop-terminal"; candidateId: string; status: CrawlCandidateStatus }
  /** A revalidation guard failed — created NO Article and NO job. */
  | { action: "revalidation-failed"; candidateId: string; reason: SaveRevalidationReason };

/** Raised when the target candidate does not exist. */
export class SaveCandidateNotFoundError extends Error {
  constructor(candidateId: string) {
    super(`CrawlCandidate not found: ${candidateId}`);
    this.name = "SaveCandidateNotFoundError";
  }
}

/** Internal signal: a revalidation guard failed → roll back, do NOT retry. */
class SaveRevalidationError extends Error {
  readonly reason: SaveRevalidationReason;
  constructor(reason: SaveRevalidationReason) {
    super(`incremental save revalidation failed: ${reason}`);
    this.name = "SaveRevalidationError";
    this.reason = reason;
  }
}

/** Internal signal: the guarded candidate link lost a race → roll back + converge. */
class SaveRaceError extends Error {
  constructor() {
    super("incremental save lost the candidate-link concurrency guard");
    this.name = "SaveRaceError";
  }
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

/** True when a thrown error is a unique conflict on the Article identity slot. */
function isArticleUniqueConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  const asText = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return asText.includes("sourceUrl");
}

function buildArticleCreateData(
  input: SaveIncrementalArticleInput,
  now: Date,
): Prisma.ArticleUncheckedCreateInput {
  const { draft } = input;
  return {
    title: draft.title,
    content: draft.content,
    author: draft.author ?? null,
    excerpt: draft.excerpt ?? null,
    heroImage: draft.heroImage ?? null,
    source: draft.source ?? null,
    category: draft.category ?? null,
    sourceUrl: draft.sourceUrl,
    canonicalUrl: draft.canonicalUrl ?? null,
    wordCount: draft.wordCount ?? null,
    readingMinutes: draft.readingMinutes ?? null,
    // An ownerless public-library Article created as a DRAFT: NOT published, its
    // AI/narration enrichment runs asynchronously in the ARTICLE_PROCESS job.
    ownerId: null,
    status: ArticleStatus.DRAFT,
    sourceType: ArticleSourceType.SCRAPED,
    publishedAt: draft.publishedAt ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Guarded terminal transition attaching a saved Article to its winning candidate. */
function candidateLinkData(
  input: SaveIncrementalArticleInput,
  articleId: string,
  now: Date,
): Prisma.CrawlCandidateUncheckedUpdateManyInput {
  return {
    status: CrawlCandidateStatus.INGESTED,
    articleId,
    ingestedAt: now,
    terminalReason: "final-identity:article-saved",
    terminalAt: now,
    nextAttemptAt: null,
    ...(input.fingerprint
      ? { bodyFingerprint: input.fingerprint.hash, bodyFingerprintVersion: input.fingerprint.version }
      : {}),
    ...(input.draft.publishedAt ? { trustedPublishedAt: input.draft.publishedAt } : {}),
    updatedAt: now,
  };
}

/**
 * The single all-or-nothing commit: revalidate → create Article → link candidate
 * → enqueue ARTICLE_PROCESS. Throws {@link SaveRevalidationError} (deterministic
 * stop, no retry), {@link SaveRaceError}, or a P2002 (converge on retry) to roll
 * the whole transaction back so a fault at ANY write leaves nothing behind.
 */
async function runSaveTx(input: SaveIncrementalArticleInput, now: Date): Promise<SaveIncrementalArticleResult> {
  const { candidateId } = input;
  return prisma.$transaction(async (tx) => {
    const c = await tx.crawlCandidate.findUnique({ where: { id: candidateId }, select: SAVE_SELECT });
    if (!c) throw new SaveCandidateNotFoundError(candidateId);

    // AC4 re-check under the tx: a KNOWN identity is never touched.
    if (c.articleId != null || c.observedInBaseline) {
      return { action: "known-article-untouched", candidateId: c.id };
    }
    if (SAVED_TERMINAL_STATUSES.includes(c.status)) {
      return { action: "noop-terminal", candidateId: c.id, status: c.status };
    }

    // Provider-ownership + source activation-generation revalidation.
    if (c.providerKey !== input.expectedProviderKey) {
      throw new SaveRevalidationError("provider-mismatch");
    }
    await revalidateSourceGeneration(tx, c, input.sourceGeneration ?? null);

    // Create the ownerless DRAFT Article. A concurrent create of the same
    // identity throws P2002 here → rollback → the wrapper converges on retry.
    await input.debugHooks?.beforeArticleCreate?.(tx);
    const article = await tx.article.create({ data: buildArticleCreateData(input, now) });

    // Guarded terminal link: only a still-unsaved, non-baseline, saveable
    // candidate may attach the Article. A zero-row update means a concurrent
    // worker already saved it → roll the Article insert back too (no duplicate).
    await input.debugHooks?.beforeCandidateLink?.(tx);
    const linked = await tx.crawlCandidate.updateMany({
      where: {
        id: candidateId,
        articleId: null,
        observedInBaseline: false,
        status: { in: [...SAVEABLE_CANDIDATE_STATUSES] },
      },
      data: candidateLinkData(input, article.id, now),
    });
    if (linked.count === 0) throw new SaveRaceError();

    // Required downstream enrichment work, IN THE SAME transaction (all-or-nothing).
    await input.debugHooks?.beforeJobEnqueue?.(tx);
    await enqueueArticleProcessInTx(tx, article.id);

    return { action: "saved", candidateId, articleId: article.id };
  });
}

/**
 * Guards the source ACTIVATION GENERATION inside the transaction. A missing
 * source, a non-ACTIVE lifecycle mode (the active→shadow stale-generation stop),
 * a bumped definition version, a changed `activatedAt` marker, OR a bumped
 * `activationGeneration` (an active→shadow rollback happened after the snapshot,
 * even if the source was later re-activated) all mean this worker's extraction
 * belongs to a superseded generation → throw so the whole transaction rolls back
 * and NO Article is written.
 */
async function revalidateSourceGeneration(
  tx: Prisma.TransactionClient,
  candidate: SaveCandidateRow,
  snapshot: SourceGenerationSnapshot | null,
): Promise<void> {
  if (!snapshot || candidate.discoverySourceId == null) return;
  const src = await tx.discoverySource.findUnique({
    where: { id: candidate.discoverySourceId },
    select: { lifecycleMode: true, definitionVersion: true, activatedAt: true, activationGeneration: true },
  });
  if (
    !src ||
    src.lifecycleMode !== DiscoverySourceLifecycleMode.ACTIVE ||
    src.definitionVersion !== snapshot.definitionVersion ||
    !sameInstant(src.activatedAt, snapshot.activatedAt) ||
    src.activationGeneration !== snapshot.activationGeneration
  ) {
    throw new SaveRevalidationError("stale-generation");
  }
}

/**
 * Convergence on a lost Article/candidate race: re-read the candidate; when it
 * now carries an Article (a concurrent worker won), attach nothing new — just
 * ensure the required ARTICLE_PROCESS job and converge. When the Article slot was
 * won by a different candidate for the same identity, attach THIS candidate to
 * the existing winner Article (guarded) and ensure its job. Returns `null` when
 * no winner is visible yet so the caller retries the transaction.
 */
async function convergeOnExistingArticle(
  input: SaveIncrementalArticleInput,
  now: Date,
): Promise<SaveIncrementalArticleResult | null> {
  const { candidateId } = input;
  const c = await prisma.crawlCandidate.findUnique({ where: { id: candidateId }, select: SAVE_SELECT });
  if (!c) return { action: "known-article-untouched", candidateId };
  if (c.observedInBaseline) return { action: "known-article-untouched", candidateId };

  // This candidate was already saved by a concurrent winner: ensure its job.
  if (c.articleId != null) {
    await enqueueArticleProcess(c.articleId);
    return { action: "converged", candidateId, articleId: c.articleId };
  }
  if (SAVED_TERMINAL_STATUSES.includes(c.status)) {
    return { action: "noop-terminal", candidateId, status: c.status };
  }

  // The Article identity slot was won by a different candidate: attach this one
  // to the existing ownerless Article rather than create a duplicate.
  const existing = await prisma.article.findFirst({
    where: { sourceUrl: input.draft.sourceUrl, ownerId: null },
    select: { id: true },
  });
  if (!existing) return null;

  const linked = await prisma.crawlCandidate.updateMany({
    where: {
      id: candidateId,
      articleId: null,
      observedInBaseline: false,
      status: { in: [...SAVEABLE_CANDIDATE_STATUSES] },
    },
    data: candidateLinkData(input, existing.id, now),
  });
  // The winner already ensured the Article's ARTICLE_PROCESS job; ensuring it
  // again is idempotent (dedupe key), so the guarantee holds even if the link
  // above raced to zero rows.
  await enqueueArticleProcess(existing.id);
  if (linked.count === 0) {
    const reread = await prisma.crawlCandidate.findUnique({ where: { id: candidateId }, select: SAVE_SELECT });
    if (reread?.articleId != null) return { action: "converged", candidateId, articleId: reread.articleId };
  }
  return { action: "converged", candidateId, articleId: existing.id };
}

/**
 * Saves a fully-validated new candidate as EXACTLY one DRAFT Article plus its
 * required `ARTICLE_PROCESS` work, atomically. Retries the commit on a
 * candidate/Article unique race and converges on the winner; returns a
 * deterministic `revalidation-failed` (no retry) when the source generation or
 * provider ownership changed since extraction — the stale worker writes nothing.
 */
export async function saveIncrementalArticle(
  input: SaveIncrementalArticleInput,
): Promise<SaveIncrementalArticleResult> {
  const now = input.now ?? new Date();
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_CONVERGENCE_RETRIES; attempt += 1) {
    try {
      const result = await runSaveTx(input, now);
      if (result.action === "saved") {
        log.info("incremental article saved", {
          candidateId: input.candidateId,
          articleId: result.articleId,
        });
      }
      return result;
    } catch (error) {
      if (error instanceof SaveRevalidationError) {
        log.info("incremental save refused at revalidation", {
          candidateId: input.candidateId,
          reason: error.reason,
        });
        return { action: "revalidation-failed", candidateId: input.candidateId, reason: error.reason };
      }
      if ((error instanceof SaveRaceError || isArticleUniqueConflict(error)) && attempt < MAX_CONVERGENCE_RETRIES) {
        lastError = error;
        const converged = await convergeOnExistingArticle(input, now);
        if (converged) return converged;
        continue; // no winner visible yet — re-attempt the tx
      }
      throw error;
    }
  }
  throw lastError ?? new Error("incremental article save did not converge");
}
