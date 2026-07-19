"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge, Field, Skeleton, Textarea } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Popover";
import { getJson, postJson } from "@/lib/client-fetch";
import { classifyAdminFetchError, type AdminFetchErrorState } from "@/lib/admin/admin-fetch-state";
import {
  canDemote,
  canPromote,
  classifyTrustMutationError,
  formatRate,
  hasOldItemFalsePositive,
  trustBlockerLabel,
  trustStatusBadge,
  trustWarningLabel,
  volumeAnomalyLabel,
  type SourceTrustAction,
  type SourceTrustCommitResponse,
  type SourceTrustSnapshot,
} from "@/lib/scraper/incremental/source-trust-ui";

const MAX_REASON = 500;

type PanelState =
  | { status: "loading" }
  | { status: "error"; error: AdminFetchErrorState }
  | { status: "ready"; snapshot: SourceTrustSnapshot };

type Feedback =
  | { kind: "none" }
  | { kind: "success"; message: string }
  | { kind: "warning"; message: string }
  | { kind: "error"; message: string };

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-text-muted text-[length:var(--text-sm)]">{label}</dt>
      <dd className="m-0 font-medium">{children}</dd>
    </div>
  );
}

function MetricGrid({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-2 sm:grid-cols-3 gap-[var(--space-4)] m-0">{children}</dl>;
}

/**
 * Source-trust promotion panel (#1100). Client island rendered inside the
 * discovery-source detail page. Fetches the sanitized trust snapshot from
 * `/api/admin/discovery-sources/{id}/trust` and renders the current policy,
 * promotion evidence, drift signals, and the REPORTED eligibility. Promote is
 * gated on `eligibility.eligible` (disabled + blockers shown otherwise); demote
 * is offered only when the source is currently trusted. Both require an audit
 * reason and carry the source's `definitionVersion` (version-scoped). Metrics
 * only REPORT eligibility — the operator's explicit action is what promotes.
 */
export default function SourceTrustPanel({ sourceId }: { sourceId: string }) {
  const router = useRouter();
  const [state, setState] = useState<PanelState>({ status: "loading" });
  const [feedback, setFeedback] = useState<Feedback>({ kind: "none" });
  const [busy, setBusy] = useState<SourceTrustAction | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const body = await getJson<{ source: SourceTrustSnapshot }>(
        `/api/admin/discovery-sources/${encodeURIComponent(sourceId)}/trust`,
      );
      setState({ status: "ready", snapshot: body.source });
    } catch (err) {
      setState({ status: "error", error: classifyAdminFetchError(err) });
    }
  }, [sourceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (action: SourceTrustAction, definitionVersion: number, reason: string) => {
      setBusy(action);
      setFeedback({ kind: "none" });
      try {
        const res = await postJson<SourceTrustCommitResponse>(
          `/api/admin/discovery-sources/${encodeURIComponent(sourceId)}/trust`,
          { action, definitionVersion, reason },
        );
        setFeedback(
          res.changed
            ? {
                kind: "success",
                message:
                  action === "promote"
                    ? "Source promoted — auto-publish trust enabled."
                    : `Source demoted — auto-publish trust disabled${res.toMode ? ` (rolled to ${res.toMode})` : ""}.`,
              }
            : { kind: "warning", message: `No change — source is already ${action === "promote" ? "trusted" : "untrusted"}.` },
        );
        await load();
        router.refresh();
      } catch (err) {
        const classified = classifyTrustMutationError(err);
        if (classified.kind === "versionMismatch" || classified.kind === "stale") {
          setFeedback({ kind: "warning", message: `${classified.message} Refreshing…` });
          await load();
        } else if (classified.kind === "ineligible") {
          const blockers = classified.blockers.map(trustBlockerLabel).join("; ");
          setFeedback({ kind: "error", message: blockers ? `${classified.message}: ${blockers}` : classified.message });
          await load();
        } else {
          setFeedback({ kind: "error", message: classified.message });
        }
      } finally {
        setBusy(null);
      }
    },
    [load, router, sourceId],
  );

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-[var(--space-3)]" aria-busy="true">
        <span className="sr-only" role="status">
          Loading source trust snapshot
        </span>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[var(--space-7)] w-full" />
        ))}
      </div>
    );
  }

  if (state.status === "error") {
    return <TrustErrorState error={state.error} onRetry={() => void load()} />;
  }

  const { snapshot } = state;
  const { evidence, eligibility, policy } = snapshot;
  const badge = trustStatusBadge(policy.autoPublishTrusted);

  return (
    <div className="stack">
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <Badge variant={badge.variant}>{badge.label}</Badge>
        <span className="text-text-muted text-[length:var(--text-sm)]">definition v{snapshot.definitionVersion}</span>
        {hasOldItemFalsePositive(evidence) && (
          <Badge variant="danger">Old-item false positive</Badge>
        )}
      </div>

      <TrustFeedback feedback={feedback} />

      <MetricGrid>
        <Metric label="Sample size">{evidence.sampleSize}</Metric>
        <Metric label="Decided">{evidence.decidedCount}</Metric>
        <Metric label="Approval rate">{formatRate(evidence.approvalRate)}</Metric>
        <Metric label="Accepted into work">{evidence.acceptedCount}</Metric>
        <Metric label="Review-rejected">{evidence.reviewRejectedCount}</Metric>
        <Metric label="Old-item false positives">
          {evidence.oldItemFalsePositives}
          <span className="text-text-muted text-[length:var(--text-sm)]">
            {" "}
            ({formatRate(evidence.oldItemFalsePositiveRate)})
          </span>
        </Metric>
      </MetricGrid>

      <div className="stack">
        <h3 className="m-0 text-[length:var(--text-sm)] font-semibold text-text-muted uppercase tracking-wide">
          Drift evidence
        </h3>
        <MetricGrid>
          <Metric label="Zero-discovery streak">{evidence.drift.zeroDiscoveryStreak}</Metric>
          <Metric label="Consecutive failures">{evidence.drift.consecutiveFailures}</Metric>
          <Metric label="Volume anomaly">{volumeAnomalyLabel(evidence.drift.volumeAnomaly)}</Metric>
          <Metric label="Conflict rate">{formatRate(evidence.drift.conflictRate)}</Metric>
        </MetricGrid>
      </div>

      {!eligibility.eligible && eligibility.blockers.length > 0 && (
        <div
          role="status"
          className="flex flex-col gap-[var(--space-1)] rounded-[var(--radius-md)] border border-border bg-bg-subtle px-[var(--space-4)] py-[var(--space-3)]"
        >
          <strong className="text-[length:var(--text-sm)]">Promotion blocked</strong>
          <ul className="m-0 flex flex-col gap-[var(--space-1)] pl-[var(--space-4)] text-[length:var(--text-sm)] text-text-muted">
            {eligibility.blockers.map((blocker) => (
              <li key={blocker}>{trustBlockerLabel(blocker)}</li>
            ))}
          </ul>
        </div>
      )}

      {eligibility.warnings.length > 0 && (
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <span className="text-text-muted text-[length:var(--text-sm)]">Warnings:</span>
          {eligibility.warnings.map((warning) => (
            <Badge key={warning} variant="warning">
              {trustWarningLabel(warning)}
            </Badge>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <TrustActionButton
          action="promote"
          variant="primary"
          definitionVersion={snapshot.definitionVersion}
          onRun={run}
          busy={busy === "promote"}
          disabled={!canPromote(snapshot) || busy !== null}
          disabledHint={
            policy.autoPublishTrusted
              ? "Source is already trusted."
              : "Source does not meet the promotion bar — clear the blockers above first."
          }
        />
        <TrustActionButton
          action="demote"
          variant="danger"
          definitionVersion={snapshot.definitionVersion}
          onRun={run}
          busy={busy === "demote"}
          disabled={!canDemote(snapshot) || busy !== null}
          disabledHint={policy.autoPublishTrusted ? undefined : "Source is not currently trusted."}
        />
      </div>
    </div>
  );
}

function TrustFeedback({ feedback }: { feedback: Feedback }) {
  if (feedback.kind === "none") return null;
  const tone =
    feedback.kind === "success"
      ? "text-success-text"
      : feedback.kind === "warning"
        ? "text-warning-text"
        : "text-danger-text";
  return (
    <p
      role={feedback.kind === "error" ? "alert" : "status"}
      className={`m-0 text-[length:var(--text-sm)] ${tone}`}
    >
      {feedback.message}
    </p>
  );
}

function TrustErrorState({ error, onRetry }: { error: AdminFetchErrorState; onRetry: () => void }) {
  if (error.kind === "unauthorized") {
    return (
      <p role="alert" className="m-0 text-text-muted text-[length:var(--text-sm)]">
        Your session has expired — sign in again to view source trust.
      </p>
    );
  }
  if (error.kind === "forbidden") {
    return (
      <p role="alert" className="m-0 text-text-muted text-[length:var(--text-sm)]">
        You don&apos;t have access to view source trust. The <code>sources.manage</code> capability is required.
      </p>
    );
  }
  return (
    <div className="stack" role="alert">
      <p className="m-0 text-danger-text text-[length:var(--text-sm)]">
        {error.kind === "notFound" ? "Trust snapshot not found for this source." : error.message}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry} className="w-auto">
        Retry
      </Button>
    </div>
  );
}

interface TrustActionButtonProps {
  action: SourceTrustAction;
  variant: "primary" | "danger";
  definitionVersion: number;
  onRun: (action: SourceTrustAction, definitionVersion: number, reason: string) => void | Promise<void>;
  busy: boolean;
  disabled: boolean;
  disabledHint?: string;
}

/** Promote/demote control — always opens a reason Popover (audit-required). */
function TrustActionButton({
  action,
  variant,
  definitionVersion,
  onRun,
  busy,
  disabled,
  disabledHint,
}: TrustActionButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const anchorRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();

  const label = action === "promote" ? "Promote to trusted" : "Demote";
  const trimmed = reason.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= MAX_REASON;

  async function confirm() {
    if (!valid) return;
    await onRun(action, definitionVersion, trimmed);
    setOpen(false);
    setReason("");
  }

  return (
    <>
      <Button
        ref={anchorRef}
        variant={variant}
        size="sm"
        loading={busy}
        disabled={disabled}
        title={disabled ? disabledHint : undefined}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </Button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        align="start"
        label={`${label} — reason required`}
        initialFocusRef={reasonRef}
        className="w-[min(360px,90vw)] p-[var(--space-4)]"
      >
        <div className="flex flex-col gap-[var(--space-3)]">
          <Field
            label={`Reason to ${action}`}
            hint={`Recorded in the audit log with definition v${definitionVersion} (1–500 characters).`}
            required
          >
            <Textarea
              ref={reasonRef}
              id={fieldId}
              rows={3}
              maxLength={MAX_REASON}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={action === "promote" ? "Why is this source proven?" : "Why is trust being revoked?"}
            />
          </Field>
          <div className="flex justify-end gap-[var(--space-2)]">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant={variant} size="sm" loading={busy} disabled={!valid || busy} onClick={confirm}>
              Confirm {action}
            </Button>
          </div>
        </div>
      </Popover>
    </>
  );
}
