/**
 * Thin, guarded backfill PERSISTENCE (issue #1101, Phase 3.2).
 *
 * Applies the pure {@link backfill-policy} decisions onto the durable
 * `BackfillRun` + the shared `CrawlCandidate` ledger using the repo's
 * guarded-transition house style (reads BEFORE the tx; a single interactive
 * `$transaction` re-validates state; a guarded `updateMany` whose zero-row
 * result rolls the write back). It writes NO decision logic — the pure policy
 * owns legality/idempotency/eligibility — and it NEVER fetches a body, writes an
 * Article, or reactivates a KNOWN/deleted identity (governing invariant).
 *
 * Reactivation is the ONE subtle move: a matching OBSERVED_BASELINE identity is
 * suppressed from AUTOMATIC ingestion by its `observedInBaseline=true` flag AND
 * by the deep save guard. An administrator-approved backfill promotes it into
 * active work by flipping `observedInBaseline=false` + `status=QUEUED` in the
 * SAME guarded update that enqueues its LOW-priority candidate-ingest Job, so the
 * UNCHANGED downstream pipeline (worker handler → ingest runner → atomic save)
 * then treats it as ordinary queued work. Because the guarded update matches only
 * a still-eligible row (BASELINE/DISCOVERED, no Article, not deleted) and the
 * enqueue is an idempotent upsert on the candidate/version dedupe key, a
 * resumed/retried/concurrent advance NEVER reactivates an identity twice and
 * NEVER creates a duplicate Job. The `checkpointCursor` (last processed candidate
 * id) is advanced under a compare-and-set guard, so progress survives a worker
 * restart and pause/resume/cancel never widen the approved range.
 */
