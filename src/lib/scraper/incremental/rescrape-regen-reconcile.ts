/**
 * Reconcile stamped-but-unclaimed derived regeneration after a lost enqueue
 * (#1132 — force-rescrape #1103 follow-up).
 *
 * After a force-rescrape ACTIVATES a new content version, the activation
 * transaction stamps `ArticleContentVersion.derivedRegenerationRequestedAt`, and
 * the runner then calls {@link requestDerivedRegeneration} OUTSIDE that tx
 * (best-effort/retryable, so activation never blocks on optional AI/narration
 * providers). That function makes regeneration at-most-once by CLAIMING a
 * per-version `ArticleProcessingStep` keyed `rescrape-regen:<versionId>`.
 *
 * If the process dies AFTER activation commits but BEFORE the claim `create`
 * runs, the version is left with `derivedRegenerationRequestedAt != null` and NO
 * `rescrape-regen:<versionId>` step — a rare stamped-but-unclaimed state that
 * nothing else re-drives. This sweep finds those versions and RE-INVOKES the
 * existing {@link requestDerivedRegeneration}, which is already idempotent +
 * concurrency-safe (a concurrent/retried claim loses the `@@unique([articleId,
 * step])` race and is a safe no-op). We never reimplement claiming/enqueuing.
 *
 * WHY "no step" unambiguously means "never claimed" (not "completed + cleaned"):
 * the claim step PERSISTS permanently after a successful run — it is created
 * `status:"running"` then updated to `status:"generated"`, and
 * `clearContentDerivedOutputs` EXPLICITLY excludes the `rescrape-regen:*` step.
 * So a step in ANY status (running OR generated) means "already claimed — do not
 * re-drive"; only its total ABSENCE is the lost-enqueue we reconcile.
 *
 * GOVERNING INVARIANT: `derivedRegenerationRequestedAt` is ONLY ever stamped by
 * audited force-rescrape activation — ordinary discovery/ingest never sets it —
 * so this sweep only ever touches force-rescrape-produced versions by
 * construction (never ordinary/known Articles).
 *
 * MODULE BOUNDARY: lives under `scraper/incremental` and depends only on Prisma
 * + the existing `derived-regeneration` helpers. Job/enqueue helpers are reached
 * ONLY transitively through {@link requestDerivedRegeneration} (never a direct
 * `@/lib/jobs` import), honoring the one-way scraper boundary + barrel rule.
 *
 * PRIVACY: every log here carries IDs + counts only — never a URL, article text,
 * a quote, a note, a prompt, a translation, or any secret.
 */
import { ArticleContentVersionStatus, type Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/observability/logger";

import { requestDerivedRegeneration, rescrapeRegenStepKey } from "./derived-regeneration";

const log = createLogger("rescrape-regen-reconcile");

/**
 * Default max versions re-driven per sweep. Bounds the ACTION (not the scan) so a
 * single sweep stays cheap + predictable; a backlog larger than this drains over
 * successive sweeps (each re-drive is idempotent, so partial progress is safe).
 */
export const RECONCILE_DEFAULT_LIMIT = 100;

/** Hard ceiling for `--limit`, so an operator typo can't launch an unbounded sweep. */
export const RECONCILE_MAX_LIMIT = 1000;

/**
 * Grace window: SKIP versions stamped within this window so the reconciler never
 * races the ORIGINAL runner that just activated and is milliseconds away from
 * claiming. This is purely an optimization — re-invoking is already race-safe via
 * the unique claim — but it avoids redundant clears + log noise for the common
 * still-in-flight case.
 */
export const RECONCILE_GRACE_MS = 2 * 60 * 1000;

/** Batch size for the step-existence lookup; kept <=999 so SQLite `IN (...)` is safe. */
const STEP_LOOKUP_CHUNK = 500;

/**
 * Newest `derivedRegenerationRequestedAt` a version may carry to be eligible: any
 * version stamped at/after `now - RECONCILE_GRACE_MS` is still in-grace and left
 * for the original runner. Pure; injected `now` keeps callers deterministic.
 */
export function reconcileStampCutoff(now: Date): Date {
  return new Date(now.getTime() - RECONCILE_GRACE_MS);
}

/**
 * Clamps a caller/CLI `limit` into `[1, RECONCILE_MAX_LIMIT]`, falling back to
 * {@link RECONCILE_DEFAULT_LIMIT} for undefined / non-finite / non-positive input.
 * Pure — unit tested directly.
 */
export function clampReconcileLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return RECONCILE_DEFAULT_LIMIT;
  const floored = Math.floor(limit);
  if (floored < 1) return RECONCILE_DEFAULT_LIMIT;
  return Math.min(RECONCILE_MAX_LIMIT, floored);
}

/**
 * The candidate predicate: an ACTIVE content version whose derived regeneration
 * was stamped at/before `cutoff` (i.e. past the grace window). `lte` on the
 * nullable column excludes null-stamped ordinary-discovery versions, so the
 * governing invariant holds structurally. A version row can never outlive its
 * Article (FK `onDelete: Cascade`), so "Article still exists" needs no extra
 * filter; `status ACTIVE` covers "is the current version".
 */
