"use client";

import { Badge } from "@/components/ui";
import { AdminDetailSheet, DetailRow, useAdminDetail } from "@/components/admin/AdminDetailSheet";
import { getJson } from "@/lib/client-fetch";
import { formatDateTime } from "@/lib/display-format";
import {
  candidateStatusBadge,
  conflictStatusBadge,
  dateProvenanceLabel,
  type ReviewCandidateDetail,
} from "@/lib/scraper/incremental/candidate-review-ui";

const DASH = "—";

interface CandidateDetailSheetProps {
  candidateId: string | null;
  onClose: () => void;
}

async function fetchCandidateDetail(id: string): Promise<ReviewCandidateDetail> {
  const body = await getJson<{ candidate: ReviewCandidateDetail }>(`/api/admin/candidates/${encodeURIComponent(id)}`);
  return body.candidate;
}

/**
 * Read-only detail drawer for one review candidate (#1100). Fetches the sanitized
 * detail DTO (provenance + canonical-conflict history) from
 * `/api/admin/candidates/{id}` and renders loading / error / ready states. Shows
 * only sanitized metadata — never a URL, body, secret, or article content.
 */
export default function CandidateDetailSheet({ candidateId, onClose }: CandidateDetailSheetProps) {
  const { state, reload } = useAdminDetail(candidateId, fetchCandidateDetail);
  return (
    <AdminDetailSheet
      open={candidateId !== null}
      onClose={onClose}
      label="Candidate details"
      title="Candidate details"
      noun="candidate"
      state={state}
      onRetry={reload}
    >
      {(detail) => <CandidateDetailBody detail={detail} />}
    </AdminDetailSheet>
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
                  className="flex flex-col gap-[var(--space-1)] rounded-[var(--radius-md)] bg-bg-subtle px-[var(--space-3)] py-[var(--space-2)]"
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
