/**
 * Client-safe metadata for the discovery-source lifecycle actions (issue #1089,
 * Phase 1.9).
 *
 * This module is the single source of truth for the admin lifecycle action
 * NAMES, their human labels, and which are destructive (needing an explicit
 * confirm). It imports NOTHING with a runtime dependency (no prisma, no fetch),
 * so it is safe to import from BOTH the server-only dispatcher
 * (`lifecycle-actions.ts`) and the client action component. Keeping the names
 * here — and re-exporting them from `lifecycle-actions.ts` — guarantees the UI's
 * button set and the API's validated action set never drift.
 */

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

/** Short, operator-facing button labels for each action. */
export const LIFECYCLE_ACTION_LABELS: Record<LifecycleActionName, string> = {
  "begin-baseline": "Begin baseline",
  activate: "Activate",
  pause: "Pause",
  resume: "Resume",
  rollback: "Rollback",
  disable: "Disable",
  retire: "Retire",
};

/**
 * Actions that unwind or stop a source. These get an explicit inline confirm in
 * the UI so an operator cannot demote/disable/retire a source by a single click.
 */
export const DESTRUCTIVE_LIFECYCLE_ACTIONS: readonly LifecycleActionName[] = [
  "rollback",
  "disable",
  "retire",
];

/** True when an action should require an inline confirm before dispatch. */
export function isDestructiveLifecycleAction(action: LifecycleActionName): boolean {
  return DESTRUCTIVE_LIFECYCLE_ACTIONS.includes(action);
}