function candidateWhere(cutoff: Date): Prisma.ArticleContentVersionWhereInput {
  return {
    status: ArticleContentVersionStatus.ACTIVE,
    derivedRegenerationRequestedAt: { lte: cutoff },
  };
}

/**
 * Returns the subset of `versionIds` that ALREADY have a `rescrape-regen:<id>`
 * claim step (in ANY status). The step key embeds a globally-unique versionId, so
 * matching on `step` alone is exact. Chunked to keep each `IN (...)` list small.
 */
async function claimedVersionSteps(versionIds: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const stepKeys = versionIds.map(rescrapeRegenStepKey);
  for (let i = 0; i < stepKeys.length; i += STEP_LOOKUP_CHUNK) {
    const chunk = stepKeys.slice(i, i + STEP_LOOKUP_CHUNK);
    const rows = await prisma.articleProcessingStep.findMany({
      where: { step: { in: chunk } },
      select: { step: true },
    });
    for (const row of rows) found.add(row.step);
  }
  return found;
}

/** A stamped-but-unclaimed version to re-drive (ids only — never content). */
type UnclaimedVersion = { id: string; articleId: string };

/**
 * Finds every ACTIVE, past-grace, stamped-but-unclaimed version, oldest-stamped
 * first. Prisma has no anti-join and the claim key is a computed string (not a
 * relation), so we fetch the (operator-gated, small) stamped-ACTIVE population
 * id-only and subtract the ones with a claim step in memory. Bounding this scan
 * would risk STARVING a genuinely-unclaimed version behind many older claimed
 * ones, so the scan is unbounded and the per-sweep `limit` bounds the ACTION.
 */
async function scanUnclaimed(cutoff: Date): Promise<UnclaimedVersion[]> {
  const candidates = await prisma.articleContentVersion.findMany({
    where: candidateWhere(cutoff),
    select: { id: true, articleId: true },
    orderBy: [{ derivedRegenerationRequestedAt: "asc" }, { id: "asc" }],
  });
  if (candidates.length === 0) return [];
  const claimed = await claimedVersionSteps(candidates.map((version) => version.id));
  return candidates.filter((version) => !claimed.has(rescrapeRegenStepKey(version.id)));
}

/**
 * Counts ACTIVE content versions that are stamped for derived regeneration
 * (past the grace window) but have NO `rescrape-regen:<versionId>` claim step —
 * the true stamped-but-unclaimed backlog. Read-only; safe to run on any schedule.
 */
export async function countUnclaimedRescrapeRegen(): Promise<number> {
  const cutoff = reconcileStampCutoff(new Date());
  const unclaimed = await scanUnclaimed(cutoff);
  return unclaimed.length;
}

/** Outcome tally of a reconcile sweep. `scanned === reDriven + alreadyClaimed`. */
export type ReconcileUnclaimedResult = {
  /** Stamped-but-unclaimed versions selected for re-invocation this sweep (<= limit). */
  scanned: number;
  /** Versions this sweep claimed + enqueued (result.requested). */
  reDriven: number;
  /** Versions a concurrent claim won between our scan and the re-invoke (alreadyRequested). */
  alreadyClaimed: number;
};

/**
 * Re-drives up to `limit` stamped-but-unclaimed ACTIVE versions (oldest-stamped
 * first for determinism) by RE-INVOKING {@link requestDerivedRegeneration} — the
 * existing idempotent, at-most-once claim/enqueue path. A version already claimed
 * at scan time is skipped; one claimed by a racing runner between scan and
 * re-invoke returns `alreadyRequested` and is tallied as `alreadyClaimed` (still
 * exactly one job). Metadata-only logs (ids + counts).
 */
export async function reconcileUnclaimedRescrapeRegen(
  opts: { limit?: number; now?: Date } = {},
): Promise<ReconcileUnclaimedResult> {
  const now = opts.now ?? new Date();
  const limit = clampReconcileLimit(opts.limit);
  const cutoff = reconcileStampCutoff(now);

  const unclaimed = await scanUnclaimed(cutoff);
  const batch = unclaimed.slice(0, limit);
  if (batch.length === 0) {
    return { scanned: 0, reDriven: 0, alreadyClaimed: 0 };
  }

  let reDriven = 0;
  let alreadyClaimed = 0;
  for (const version of batch) {
    const result = await requestDerivedRegeneration({
      articleId: version.articleId,
      versionId: version.id,
      now,
    });
    if (result.requested) {
      reDriven += 1;
    } else if (result.alreadyRequested) {
      alreadyClaimed += 1;
    }
  }

  log.info("rescrape-regen reconcile complete", {
    backlog: unclaimed.length,
    scanned: batch.length,
    reDriven,
    alreadyClaimed,
    limit,
  });

  return { scanned: batch.length, reDriven, alreadyClaimed };
}
