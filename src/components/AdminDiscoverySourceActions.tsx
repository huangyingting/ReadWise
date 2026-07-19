"use client";

import { postJson } from "@/lib/client-fetch";
import ConfirmAction from "@/components/ConfirmAction";
import { Button, type ButtonProps } from "@/components/ui/Button";
import { useAdminAction } from "@/hooks/useAdminAction";
import {
  LIFECYCLE_ACTIONS,
  LIFECYCLE_ACTION_LABELS,
  isDestructiveLifecycleAction,
  type LifecycleActionName,
} from "@/lib/scraper/incremental/lifecycle-action-meta";

interface AdminDiscoverySourceActionsProps {
  sourceId: string;
  /** Actions valid from the source's current lifecycle mode (backend re-validates). */
  enabledActions: readonly LifecycleActionName[];
}

/** Resting button variant per action (destructive actions use ConfirmAction). */
const ACTION_VARIANT: Record<LifecycleActionName, NonNullable<ButtonProps["variant"]>> = {
  "begin-baseline": "primary",
  activate: "primary",
  pause: "secondary",
  resume: "secondary",
  rollback: "outline",
  disable: "danger-ghost",
  retire: "danger-ghost",
};

/** Inline-confirm copy for the unwind / stop actions. */
const CONFIRM_MESSAGE: Partial<Record<LifecycleActionName, string>> = {
  rollback:
    "Roll this source back one lifecycle step toward disabled? Discovery state is preserved and the step is reversible.",
  disable:
    "Disable this source? It stops being scheduled until an operator begins a new baseline.",
  retire:
    "Permanently retire this source? RETIRED is terminal — the source can no longer transition.",
};

function postLifecycleAction(
  sourceId: string,
  action: LifecycleActionName,
): Promise<void> {
  return postJson<void>(
    `/api/admin/discovery-sources/${encodeURIComponent(sourceId)}/lifecycle`,
    { action },
  );
}

/**
 * Lifecycle action controls for a single discovery source (#1089). Renders the
 * seven admin actions (begin-baseline | activate | pause | resume | rollback |
 * disable | retire); each is DISABLED when it is not valid from the source's
 * current lifecycle mode. Destructive/unwind actions (rollback/disable/retire)
 * use the shared inline-confirm. Each action POSTs to
 * `/api/admin/discovery-sources/[id]/lifecycle` with `{ action }`, then refreshes
 * the page on success. The backend is the source of truth: an illegal transition
 * or a busy source returns 409 and its message is surfaced below the controls.
 */
export default function AdminDiscoverySourceActions({
  sourceId,
  enabledActions,
}: AdminDiscoverySourceActionsProps) {
  const { busy, error, openPanel, setOpenPanel, run } =
    useAdminAction<LifecycleActionName>();

  const busyAction = busy !== null;
  const runAction = (action: LifecycleActionName) =>
    run(action, () => postLifecycleAction(sourceId, action), {
      errorFallback: `${LIFECYCLE_ACTION_LABELS[action]} failed`,
    });

  return (
    <div className="admin-actions">
      <div className="admin-actions-row flex flex-wrap gap-[var(--space-2)]">
        {LIFECYCLE_ACTIONS.map((action) => {
          const label = LIFECYCLE_ACTION_LABELS[action];
          const enabled = enabledActions.includes(action);

          if (isDestructiveLifecycleAction(action)) {
            return (
              <ConfirmAction
                key={action}
                triggerLabel={label}
                triggerVariant={
                  ACTION_VARIANT[action] === "outline" ? "outline" : "danger-ghost"
                }
                confirmVariant="danger"
                confirmLabel={`Confirm ${label.toLowerCase()}`}
                confirmMessage={CONFIRM_MESSAGE[action]}
                onConfirm={() => runAction(action)}
                loading={busy === action}
                disabled={!enabled || busyAction}
                disabledTitle={
                  enabled ? undefined : "Not available from the current lifecycle mode"
                }
                open={openPanel === action}
                onOpenChange={(v) => setOpenPanel(v ? action : null)}
              />
            );
          }

          return (
            <Button
              key={action}
              variant={ACTION_VARIANT[action]}
              size="sm"
              loading={busy === action}
              disabled={!enabled || busyAction}
              title={
                enabled ? undefined : "Not available from the current lifecycle mode"
              }
              onClick={() => runAction(action)}
            >
              {label}
            </Button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="m-0 text-danger-text text-[length:var(--text-sm)]">
          {error}
        </p>
      )}
    </div>
  );
}
