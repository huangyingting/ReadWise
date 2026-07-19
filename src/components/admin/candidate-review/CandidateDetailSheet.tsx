"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge, Skeleton, Spinner } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { getJson } from "@/lib/client-fetch";
import { formatDateTime } from "@/lib/display-format";
import { classifyAdminFetchError, type AdminFetchErrorState } from "@/lib/admin/admin-fetch-state";
import {
  candidateStatusBadge,
  conflictStatusBadge,
  dateProvenanceLabel,
  type ReviewCandidateDetail,
} from "@/lib/scraper/incremental/candidate-review-ui";

const DASH = "—";

type DetailState =
  | { status: "loading" }
  | { status: "error"; error: AdminFetchErrorState }
  | { status: "ready"; detail: ReviewCandidateDetail };

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      <dt className="text-text-muted text-[length:var(--text-xs)]">{label}</dt>
      <dd className="m-0 text-[length:var(--text-sm)] break-words">{children}</dd>
    </div>
  );
}

interface CandidateDetailSheetProps {
  candidateId: string | null;
  onClose: () => void;
}

/**
 * Read-only detail drawer for one review candidate (#1100). Fetches the sanitized
 * detail DTO (provenance + canonical-conflict history) from
 * `/api/admin/candidates/{id}` and renders loading / error / ready states. Shows
 * only sanitized metadata — never a URL, body, secret, or article content.
 */
export default function CandidateDetailSheet({ candidateId, onClose }: CandidateDetailSheetProps) {
  const [state, setState] = useState<DetailState>({ status: "loading" });

  const load = useCallback(async (id: string) => {
    setState({ status: "loading" });
    try {
      const body = await getJson<{ candidate: ReviewCandidateDetail }>(
        `/api/admin/candidates/${encodeURIComponent(id)}`,
      );
      setState({ status: "ready", detail: body.candidate });
    } catch (err) {
      setState({ status: "error", error: classifyAdminFetchError(err) });
    }
  }, []);

  useEffect(() => {
    if (candidateId) void load(candidateId);
  }, [candidateId, load]);

  return (
    <Sheet open={candidateId !== null} onClose={onClose} side="right" label="Candidate details">
      <div className="flex items-center justify-between gap-[var(--space-3)] border-b border-border px-[var(--space-5)] py-[var(--space-4)]">
        <h2 className="m-0 text-[length:var(--text-lg)] font-[family-name:var(--font-display)] font-semibold">
          Candidate details
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close details">
          Close
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-[var(--space-5)] py-[var(--space-4)]">
        {state.status === "loading" && (
          <div className="flex flex-col gap-[var(--space-3)]" aria-busy="true">
            <span className="sr-only" role="status">
              <Spinner size="sm" /> Loading candidate details
            </span>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[var(--space-6)] w-full" />
            ))}
          </div>
        )}

        {state.status === "error" && (
          <div className="flex flex-col gap-[var(--space-3)]">
            <p role="alert" className="m-0 text-danger-text text-[length:var(--text-sm)]">
              {state.error.kind === "forbidden"
                ? "You don't have access to view this candidate."
                : state.error.kind === "notFound"
                  ? "This candidate no longer exists."
                  : "Couldn't load candidate details."}
            </p>
            {candidateId && state.error.kind !== "forbidden" && (
              <Button variant="outline" size="sm" onClick={() => void load(candidateId)}>
                Retry
              </Button>
            )}
          </div>
        )}

        {state.status === "ready" && <CandidateDetailBody detail={state.detail} />}
      </div>
    </Sheet>
  );
}

function CandidateDetailBody({ detail }: { detail: ReviewCandidateDetail }) {
  const badge = candidateStatusBadge(detail.status);
  return (
    <div className="flex flex-col gap-[var(--space-5)]">
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <Badge variant={badge.variant}>{badge.label}</Badge>
        {detail.observedInBaseline && <Badge variant="neutral">Baseline</Badge>}
        {detail.hasArticle && <Badge variant="danger">Linked article</Badge>}
      </div>

      <dl className="grid grid-cols-2 gap-[var(--space-4)] m-0">
        <DetailRow label="Provider">{detail.providerKey}</DetailRow>
        <DetailRow label="Discovery source">{detail.discoverySourceId ?? DASH}</DetailRow>
        <DetailRow label="Identity version">v{detail.identityVersion}</DetailRow>
        <DetailRow label="Date provenance">{dateProvenanceLabel(detail.dateProvenance)}</DetailRow>
        <DetailRow label="Provisional key">
          <code className="text-[length:var(--text-xs)] break-all">{detail.provisionalKey}</code>
        </DetailRow>
        <DetailRow label="Canonical key">
          {detail.canonicalKey ? (
            <code className="text-[length:var(--text-xs)] break-all">{detail.canonicalKey}</code>
          ) : (
            DASH
          )}
        </DetailRow>
        <DetailRow label="First observed">{formatDateTime(detail.firstObservedAt)}</DetailRow>
        <DetailRow label="Last observed">{formatDateTime(detail.lastObservedAt)}</DetailRow>
        <DetailRow label="Observation count">{detail.observationCount}</DetailRow>
        <DetailRow label="Ingest attempts">{detail.ingestAttemptCount}</DetailRow>
        <DetailRow label="Review reason">{detail.reviewReason ?? DASH}</DetailRow>
        <DetailRow label="Last failure">{detail.lastFailureReason ?? DASH}</DetailRow>
        <DetailRow label="Trusted published">
          {detail.trustedPublishedAt ? formatDateTime(detail.trustedPublishedAt) : DASH}
        </DetailRow>
        <DetailRow label="Terminal at">
          {detail.terminalAt ? formatDateTime(detail.terminalAt) : DASH}
        </DetailRow>
      </dl>

      <section className="flex flex-col gap-[var(--space-2)]">
        <h3 className="m-0 text-[length:var(--text-sm)] font-semibold">
          Canonical conflicts ({detail.conflicts.length})
        </h3>
        {detail.conflicts.length === 0 ? (
          <p className="m-0 text-text-muted text-[length:var(--text-sm)]">No conflicts recorded.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0">
            {detail.conflicts.map((conflict) => {
              const cBadge = conflictStatusBadge(conflict.status);
              return (
                <li
                  key={conflict.id}
                  className="flex flex-col gap-[var(--space-1)] rounded-[var(--radius-md)] border border-border bg-bg-subtle px-[var(--space-3)] py-[var(--space-2)]"
                >
                  <div className="flex items-center justify-between gap-[var(--space-2)]">
                    <Badge variant={cBadge.variant}>{cBadge.label}</Badge>
                    <span className="text-text-muted text-[length:var(--text-xs)]">
                      {formatDateTime(conflict.detectedAt)}
                    </span>
                  </div>
                  <span className="text-[length:var(--text-sm)]">{conflict.reason ?? "Reason not recorded"}</span>
                  {conflict.resolvedAt && (
                    <span className="text-text-muted text-[length:var(--text-xs)]">
                      Resolved {formatDateTime(conflict.resolvedAt)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
