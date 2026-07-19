/**
 * Pure UI eligibility for discovery-source lifecycle actions (issue #1089,
 * Phase 1.9).
 *
 * The admin UI must show a DISABLED-action state for any action that is not
 * valid from a source's current lifecycle mode (e.g. `activate` only from
 * SHADOW, `begin-baseline` only from DISABLED). This module derives that
 * eligibility by mirroring EXACTLY what the server-side dispatcher
 * (`applyLifecycleAction`) would accept: it resolves each action to the same
 * target mode / guarded commit and asks the PURE {@link classifyLifecycleTransition}
 * state machine whether the edge is legal. The backend remains the source of
 * truth (it re-validates and returns 409 for an illegal transition or a busy
 * source); this only decides which buttons render enabled.
 *
 * PURE: no database, no clock, no network — just the enum + the state machine.
 */
import { DiscoverySourceLifecycleMode } from "@prisma/client";

import { classifyLifecycleTransition } from "./lifecycle";
import {
  LIFECYCLE_ACTIONS,
  type LifecycleActionName,
} from "./lifecycle-action-meta";

const M = DiscoverySourceLifecycleMode;

/** One safe rollback step toward DISABLED (mirrors `lifecycle-actions.rollbackTarget`). */
function rollbackTarget(
  from: DiscoverySourceLifecycleMode,
): DiscoverySourceLifecycleMode | null {
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
 * True when {@link applyLifecycleAction} would accept `action` from `mode`
 * (ignoring the runtime "busy"/lease guard, which the backend enforces). Used to
 * render an action button enabled vs. disabled. The result is a SAFE subset of
 * what the backend accepts: an enabled action always maps to a legal transition,
 * so the UI never offers a click that would 409 for an illegal transition.
 */
export function lifecycleActionEnabled(
  action: LifecycleActionName,
  mode: DiscoverySourceLifecycleMode,
): boolean {
  switch (action) {
    case "begin-baseline":
      return classifyLifecycleTransition(mode, M.BASELINE) === "forward";
    case "activate":
      return classifyLifecycleTransition(mode, M.ACTIVE) === "forward";
    case "pause":
      return classifyLifecycleTransition(mode, M.PAUSED) !== null;
    case "resume":
      // Resume is only meaningful from PAUSED (the dispatcher then picks the safe
      // re-entry mode). Restricting it here avoids offering "resume" on a source
      // that is not paused.
      return mode === M.PAUSED;
    case "rollback": {
      const target = rollbackTarget(mode);
      return target !== null && classifyLifecycleTransition(mode, target) !== null;
    }
    case "disable":
      return classifyLifecycleTransition(mode, M.DISABLED) !== null;
    case "retire":
      return classifyLifecycleTransition(mode, M.RETIRED) !== null;
    default:
      return false;
  }
}

/** The subset of actions currently enabled for a source in `mode`. */
export function enabledLifecycleActions(
  mode: DiscoverySourceLifecycleMode,
): LifecycleActionName[] {
  return LIFECYCLE_ACTIONS.filter((action) => lifecycleActionEnabled(action, mode));
}
