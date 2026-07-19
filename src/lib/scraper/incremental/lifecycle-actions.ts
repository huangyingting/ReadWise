/**
 * Admin lifecycle-action dispatcher for discovery sources (issue #1089, Phase
 * 1.9).
 *
 * This is a THIN mapping from a validated admin action name onto the EXISTING
 * guarded lifecycle-commit functions (`lifecycle-commit.ts`). It writes NO new
 * transition path: it reads the source once, refuses to act on a source a worker
 * is currently running (its lease is held), and otherwise delegates to
 * `beginBaseline` / `activateDiscoverySource` / `transitionDiscoveryLifecycle`
 * using the source's CURRENT lease owner (`null` when idle) + `definitionVersion`
 * as the guard, so a worker that claims the source between the read and the tx
 * cleanly aborts the admin write (→ `lease-lost`).
 *
 * The admin caller is not a worker and holds no lease. Admin lifecycle changes
 * therefore only apply to an IDLE source; runs are bounded to a single page, so
 * idleness is the norm. NO body is fetched, NO Article is written, and NO ingest
 * work is enqueued by any action — these are pure lifecycle state changes.
 */
import { DiscoverySourceLifecycleMode } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import {
  activateDiscoverySource,
  beginBaseline,
  transitionDiscoveryLifecycle,
} from "./lifecycle-commit";

const M = DiscoverySourceLifecycleMode;

/** The lifecycle actions an admin may invoke (capability-gated + audited). */
export const LIFECYCLE_ACTIONS = [
  "begin-baseline",
  "activate",
  "pause",
  "resume",
  "rollback",
  "disable",
  "retire",
] as const;

export type LifecycleActionName = (typeof LIFECYCLE_ACTIONS)[number];

/** Why an action did not apply (sanitized category — never a URL/body). */
export type LifecycleActionFailure =
  | "source-not-found"
  | "busy"
  | "invalid-transition"
  | "lease-lost"
  | "baseline-incomplete";

/** Outcome of an admin lifecycle action. */
export type LifecycleActionResult =
  | { ok: false; reason: LifecycleActionFailure; incompleteSegments?: string[] }
  | {
      ok: true;
      action: LifecycleActionName;
      fromMode: DiscoverySourceLifecycleMode;
      toMode: DiscoverySourceLifecycleMode;
      /** Present for `activate`: candidates moved DISCOVERED → QUEUED. */
      queuedCount?: number;
      /** Present for `activate`: shadow candidates left as observations. */
      deferredCount?: number;
    };

/** One safe rollback step toward DISABLED (mirrors the pure `ROLLBACK_PREV`). */
function rollbackTarget(from: DiscoverySourceLifecycleMode): DiscoverySourceLifecycleMode | null {
  switch (from) {
    case M.ACTIVE:
      return M.SHADOW;
    case M.SHADOW:
      return M.BASELINE;
    case M.BASELINE:
    case M.PAUSED:
      return M.DISABLED;
    default:
      return null;
  }
}

/**
 * Resolves the target mode for a `resume`. A source paused AFTER its baseline
 * completed re-enters SHADOW (the safe observe-only mode, from which an operator
 * re-activates); a source paused BEFORE baseline completion re-enters BASELINE so
 * it never skips its baseline (the governing invariant).
 */
function resumeTarget(baselineCompletedAt: Date | null): DiscoverySourceLifecycleMode {
  return baselineCompletedAt === null ? M.BASELINE : M.SHADOW;
}

/**
 * Applies an admin lifecycle action to a source, reusing the guarded lifecycle
 * commits. Returns a typed failure for a missing/busy source or an illegal
 * transition; the route maps these to HTTP statuses and audits successes.
 */
export async function applyLifecycleAction(
  sourceId: string,
  action: LifecycleActionName,
  now: Date = new Date(),
): Promise<LifecycleActionResult> {
  const source = await prisma.discoverySource.findUnique({
    where: { id: sourceId },
    select: {
      lifecycleMode: true,
      leaseOwner: true,
      definitionVersion: true,
      baselineCompletedAt: true,
    },
  });
  if (!source) return { ok: false, reason: "source-not-found" };
  // A worker currently holds the lease: refuse rather than race a live run.
  if (source.leaseOwner !== null) return { ok: false, reason: "busy" };

  const from = source.lifecycleMode;
  const base = {
    sourceId,
    leaseOwner: source.leaseOwner, // null (idle) — the guard value
    definitionVersion: source.definitionVersion,
    now,
  };

  if (action === "begin-baseline") {
    const result = await beginBaseline(base);
    if (!result.committed) return { ok: false, reason: result.reason };
    return { ok: true, action, fromMode: from, toMode: result.mode };
  }

  if (action === "activate") {
    const result = await activateDiscoverySource(base);
    if (!result.committed) return { ok: false, reason: result.reason };
    return {
      ok: true,
      action,
      fromMode: from,
      toMode: result.mode,
      queuedCount: result.queuedCount,
      deferredCount: result.deferredCount,
    };
  }

  const targetMode = targetModeFor(action, from, source.baselineCompletedAt);
  if (targetMode === null) return { ok: false, reason: "invalid-transition" };

  const result = await transitionDiscoveryLifecycle({ ...base, targetMode });
  if (!result.committed) return { ok: false, reason: result.reason };
  return { ok: true, action, fromMode: from, toMode: result.mode };
}

/** Resolves the target lifecycle mode for a transition-based action. */
function targetModeFor(
  action: Exclude<LifecycleActionName, "begin-baseline" | "activate">,
  from: DiscoverySourceLifecycleMode,
  baselineCompletedAt: Date | null,
): DiscoverySourceLifecycleMode | null {
  switch (action) {
    case "pause":
      return M.PAUSED;
    case "resume":
      return resumeTarget(baselineCompletedAt);
    case "rollback":
      return rollbackTarget(from);
    case "disable":
      return M.DISABLED;
    case "retire":
      return M.RETIRED;
    default:
      return null;
  }
}
