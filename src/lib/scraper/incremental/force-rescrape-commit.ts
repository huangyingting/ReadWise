/**
 * Thin, guarded force-rescrape PERSISTENCE (issue #1102, Phase 3.3).
 *
 * Applies the pure {@link force-rescrape-policy} decisions onto the durable
 * `ArticleContentVersion` ledger using the repo's guarded-transition house style
 * (reads BEFORE the tx; a single interactive `$transaction` re-validates; a
 * guarded `updateMany` whose zero-row result rolls the write back — mirroring
 * `article-save-commit.ts`). It writes NO decision logic and NEVER fetches a body
 * or runs AI. It owns exactly three moves:
 *
 *   1. {@link createPendingRescrape} — MATERIALIZE the Article's current content
 *      as an ACTIVE baseline version the first time (so "retain the current
 *      version" is durable), then CLAIM the per-Article PENDING lock. Both are
 *      STANDALONE idempotent writes that MAY catch P2002: the `pendingForArticleId`
 *      unique slot is the serialization point — a second concurrent force-rescrape
 *      hits the conflict and is rejected cleanly (AC4), losing NEITHER version.
 *   2. {@link recordRescrapeFailure} — the controlled-failure path: flip the
 *      PENDING version to REJECTED (validation-gate refusal) or FAILED
 *      (fetch/internal abort), record the machine reason code, and RELEASE the
 *      pending lock — leaving the ACTIVE version (and every reader relationship)
 *      UNTOUCHED. A guarded `updateMany` makes it idempotent.
 *   3. {@link activateRescrape} — the atomic swap: in ONE interactive
 *      `$transaction`, re-validate the pending row, DEMOTE the old ACTIVE version
 *      to SUPERSEDED, PROMOTE the pending version to ACTIVE (filling its content +
 *      fingerprint + provenance and MARKING derived outputs for regeneration), and
 *      UPDATE the Article's readable fields IN PLACE — preserving its id, owner,
 *      visibility, status, and all reading relationships. Guarded `updateMany`
 *      (`count === 0` ⇒ rollback); a P2002 is NEVER caught inside the tx.
 *
 * PRIVACY: the versioned readable payload (content/title/urls) is product data
 * that lives ONLY on the `ArticleContentVersion` row. This module writes NO logs
 * and returns ONLY ids / statuses / machine codes; the operator `reason` +
 * `requestedById` are sanitized provenance columns, `failureReason` is a code.
 */
import { ArticleContentVersionStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { CURRENT_EXTRACTOR_VERSION } from "./ingest-outcome";
import { computeProseFingerprint } from "./prose-fingerprint";
import { FAILED_STATUS_REASONS, type ForceRescrapeFailureReason } from "./force-rescrape-policy";
import type { AnchorMove } from "./annotation-reanchor";

const S = ArticleContentVersionStatus;

/**
 * System reason recorded on a MATERIALIZED baseline version. Not operator text —
 * it marks a version created to snapshot the Article's pre-rescrape content so
 * the current readable version is durable before any replacement is proposed.
 */
export const BASELINE_MATERIALIZE_REASON = "system:materialized-current-active-baseline";

/**
 * The extracted, secret-free readable payload of one Article content version.
 * Product data that is written ONLY to the `ArticleContentVersion` row (and, at
 * activation, mirrored onto the Article) — never logged or put in a Job payload.
 */
export type RescrapeContentPayload = {
  content: string;
  title: string;
  excerpt?: string | null;
  author?: string | null;
  heroImage?: string | null;
  source?: string | null;
  category?: string | null;
  wordCount?: number | null;
  readingMinutes?: number | null;
  /** The fetched final URL (provenance on the version row; the Article keeps its own). */
  sourceUrl?: string | null;
  /** Declared `<link rel="canonical">` of the replacement (provenance on the version row). */
  canonicalUrl?: string | null;
  publishedAt?: Date | null;
};

/** True when a thrown error is a Prisma unique-constraint (P2002) conflict. */
function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** The versioned content columns (never id/status/lock/provenance — those are set explicitly). */
type RescrapeContentColumns = {
  content: string;
  title: string;
  excerpt: string | null;
  author: string | null;
  heroImage: string | null;
  source: string | null;
  category: string | null;
  wordCount: number | null;
  readingMinutes: number | null;
  sourceUrl: string | null;
  canonicalUrl: string | null;
  publishedAt: Date | null;
  fingerprint: string | null;
  fingerprintVersion: number | null;
  extractorVersion: number;
};

/**
 * Maps a content payload to the versioned columns (used both when materializing a
 * baseline and when filling a pending row at activation). Fingerprint is derived
 * from the content; the prose text itself is never stored.
 */
function contentColumns(payload: RescrapeContentPayload): RescrapeContentColumns {
  const fingerprint = computeProseFingerprint(payload.content);
  return {
    content: payload.content,
    title: payload.title,
    excerpt: payload.excerpt ?? null,
    author: payload.author ?? null,
    heroImage: payload.heroImage ?? null,
    source: payload.source ?? null,
    category: payload.category ?? null,
    wordCount: payload.wordCount ?? null,
    readingMinutes: payload.readingMinutes ?? null,
    sourceUrl: payload.sourceUrl ?? null,
    canonicalUrl: payload.canonicalUrl ?? null,
    publishedAt: payload.publishedAt ?? null,
    fingerprint: fingerprint?.key ?? null,
    fingerprintVersion: fingerprint ? fingerprint.version : null,
    extractorVersion: CURRENT_EXTRACTOR_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Create pending (materialize baseline + claim the per-Article lock)
// ---------------------------------------------------------------------------

/** Inputs to {@link createPendingRescrape}. */
export type CreatePendingRescrapeInput = {
  articleId: string;
  /** Sanitized operator justification (required). */
  reason: string;
  /** Sanitized actor id (plain string, metadata only — never an FK). */
  requestedById?: string | null;
  /** The Article's CURRENT readable content, used to materialize the baseline once. */
  baseline: RescrapeContentPayload;
  now?: Date;
};

/** Outcome of {@link createPendingRescrape}. */
export type CreatePendingRescrapeResult =
  /** Claimed the pending lock — this version is now validating. */
  | { ok: true; pendingVersionId: string; baselineVersionId: string | null }
  /** A concurrent force-rescrape already holds the pending lock — rejected cleanly (AC4). */
  | { ok: false; reason: "conflict" };

/**
 * Materializes the Article's current content as an ACTIVE baseline version (only
 * if none exists yet) and CLAIMS the per-Article PENDING lock. Both writes are
 * STANDALONE and idempotent: a concurrent baseline materialize loses the
 * `activeForArticleId` unique race harmlessly (the baseline already exists), and
 * a concurrent PENDING claim loses the `pendingForArticleId` unique race and is
 * reported as `conflict` — so two concurrent force-rescrapes serialize to exactly
 * one pending version and NEITHER the current nor the proposed version is lost.
 */
export async function createPendingRescrape(
  input: CreatePendingRescrapeInput,
): Promise<CreatePendingRescrapeResult> {
  const now = input.now ?? new Date();
  const { articleId } = input;

  // 1. Ensure a durable ACTIVE baseline exists (retain the current version).
  const existingActive = await prisma.articleContentVersion.findUnique({
    where: { activeForArticleId: articleId },
    select: { id: true },
  });
  let baselineVersionId = existingActive?.id ?? null;
  if (!baselineVersionId) {
    try {
      const created = await prisma.articleContentVersion.create({
        data: {
          articleId,
          status: S.ACTIVE,
          activeForArticleId: articleId,
          reason: BASELINE_MATERIALIZE_REASON,
          requestedById: null,
          ...contentColumns(input.baseline),
          createdAt: now,
          activatedAt: now,
          updatedAt: now,
        },
        select: { id: true },
      });
      baselineVersionId = created.id;
    } catch (error) {
      // A concurrent request materialized the baseline first — that is fine; the
      // ACTIVE version now exists either way. Any other error propagates.
      if (!isUniqueConflict(error)) throw error;
      const active = await prisma.articleContentVersion.findUnique({
        where: { activeForArticleId: articleId },
        select: { id: true },
      });
      baselineVersionId = active?.id ?? null;
    }
  }

  // 2. Claim the PENDING lock (the serialization point for AC4). The pending row
  //    starts empty; its proposed content is filled at activation.
  try {
    const pending = await prisma.articleContentVersion.create({
      data: {
        articleId,
        status: S.PENDING,
        pendingForArticleId: articleId,
        reason: input.reason,
        requestedById: input.requestedById ?? null,
        extractorVersion: CURRENT_EXTRACTOR_VERSION,
        createdAt: now,
        updatedAt: now,
      },
      select: { id: true },
    });
    return { ok: true, pendingVersionId: pending.id, baselineVersionId };
  } catch (error) {
    if (isUniqueConflict(error)) return { ok: false, reason: "conflict" };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Record controlled failure (retain the active version)
// ---------------------------------------------------------------------------

/** Outcome of {@link recordRescrapeFailure}. */
export type RecordRescrapeFailureResult = {
  ok: true;
  /** The terminal status the pending version was moved to. */
  status: typeof S.FAILED | typeof S.REJECTED;
  /** False when the pending row was already resolved concurrently (idempotent no-op). */
  applied: boolean;
};

/**
 * Records a controlled failure: moves the PENDING version to FAILED (fetch/
 * internal abort) or REJECTED (validation-gate refusal), stamps the machine
 * reason code, and RELEASES the pending lock — leaving the ACTIVE version and all
 * reader access UNCHANGED (AC1). A guarded `updateMany` keyed on the still-pending
 * lock makes it idempotent: a row already resolved by a concurrent path is a safe
 * no-op (`applied: false`).
 *
 * #1103 — when the annotation-migration gate blocks activation, the count + IDs
 * of the anchors that could NOT be reliably re-anchored are stamped on the
 * version row (metadata only — highlight IDs, never quote/note text) so the
 * force-rescrape status endpoint can surface them for operator/user confirmation
 * instead of dropping them.
 */
export async function recordRescrapeFailure(input: {
  versionId: string;
  articleId: string;
  reason: ForceRescrapeFailureReason;
  /** #1103 — number of anchors that could not be reliably re-anchored (metadata). */
  unresolvedAnchorCount?: number;
  /** #1103 — IDs of those anchors (metadata only — never their quote/note text). */
  unresolvedAnchorIds?: string[];
  now?: Date;
}): Promise<RecordRescrapeFailureResult> {
  const now = input.now ?? new Date();
  const status = FAILED_STATUS_REASONS.has(input.reason) ? S.FAILED : S.REJECTED;

  const unresolvedAnchorData =
    input.unresolvedAnchorCount != null || input.unresolvedAnchorIds != null
      ? {
          unresolvedAnchorCount: input.unresolvedAnchorCount ?? null,
          unresolvedAnchorIds:
            input.unresolvedAnchorIds && input.unresolvedAnchorIds.length > 0
              ? input.unresolvedAnchorIds
              : Prisma.DbNull,
        }
      : {};

  const updated = await prisma.articleContentVersion.updateMany({
    where: {
      id: input.versionId,
      status: S.PENDING,
      pendingForArticleId: input.articleId,
    },
    data: {
      status,
      pendingForArticleId: null,
      failureReason: input.reason,
      ...unresolvedAnchorData,
      updatedAt: now,
    },
  });

  return { ok: true, status, applied: updated.count === 1 };
}

// ---------------------------------------------------------------------------
// Activate (atomic swap: pending → ACTIVE, old ACTIVE → SUPERSEDED, Article update)
// ---------------------------------------------------------------------------

/** Rolls the activation transaction back when the pending row changed concurrently. */
class RescrapeActivationRaceError extends Error {
  constructor() {
    super("force-rescrape activation lost the pending-version concurrency guard");
    this.name = "RescrapeActivationRaceError";
  }
}

/** Outcome of {@link activateRescrape}. */
export type ActivateRescrapeResult =
  /** The pending version is now ACTIVE; the old active version is SUPERSEDED. */
  | { ok: true; activeVersionId: string; supersededVersionId: string | null }
  /** The pending version was resolved (failed/activated) concurrently — no change. */
  | { ok: false; reason: "race" };

/** Columns activation reads from the pending row under the transaction. */
const ACTIVATION_PENDING_SELECT = {
  id: true,
  articleId: true,
  status: true,
  pendingForArticleId: true,
} satisfies Prisma.ArticleContentVersionSelect;

/**
 * Atomically activates a validated pending version. In ONE interactive
 * `$transaction` it re-reads + guards the pending row, DEMOTES the current ACTIVE
 * version to SUPERSEDED (clearing its `activeForArticleId` slot), PROMOTES the
 * pending version to ACTIVE (filling content + fingerprint + provenance, claiming
 * the `activeForArticleId` slot, clearing `pendingForArticleId`, and stamping
 * `derivedRegenerationRequestedAt` to MARK derived outputs for #1103), MIGRATES
 * the reliable highlight/note anchor offsets onto the new content (#1103), and
 * UPDATES the Article's readable fields IN PLACE — preserving its id, ownerId,
 * visibility, status, canonical/source URLs, and every reading relationship.
 *
 * ANCHOR MIGRATION (#1103): the caller passes the reliable `anchorMoves` (only
 * "moved" anchors — "valid" ones keep their offsets) computed by the migrator
 * BEFORE the gate. Applying them INSIDE this transaction guarantees highlight
 * offsets swap all-or-nothing WITH the content (data integrity). To avoid a
 * transient `@@unique([userId, articleId, startOffset, endOffset])` collision
 * when offsets shift, the moves are applied in TWO PHASES: every moved anchor is
 * first parked at a unique out-of-range temporary offset, then set to its final
 * offset. A move whose highlight was concurrently deleted (`count === 0`) is
 * skipped — a missing highlight is benign and never rolls the swap back.
 *
 * Concurrency (mirrors `article-save-commit.ts`): reads-before-tx, guarded
 * `updateMany` re-validation inside the tx (`count === 0` ⇒ throw ⇒ rollback), so
 * a fault at ANY write leaves the old active version fully intact. A P2002 is
 * NEVER caught inside the transaction.
 *
 * The `debugHooks` fire INSIDE the tx right before each write so a test can prove
 * all-or-nothing rollback. Never set in production.
 */
export async function activateRescrape(input: {
  articleId: string;
  pendingVersionId: string;
  content: RescrapeContentPayload;
  /** #1103 — reliable anchor offset updates to apply atomically with the content. */
  anchorMoves?: AnchorMove[];
  now?: Date;
  debugHooks?: {
    beforeSupersede?: (tx: Prisma.TransactionClient) => void | Promise<void>;
    beforePromote?: (tx: Prisma.TransactionClient) => void | Promise<void>;
    beforeArticleUpdate?: (tx: Prisma.TransactionClient) => void | Promise<void>;
    beforeAnchorMigrate?: (tx: Prisma.TransactionClient) => void | Promise<void>;
  };
}): Promise<ActivateRescrapeResult> {
  const now = input.now ?? new Date();
  const { articleId, pendingVersionId } = input;

  try {
    return await prisma.$transaction(async (tx) => {
      const pending = await tx.articleContentVersion.findUnique({
        where: { id: pendingVersionId },
        select: ACTIVATION_PENDING_SELECT,
      });
      if (
        !pending ||
        pending.status !== S.PENDING ||
        pending.pendingForArticleId !== articleId ||
        pending.articleId !== articleId
      ) {
        throw new RescrapeActivationRaceError();
      }

      // Demote the current ACTIVE version (if any) to SUPERSEDED and release its
      // active slot so the pending row can claim it. Guarded on the active slot;
      // a zero count simply means there was no active version to demote.
      await input.debugHooks?.beforeSupersede?.(tx);
      const superseded = await tx.articleContentVersion.findUnique({
        where: { activeForArticleId: articleId },
        select: { id: true },
      });
      let supersededVersionId: string | null = null;
      if (superseded) {
        const demoted = await tx.articleContentVersion.updateMany({
          where: { id: superseded.id, activeForArticleId: articleId, status: S.ACTIVE },
          data: { status: S.SUPERSEDED, activeForArticleId: null, supersededAt: now, updatedAt: now },
        });
        if (demoted.count === 0) throw new RescrapeActivationRaceError();
        supersededVersionId = superseded.id;
      }

      // Promote the pending version to ACTIVE, filling its proposed content and
      // marking derived outputs for regeneration. Guarded on the pending lock.
      await input.debugHooks?.beforePromote?.(tx);
      const promoted = await tx.articleContentVersion.updateMany({
        where: { id: pendingVersionId, status: S.PENDING, pendingForArticleId: articleId },
        data: {
          status: S.ACTIVE,
          pendingForArticleId: null,
          activeForArticleId: articleId,
          activatedAt: now,
          derivedRegenerationRequestedAt: now,
          updatedAt: now,
          ...contentColumns(input.content),
        },
      });
      if (promoted.count === 0) throw new RescrapeActivationRaceError();

      // Swap the Article's READABLE version in place. Preserves id, ownerId,
      // visibility, status, reviewState, source/canonical URLs, and relationships.
      await input.debugHooks?.beforeArticleUpdate?.(tx);
      await tx.article.update({
        where: { id: articleId },
        data: {
          content: input.content.content,
          title: input.content.title,
          excerpt: input.content.excerpt ?? null,
          author: input.content.author ?? null,
          heroImage: input.content.heroImage ?? null,
          source: input.content.source ?? null,
          category: input.content.category ?? null,
          wordCount: input.content.wordCount ?? null,
          readingMinutes: input.content.readingMinutes ?? null,
          updatedAt: now,
        },
      });

      // Migrate reliable anchor offsets onto the new content, atomically with the
      // swap. Two-phase to avoid transient @@unique collisions as offsets shift.
      await input.debugHooks?.beforeAnchorMigrate?.(tx);
      await migrateAnchorOffsets(tx, articleId, input.anchorMoves ?? [], now);

      return { ok: true, activeVersionId: pendingVersionId, supersededVersionId };
    });
  } catch (error) {
    if (error instanceof RescrapeActivationRaceError) return { ok: false, reason: "race" };
    throw error;
  }
}

/**
 * Out-of-range base for the two-phase anchor migration's temporary offsets. Far
 * beyond any real content length (reader offsets are bounded well under this and
 * the API caps anchors at 10,000,000), so parking a highlight here can never
 * collide with a non-migrated anchor's real offsets, and stays within a 32-bit
 * signed integer for both engines.
 */
const TEMP_ANCHOR_OFFSET_BASE = 1_000_000_000;

/**
 * Applies reliable anchor offset moves in TWO PHASES inside the activation tx:
 *   1. Park every moved highlight at a unique temporary offset (base + 2·i) so no
 *      two moves — and no move-vs-existing anchor — ever share offsets mid-swap.
 *   2. Set each highlight to its final validated offset (guaranteed unique per
 *      user by the migrator's collision resolution).
 * A move whose highlight was concurrently deleted updates zero rows and is
 * skipped (benign) — it never rolls the activation back.
 */
async function migrateAnchorOffsets(
  tx: Prisma.TransactionClient,
  articleId: string,
  moves: AnchorMove[],
  now: Date,
): Promise<void> {
  if (moves.length === 0) return;

  for (let i = 0; i < moves.length; i += 1) {
    const parked = TEMP_ANCHOR_OFFSET_BASE + i * 2;
    await tx.highlight.updateMany({
      where: { id: moves[i].id, articleId },
      data: { startOffset: parked, endOffset: parked + 1, updatedAt: now },
    });
  }

  for (const move of moves) {
    await tx.highlight.updateMany({
      where: { id: move.id, articleId },
      data: { startOffset: move.startOffset, endOffset: move.endOffset, updatedAt: now },
    });
  }
}
