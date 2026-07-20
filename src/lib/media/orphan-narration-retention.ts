/**
 * Reap orphaned narration media blobs after force-rescrape regeneration
 * (#1131 — force-rescrape #1103 follow-up).
 *
 * When force-rescrape regeneration runs, `clearContentDerivedOutputs`
 * (scraper/incremental/derived-regeneration.ts) DELETES the `ArticleSpeech` row
 * so narration regenerates from the new content, but the underlying audio
 * `MediaAsset` blob is intentionally NOT deleted inline — activation stays fast
 * and all-or-nothing (#1103). Because `ArticleSpeech.mediaAssetId` is
 * `onDelete: SetNull` and `MediaAsset.articleId` is `onDelete: Cascade`, the
 * MediaAsset survives with its Article relation intact but its `speech`
 * back-relation now NULL — an ORPHANED blob that accumulates over time. This
 * script-driven sweep reclaims those; the activation path stays untouched, which
 * satisfies the issue's "do not delete inline" requirement.
 *
 * ORPHAN PREDICATE (covered by `@@index([kind, createdAt])`): a `MediaAsset`
 * with `kind = "speech"` AND `speech IS NULL` (no `ArticleSpeech` references it)
 * AND `createdAt <= now - grace`. `speech` is the ONLY referrer to a MediaAsset,
 * so a null `speech` relation is an unambiguous orphan.
 *
 * GRACE is DEFENSE-IN-DEPTH, not strictly required: a narration MediaAsset and
 * its ArticleSpeech are created ATOMICALLY in one `prisma.$transaction`
 * (speech/repository.ts), so no normal in-flight window exists where a speech
 * asset lacks its ArticleSpeech. The grace still guards clock skew, retries, and
 * any future non-atomic path.
 *
 * REAP ORDER (blob before row — never orphan the storage): delete the blob
 * first and delete the DB row ONLY for blobs that deleted successfully. A failed
 * blob delete keeps its row so the next sweep retries it. If NO object storage is
 * configured, delete NOTHING (removing the row would leak the blob forever) and
 * let a later run with storage reclaim it.
 *
 * MODULE BOUNDARY: `media/*` depends on prisma + storage + logger only — no
 * `@/lib/jobs`, no scraper imports. PRIVACY: every log here carries counts only —
 * never a storageKey, URL, id, article text, or any user-private content.
 */
import { type Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/observability/logger";
import { getMediaStorage, type MediaStorage } from "@/lib/storage";

const log = createLogger("orphan-narration-reaper");

/** The MediaAsset kind narration audio is stored under. */
const SPEECH_KIND = "speech";

/**
 * Default reap batch size. Bounds the ACTION so a single sweep stays cheap +
 * predictable; a larger backlog drains over successive sweeps (each reap is
 * idempotent, so partial progress is safe).
 */
export const REAP_DEFAULT_LIMIT = 200;

/** Hard ceiling for `--limit`, so an operator typo can't launch an unbounded sweep. */
export const REAP_MAX_LIMIT = 1000;

/**
 * Default grace window (60 minutes). Orphans younger than this are left for a
 * later sweep — defense-in-depth against clock skew / retries even though the
 * atomic MediaAsset+ArticleSpeech write means no normal in-flight window exists.
 */
export const ORPHAN_NARRATION_GRACE_MINUTES = 60;
export const ORPHAN_NARRATION_GRACE_MS = ORPHAN_NARRATION_GRACE_MINUTES * 60 * 1000;

/** Batch size for the id-keyed `deleteMany`; kept <=999 so SQLite `IN (...)` is safe. */
const DELETE_CHUNK = 500;

/** The minimal storage contract the reaper needs (blob deletion only). */
export type OrphanReaperStorage = Pick<MediaStorage, "delete">;

/**
 * Oldest `createdAt` a MediaAsset may carry and still be eligible: any asset
 * created at/after `now - graceMs` is inside the grace window and skipped this
 * run. Pure; injected `now` keeps callers deterministic.
 */
export function orphanNarrationCutoff(
  now: Date,
  graceMs: number = ORPHAN_NARRATION_GRACE_MS,
): Date {
  return new Date(now.getTime() - graceMs);
}

/**
 * Clamps a caller/CLI `limit` into `[1, REAP_MAX_LIMIT]`, falling back to
 * {@link REAP_DEFAULT_LIMIT} for undefined / non-finite / non-positive input.
 * Pure — unit tested directly.
 */
export function clampReapLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return REAP_DEFAULT_LIMIT;
  const floored = Math.floor(limit);
  if (floored < 1) return REAP_DEFAULT_LIMIT;
  return Math.min(REAP_MAX_LIMIT, floored);
}