import { CrawlCandidateStatus, BackfillRunStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { enqueueCandidateIngestInTx } from "@/lib/jobs";

import {
  BACKFILL_JOB_PRIORITY,
  decideBackfillLifecycle,
  type BackfillControlAction,
  type BackfillLifecycleIllegalReason,
  type BackfillLifecycleNoopReason,
  type EffectiveBackfillBounds,
} from "./backfill-policy";
import { BACKFILL_REACTIVATION_STATUS_FILTERS, eligibleBackfillCandidateWhere } from "./backfill-query";

const RS = BackfillRunStatus;

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/** Inputs to {@link createBackfillRun} (bounds already resolved by the policy). */
export type CreateBackfillRunInput = {
  providerKey: string;
  discoverySourceId?: string | null;
  /** Sanitized actor id (plain string, metadata only — never an FK). */
  actorId?: string | null;
  /** Sanitized operator reason (required). */
  reason: string;
  /** Bounds AS REQUESTED (for the audit/clamp record); window edges may be open. */
  requested: { windowStart: Date | null; windowEnd: Date | null; maxItems: number };
  /** The clamped bounds the run enforces. */
  effective: EffectiveBackfillBounds;
  /** Sanitized clamp warning categories. */
  warnings: string[];
  now?: Date;
};

/**
 * Creates a RUNNING backfill run recording the actor, reason, requested vs
 * effective bounds, and clamp warnings. Standalone insert (no guarded update
 * needed — a fresh row). Returns the new run id; the caller re-queries the
 * sanitized DTO.
 */
export async function createBackfillRun(input: CreateBackfillRunInput): Promise<{ id: string }> {
  const now = input.now ?? new Date();
  const run = await prisma.backfillRun.create({
    data: {
      providerKey: input.providerKey,
      discoverySourceId: input.discoverySourceId ?? null,
      actorId: input.actorId ?? null,
      reason: input.reason,
      requestedWindowStart: input.requested.windowStart,
      requestedWindowEnd: input.requested.windowEnd,
      requestedMaxItems: input.requested.maxItems,
      windowStart: input.effective.windowStart,
      windowEnd: input.effective.windowEnd,
      maxItems: input.effective.maxItems,
      status: RS.RUNNING,
      warnings: input.warnings as Prisma.InputJsonValue,
      startedAt: now,
    },
    select: { id: true },
  });
  return { id: run.id };
}

// ---------------------------------------------------------------------------
// Advance (resumable guarded batch)
// ---------------------------------------------------------------------------

/** Rolls the batch transaction back when the run moved on / was contended. */
class BackfillRunNotAdvancingError extends Error {
  constructor() {
    super("backfill run changed concurrently during advance");
    this.name = "BackfillRunNotAdvancingError";
  }
}

/** Outcome of {@link advanceBackfillRun}. */
export type AdvanceBackfillResult =
  | { ok: false; reason: "not-found" }
  /** The run is not RUNNING (paused/terminal) — nothing to do. */
  | { ok: true; kind: "inactive"; status: BackfillRunStatus }
  /** The bounded scan is exhausted (drained or item cap reached) — run COMPLETED. */
  | { ok: true; kind: "completed"; reason: "drained" | "budget-reached" }
  /** A concurrent advance/pause won the checkpoint race — retry next tick. */
  | { ok: true; kind: "contended" }
  /** One batch was applied. */
  | { ok: true; kind: "advanced"; reactivated: number; skipped: number; batchSize: number; lastId: string };

/** Columns the advance reads from the run (metadata only). */
const ADVANCE_RUN_SELECT = {
  providerKey: true,
  discoverySourceId: true,
  status: true,
  windowStart: true,
  windowEnd: true,
  maxItems: true,
  reactivatedCount: true,
  checkpointCursor: true,
} satisfies Prisma.BackfillRunSelect;

/** Marks a drained/budget-reached run COMPLETED, guarded on RUNNING + cursor. */
async function markRunCompleted(
  runId: string,
  expectedCursor: string | null,
  now: Date,
): Promise<void> {
  await prisma.backfillRun.updateMany({
    where: { id: runId, status: RS.RUNNING, checkpointCursor: expectedCursor },
    data: { status: RS.COMPLETED, completedAt: now, updatedAt: now },
  });
}

/**
 * Advances a RUNNING backfill by ONE bounded batch: reactivates up to
 * `batchSize` (capped by the remaining item budget) still-eligible identities
 * beyond the checkpoint, enqueues their LOW-priority ingest Jobs, and advances
 * the checkpoint + counters — all under a compare-and-set guard on the run's
 * current status + cursor. Reads happen before the tx; the tx re-validates the
 * run is still RUNNING and the cursor unchanged, so two workers (or a resumed
 * run) can never double-advance or widen the range. Completes the run when the
 * scan is drained or the item cap is reached.
 */
export async function advanceBackfillRun(input: {
  runId: string;
  batchSize: number;
  now?: Date;
}): Promise<AdvanceBackfillResult> {
  const now = input.now ?? new Date();
  const run = await prisma.backfillRun.findUnique({
    where: { id: input.runId },
    select: ADVANCE_RUN_SELECT,
  });
  if (!run) return { ok: false, reason: "not-found" };
  if (run.status !== RS.RUNNING) return { ok: true, kind: "inactive", status: run.status };
  if (run.windowStart === null || run.windowEnd === null) {
    // Defensive: a run always has concrete effective bounds; a malformed one is
    // never scanned (an unbounded scan would violate the governing invariant).
    return { ok: true, kind: "inactive", status: run.status };
  }

  const remainingBudget = run.maxItems - run.reactivatedCount;
  if (remainingBudget <= 0) {
    await markRunCompleted(input.runId, run.checkpointCursor, now);
    return { ok: true, kind: "completed", reason: "budget-reached" };
  }

  const bounds: EffectiveBackfillBounds = {
    windowStart: run.windowStart,
    windowEnd: run.windowEnd,
    maxItems: run.maxItems,
  };
  const take = Math.min(Math.max(1, batchSizeOf(input.batchSize)), remainingBudget);
  const where: Prisma.CrawlCandidateWhereInput = {
    ...eligibleBackfillCandidateWhere(
      { providerKey: run.providerKey, discoverySourceId: run.discoverySourceId },
      bounds,
    ),
    ...(run.checkpointCursor ? { id: { gt: run.checkpointCursor } } : {}),
  };

  const batch = await prisma.crawlCandidate.findMany({
    where,
    select: { id: true },
    orderBy: { id: "asc" },
    take,
  });

  if (batch.length === 0) {
    await markRunCompleted(input.runId, run.checkpointCursor, now);
    return { ok: true, kind: "completed", reason: "drained" };
  }

  const lastId = batch[batch.length - 1].id;
  let reactivated = 0;
  let skipped = 0;

  try {
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.backfillRun.findUnique({
        where: { id: input.runId },
        select: { status: true, checkpointCursor: true },
      });
      if (!fresh || fresh.status !== RS.RUNNING) throw new BackfillRunNotAdvancingError();

      for (const candidate of batch) {
        // Guarded reactivation: match ONLY a still-eligible target row and flip
        // it into ordinary queued work. A concurrently-changed row (now QUEUED,
        // linked, deleted, or terminal) matches zero → skipped, never touched.
        // The OR MUST stay in lockstep with `eligibleBackfillCandidateWhere`
        // (backfill-query.ts): a status selected into the batch but missing here
        // would be scanned yet never flipped/enqueued (silently skipped).
        const updated = await tx.crawlCandidate.updateMany({
          where: {
            id: candidate.id,
            articleId: null,
            articleDeletedAt: null,
            OR: [...BACKFILL_REACTIVATION_STATUS_FILTERS],
          },
          data: {
            status: CrawlCandidateStatus.QUEUED,
            observedInBaseline: false,
            updatedAt: now,
          },
        });
        if (updated.count === 1) {
          await enqueueCandidateIngestInTx(tx, candidate.id, { priority: BACKFILL_JOB_PRIORITY });
          reactivated += 1;
        } else {
          skipped += 1;
        }
      }

      // Compare-and-set the checkpoint: only advance if the run is still RUNNING
      // AND the cursor is the one we read (no concurrent advance/pause won).
      const advanced = await tx.backfillRun.updateMany({
        where: { id: input.runId, status: RS.RUNNING, checkpointCursor: run.checkpointCursor },
        data: {
          checkpointCursor: lastId,
          matchedCount: { increment: batch.length },
          reactivatedCount: { increment: reactivated },
          skippedCount: { increment: skipped },
          updatedAt: now,
        },
      });
      if (advanced.count === 0) throw new BackfillRunNotAdvancingError();
    });
  } catch (error) {
    if (error instanceof BackfillRunNotAdvancingError) return { ok: true, kind: "contended" };
    throw error;
  }

  return { ok: true, kind: "advanced", reactivated, skipped, batchSize: batch.length, lastId };
}