/**
 * The orphan predicate: a narration MediaAsset with no ArticleSpeech referrer
 * created at/before `cutoff` (i.e. past the grace window). `speech: { is: null }`
 * excludes still-linked assets; `kind = "speech"` excludes other media kinds.
 * Backed by `@@index([kind, createdAt])`.
 */
function orphanWhere(cutoff: Date): Prisma.MediaAssetWhereInput {
  return {
    kind: SPEECH_KIND,
    speech: { is: null },
    createdAt: { lte: cutoff },
  };
}

/**
 * Counts orphaned narration MediaAssets past the grace window without deleting
 * anything. Read-only; safe to run on any schedule.
 */
export async function countOrphanedNarrationAssets(
  opts: { graceMs?: number; now?: Date } = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  const cutoff = orphanNarrationCutoff(now, opts.graceMs);
  return prisma.mediaAsset.count({ where: orphanWhere(cutoff) });
}

/** Outcome tally of a reap sweep. `matched === reaped + failed` when storage is present. */
export type ReapOrphanedNarrationResult = {
  /** Orphaned narration assets selected this run (bounded by limit). */
  matched: number;
  /** Rows deleted — their blob deleted successfully. */
  reaped: number;
  /** Blob deletes that were rejected — rows kept for the next sweep. */
  failed: number;
};

/** Deletes MediaAsset rows by id in SQLite-safe chunks; returns rows removed. */
async function deleteAssetsByIds(ids: string[]): Promise<number> {
  let count = 0;
  for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
    const chunk = ids.slice(i, i + DELETE_CHUNK);
    const result = await prisma.mediaAsset.deleteMany({ where: { id: { in: chunk } } });
    count += result.count;
  }
  return count;
}

/**
 * Reaps up to `limit` orphaned narration blobs (oldest-created first) following
 * the blob-before-row order: delete each blob, then delete ONLY the rows whose
 * blob deleted successfully. Failed blob deletes keep their row for a later
 * retry. If no object storage is configured, nothing is deleted (removing the
 * row would leak the blob forever). Metadata-only logs (counts only).
 *
 * `storage` is injectable for deterministic tests; it defaults to
 * {@link getMediaStorage}. Pass `null` to exercise the no-storage guard.
 */
export async function reapOrphanedNarrationAssets(
  opts: {
    graceMs?: number;
    now?: Date;
    limit?: number;
    storage?: OrphanReaperStorage | null;
  } = {},
): Promise<ReapOrphanedNarrationResult> {
  const now = opts.now ?? new Date();
  const cutoff = orphanNarrationCutoff(now, opts.graceMs);
  const limit = clampReapLimit(opts.limit);

  const orphans = await prisma.mediaAsset.findMany({
    where: orphanWhere(cutoff),
    select: { id: true, storageKey: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
  });
  if (orphans.length === 0) {
    return { matched: 0, reaped: 0, failed: 0 };
  }

  const storage = opts.storage !== undefined ? opts.storage : getMediaStorage();
  if (!storage) {
    // No object storage configured: deleting rows would leak the blobs forever,
    // so reap NOTHING and let a later run (with storage) reclaim them.
    log.warn("orphan_narration.storage_unavailable", { matched: orphans.length });
    return { matched: orphans.length, reaped: 0, failed: 0 };
  }

  const results = await Promise.allSettled(
    orphans.map((asset) => storage.delete(asset.storageKey)),
  );

  const deletedIds: string[] = [];
  let failed = 0;
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      deletedIds.push(orphans[index]!.id);
    } else {
      failed += 1;
    }
  });

  const reaped = deletedIds.length > 0 ? await deleteAssetsByIds(deletedIds) : 0;

  if (failed > 0) {
    log.error("orphan_narration.blob_delete_failed", { failedCount: failed });
  }
  log.info("orphan_narration.reap_complete", {
    matched: orphans.length,
    reaped,
    failed,
  });

  return { matched: orphans.length, reaped, failed };
}