function batchSizeOf(value: number): number {
  return Number.isInteger(value) && value > 0 ? value : 1;
}

// ---------------------------------------------------------------------------
// Lifecycle control (pause / resume / cancel)
// ---------------------------------------------------------------------------

/** Rolls a control transaction back when the run changed concurrently. */
class StaleBackfillRunError extends Error {
  constructor() {
    super("backfill run changed concurrently during control");
    this.name = "StaleBackfillRunError";
  }
}

/** Outcome of a control action (route maps failures to HTTP status). */
export type BackfillControlOutcome =
  | { ok: true; kind: "applied"; action: BackfillControlAction; fromStatus: BackfillRunStatus; toStatus: BackfillRunStatus }
  | { ok: true; kind: "noop"; action: BackfillControlAction; reason: BackfillLifecycleNoopReason; status: BackfillRunStatus }
  | { ok: false; reason: "not-found"; action: BackfillControlAction }
  | { ok: false; reason: "illegal"; action: BackfillControlAction; illegal: BackfillLifecycleIllegalReason; status: BackfillRunStatus }
  | { ok: false; reason: "stale"; action: BackfillControlAction; status: BackfillRunStatus };

function controlDataFor(
  action: BackfillControlAction,
  toStatus: BackfillRunStatus,
  now: Date,
): Prisma.BackfillRunUpdateManyMutationInput {
  if (action === "cancel") {
    return { status: toStatus, cancelledAt: now, updatedAt: now };
  }
  return { status: toStatus, updatedAt: now };
}

/**
 * Applies one operator control (pause / resume / cancel) to a run. Reads its
 * status, asks the pure policy for the decision, and — only for an `apply` —
 * runs the guarded transaction. A guarded zero-row update (someone changed the
 * run first) is resolved by re-reading + re-deciding: a now-idempotent control
 * returns `noop`, anything else returns `stale`. Never widens the range (control
 * touches only `status` + timestamps, never the bounds).
 */
export async function applyBackfillControl(input: {
  runId: string;
  action: BackfillControlAction;
  now?: Date;
}): Promise<BackfillControlOutcome> {
  const { runId, action } = input;
  const now = input.now ?? new Date();

  const run = await prisma.backfillRun.findUnique({ where: { id: runId }, select: { status: true } });
  if (!run) return { ok: false, reason: "not-found", action };

  const decision = decideBackfillLifecycle(run.status, action);
  if (decision.kind === "illegal") {
    return { ok: false, reason: "illegal", action, illegal: decision.reason, status: decision.status };
  }
  if (decision.kind === "noop") {
    return { ok: true, kind: "noop", action, reason: decision.reason, status: decision.status };
  }

  const { fromStatus, toStatus } = decision;
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.backfillRun.updateMany({
        where: { id: runId, status: fromStatus },
        data: controlDataFor(action, toStatus, now),
      });
      if (updated.count === 0) throw new StaleBackfillRunError();
    });
  } catch (error) {
    if (!(error instanceof StaleBackfillRunError)) throw error;
    const fresh = await prisma.backfillRun.findUnique({ where: { id: runId }, select: { status: true } });
    if (!fresh) return { ok: false, reason: "not-found", action };
    const redecision = decideBackfillLifecycle(fresh.status, action);
    if (redecision.kind === "noop") {
      return { ok: true, kind: "noop", action, reason: redecision.reason, status: redecision.status };
    }
    return { ok: false, reason: "stale", action, status: fresh.status };
  }

  return { ok: true, kind: "applied", action, fromStatus, toStatus };
}

/** Pauses a RUNNING backfill (idempotent). */
export function pauseBackfillRun(runId: string, now?: Date): Promise<BackfillControlOutcome> {
  return applyBackfillControl({ runId, action: "pause", now });
}

/** Resumes a PAUSED backfill; the sibling driver loop picks it up from the checkpoint. */
export function resumeBackfillRun(runId: string, now?: Date): Promise<BackfillControlOutcome> {
  return applyBackfillControl({ runId, action: "resume", now });
}

/** Cancels a RUNNING/PAUSED backfill (terminal, idempotent). */
export function cancelBackfillRun(runId: string, now?: Date): Promise<BackfillControlOutcome> {
  return applyBackfillControl({ runId, action: "cancel", now });
}
