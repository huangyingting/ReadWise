"use client";

import { useCallback, useMemo, useState } from "react";

import { Badge, EmptyState } from "@/components/ui";
import { OffsetPagination, PanelErrorState, PanelSkeleton } from "@/components/admin/panel-states";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { useAdminQueue } from "@/components/admin/useAdminQueue";
import { Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { AdminTableWrap } from "@/components/admin";
import { postJson } from "@/lib/client-fetch";
import { formatDateTime } from "@/lib/display-format";
import ReviewActionButton from "./ReviewActionButton";
import CandidateDetailSheet from "./CandidateDetailSheet";
import {
  DEFAULT_REVIEW_LIMIT,
  MAX_REVIEW_BATCH,
  REVIEW_QUEUE_STATUSES,
  REVIEW_QUEUE_STATUS_LABELS,
  availableReviewActions,
  batchActionsForStatus,
  batchHasStale,
  blockedActionReason,
  candidateStatusBadge,
  classifyReviewMutationError,
  dateProvenanceLabel,
  describeBatchItem,
  describeSingleReview,
  summarizeBatch,
  REVIEW_ACTION_VARIANT,
  type BatchReviewResponse,
  type CandidateReviewAction,
  type ReviewCandidate,
  type ReviewCandidatePage,
  type ReviewQueueStatus,
  type SingleReviewResponse,
} from "@/lib/scraper/incremental/candidate-review-ui";

const DASH = "—";

const EMPTY_CANDIDATES: ReviewCandidate[] = [];

type Filters = {
  status: ReviewQueueStatus;
  providerKey: string;
  discoverySourceId: string;
  offset: number;
  limit: number;
};

type Feedback =
  | { kind: "none" }
  | { kind: "success"; message: string }
  | { kind: "stale"; message: string }
  | { kind: "error"; message: string }
  | { kind: "batch"; response: BatchReviewResponse };

export interface CandidateReviewQueueProps {
  initialStatus: ReviewQueueStatus;
  initialProviderKey: string;
  initialDiscoverySourceId: string;
  initialOffset: number;
  initialLimit: number;
}

function buildQuery(f: Filters): string {
  const params = new URLSearchParams();
  params.set("status", f.status);
  if (f.providerKey) params.set("providerKey", f.providerKey);
  if (f.discoverySourceId) params.set("discoverySourceId", f.discoverySourceId);
  params.set("offset", String(f.offset));
  params.set("limit", String(f.limit));
  return params.toString();
}

/**
 * Candidate review queue (#1100). Client island that fetches the sanitized
 * NEEDS_REVIEW / SKIPPED_REVIEW queue from `/api/admin/candidates`, filters +
 * paginates it, and lets an operator approve / reject / reactivate candidates
 * individually or as a bounded batch. Renders every required state: loading,
 * empty, unauthorized (401/403), generic error, stale-candidate (409), and
 * partial-batch. Shows ONLY sanitized provenance — never a URL or article body.
 */
export default function CandidateReviewQueue({
  initialStatus,
  initialProviderKey,
  initialDiscoverySourceId,
  initialOffset,
  initialLimit,
}: CandidateReviewQueueProps) {
  const [providerDraft, setProviderDraft] = useState(initialProviderKey);
  const [sourceDraft, setSourceDraft] = useState(initialDiscoverySourceId);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const clearSelection = useCallback(() => setSelected(new Set()), []);
  const { filters, data, load, applyFilters, goToOffset } = useAdminQueue<Filters, ReviewCandidatePage>({
    endpoint: "/api/admin/candidates",
    initialFilters: {
      status: initialStatus,
      providerKey: initialProviderKey,
      discoverySourceId: initialDiscoverySourceId,
      offset: initialOffset,
      limit: initialLimit || DEFAULT_REVIEW_LIMIT,
    },
    buildQuery,
    onLoaded: clearSelection,
  });
  const [feedback, setFeedback] = useState<Feedback>({ kind: "none" });
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const onStatusChange = (status: ReviewQueueStatus) => {
    setFeedback({ kind: "none" });
    applyFilters({ ...filters, status, offset: 0 });
  };

  const onSubmitFilters = (e: React.FormEvent) => {
    e.preventDefault();
    applyFilters({
      ...filters,
      providerKey: providerDraft.trim(),
      discoverySourceId: sourceDraft.trim(),
      offset: 0,
    });
  };

  // --- Mutations ----------------------------------------------------------

  const runSingle = useCallback(
    async (id: string, action: CandidateReviewAction, reason?: string) => {
      setRowBusy(id);
      setFeedback({ kind: "none" });
      try {
        const res = await postJson<SingleReviewResponse>(
          `/api/admin/candidates/${encodeURIComponent(id)}/review`,
          { action, reason },
        );
        setFeedback({ kind: "success", message: describeSingleReview(res) });
        await load(filters);
      } catch (err) {
        const classified = classifyReviewMutationError(err);
        if (classified.kind === "stale") {
          setFeedback({ kind: "stale", message: classified.message });
        } else {
          setFeedback({ kind: "error", message: classified.message });
        }
      } finally {
        setRowBusy(null);
      }
    },
    [filters, load],
  );

  const runBatch = useCallback(
    async (action: CandidateReviewAction, reason?: string) => {
      const ids = [...selected];
      if (ids.length === 0) return;
      setBatchBusy(true);
      setFeedback({ kind: "none" });
      try {
        const res = await postJson<BatchReviewResponse>(`/api/admin/candidates/review`, {
          action,
          ids,
          reason,
        });
        setFeedback({ kind: "batch", response: res });
        await load(filters);
      } catch (err) {
        const classified = classifyReviewMutationError(err);
        setFeedback({ kind: "error", message: classified.message });
      } finally {
        setBatchBusy(false);
      }
    },
    [filters, load, selected],
  );

  // --- Selection ----------------------------------------------------------

  const candidates = useMemo(
    () => (data.status === "ready" ? data.page.candidates : EMPTY_CANDIDATES),
    [data],
  );
  const selectableIds = useMemo(
    () => candidates.filter((c) => !c.hasArticle).map((c) => c.id).slice(0, MAX_REVIEW_BATCH),
    [candidates],
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_REVIEW_BATCH) next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected(() => (allSelected ? new Set() : new Set(selectableIds)));

  const mutating = rowBusy !== null || batchBusy;

  return (
    <div className="stack">
      <SegmentedControl<ReviewQueueStatus>
        label="Review status"
        value={filters.status}
        onChange={onStatusChange}
        options={REVIEW_QUEUE_STATUSES.map((s) => ({ value: s, label: REVIEW_QUEUE_STATUS_LABELS[s] }))}
      />

      <form method="get" onSubmit={onSubmitFilters} className="flex flex-wrap gap-[var(--space-2)] items-center">
        <Input
          type="search"
          name="providerKey"
          value={providerDraft}
          onChange={(e) => setProviderDraft(e.target.value)}
          placeholder="Provider key…"
          inputSize="sm"
          className="flex-[1_1_180px]"
          aria-label="Filter by provider key"
        />
        <Input
          type="search"
          name="discoverySourceId"
          value={sourceDraft}
          onChange={(e) => setSourceDraft(e.target.value)}
          placeholder="Discovery source id…"
          inputSize="sm"
          className="flex-[1_1_180px]"
          aria-label="Filter by discovery source id"
        />
        <Button type="submit" variant="primary" size="sm" className="w-auto">
          Filter
        </Button>
      </form>

      <FeedbackBanner feedback={feedback} onRefresh={() => void load(filters)} onDismiss={() => setFeedback({ kind: "none" })} />

      {data.status === "ready" && selected.size > 0 && (
        <BatchToolbar
          count={selected.size}
          status={filters.status}
          busy={batchBusy}
          onRun={runBatch}
          onClear={() => setSelected(new Set())}
        />
      )}

      {data.status === "loading" && <PanelSkeleton label="Loading review candidates" />}

      {data.status === "error" && (
        <PanelErrorState
          error={data.error}
          resourceLabel="review queue"
          capability="sources.manage"
          forbiddenAction="Reviewing crawl candidates"
          signInTo="review candidates"
          onRetry={() => void load(filters)}
        />
      )}

      {data.status === "ready" && (
        <>
          <p className="muted m-0" aria-live="polite">
            {data.page.total === 0
              ? "No candidates match."
              : `${data.page.total} candidate${data.page.total === 1 ? "" : "s"} · showing ${
                  data.page.offset + 1
                }–${Math.min(data.page.offset + data.page.limit, data.page.total)}`}
          </p>

          {data.page.candidates.length === 0 ? (
            <EmptyState
              title="Nothing to review"
              description={
                filters.status === "NEEDS_REVIEW"
                  ? "No candidates are awaiting an operator decision for these filters."
                  : "No rejected candidates match these filters."
              }
            />
          ) : (
            <CandidateTable
              candidates={data.page.candidates}
              selected={selected}
              selectableIds={selectableIds}
              allSelected={allSelected}
              rowBusy={rowBusy}
              mutating={mutating}
              onToggleOne={toggleOne}
              onToggleAll={toggleAll}
              onRun={runSingle}
              onOpenDetail={setDetailId}
            />
          )}

          <OffsetPagination
            offset={data.page.offset}
            limit={data.page.limit}
            total={data.page.total}
            onGoto={goToOffset}
          />
        </>
      )}

      <CandidateDetailSheet candidateId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FeedbackBanner({
  feedback,
  onRefresh,
  onDismiss,
}: {
  feedback: Feedback;
  onRefresh: () => void;
  onDismiss: () => void;
}) {
  if (feedback.kind === "none") return null;
  if (feedback.kind === "success") return <Notice tone="success">{feedback.message}</Notice>;
  if (feedback.kind === "error") return <Notice tone="danger">{feedback.message}</Notice>;

  const refreshButton = (
    <Button variant="outline" size="sm" onClick={onRefresh}>
      Refresh queue
    </Button>
  );
  if (feedback.kind === "stale") {
    return (
      <Notice tone="warning" action={refreshButton}>
        {feedback.message} The queue may be out of date.
      </Notice>
    );
  }

  // Partial-batch outcome.
  const { response } = feedback;
  return (
    <Notice
      tone="neutral"
      action={
        <>
          {batchHasStale(response) && refreshButton}
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Dismiss
          </Button>
        </>
      }
    >
      <strong className="text-text">{summarizeBatch(response)}</strong>
      <ul className="m-0 mt-[var(--space-2)] flex flex-col gap-[var(--space-1)] p-0 list-none">
        {response.results.map((item) => {
          const described = describeBatchItem(item);
          return (
            <li key={item.candidateId ?? Math.random()} className="flex items-center gap-[var(--space-2)]">
              <Badge variant={described.tone}>{described.label}</Badge>
              <code className="text-[length:var(--text-xs)] text-text-muted break-all">
                {item.candidateId ?? "—"}
              </code>
            </li>
          );
        })}
      </ul>
    </Notice>
  );
}

function BatchToolbar({
  count,
  status,
  busy,
  onRun,
  onClear,
}: {
  count: number;
  status: ReviewQueueStatus;
  busy: boolean;
  onRun: (action: CandidateReviewAction, reason?: string) => void | Promise<void>;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-[var(--space-3)] rounded-[var(--radius-md)] bg-bg-subtle px-[var(--space-4)] py-[var(--space-3)]">
      <span className="text-[length:var(--text-sm)] font-medium" aria-live="polite">
        {count} selected
      </span>
      <div className="flex flex-wrap gap-[var(--space-2)]">
        {batchActionsForStatus(status).map((action) => (
          <ReviewActionButton
            key={action}
            action={action}
            onRun={onRun}
            variant={REVIEW_ACTION_VARIANT[action]}
            busy={busy}
            count={count}
          />
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={onClear} disabled={busy}>
        Clear selection
      </Button>
    </div>
  );
}

function CandidateTable({
  candidates,
  selected,
  selectableIds,
  allSelected,
  rowBusy,
  mutating,
  onToggleOne,
  onToggleAll,
  onRun,
  onOpenDetail,
}: {
  candidates: ReviewCandidate[];
  selected: Set<string>;
  selectableIds: string[];
  allSelected: boolean;
  rowBusy: string | null;
  mutating: boolean;
  onToggleOne: (id: string) => void;
  onToggleAll: () => void;
  onRun: (id: string, action: CandidateReviewAction, reason?: string) => void | Promise<void>;
  onOpenDetail: (id: string) => void;
}) {
  return (
    <AdminTableWrap ariaLabel="Review candidates table (scrollable)">
      <thead>
        <tr>
          <th scope="col" className="w-[var(--space-8)]">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)] cursor-pointer"
              checked={allSelected}
              disabled={selectableIds.length === 0}
              onChange={onToggleAll}
              aria-label="Select all reviewable candidates on this page"
            />
          </th>
          <th scope="col">Status</th>
          <th scope="col">Provider</th>
          <th scope="col">Identity</th>
          <th scope="col">Observed</th>
          <th scope="col">Count</th>
          <th scope="col">Reason</th>
          <th scope="col">Date</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {candidates.map((candidate) => {
          const badge = candidateStatusBadge(candidate.status);
          const actions = availableReviewActions(candidate.status, candidate.hasArticle);
          const blocked = blockedActionReason(candidate);
          const isBusy = rowBusy === candidate.id;
          return (
            <tr key={candidate.id}>
              <td>
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)] cursor-pointer"
                  checked={selected.has(candidate.id)}
                  disabled={candidate.hasArticle}
                  onChange={() => onToggleOne(candidate.id)}
                  aria-label={`Select candidate ${candidate.id}`}
                />
              </td>
              <td>
                <div className="flex flex-col gap-[var(--space-1)]">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  {candidate.observedInBaseline && (
                    <span className="text-text-muted text-[length:var(--text-xs)]">baseline</span>
                  )}
                </div>
              </td>
              <td className="text-text-muted">{candidate.providerKey}</td>
              <td>
                <code className="text-[length:var(--text-xs)] break-all">{candidate.provisionalKey}</code>
                <div className="text-text-muted text-[length:var(--text-xs)]">v{candidate.identityVersion}</div>
              </td>
              <td className="text-text-muted text-[length:var(--text-sm)]">
                {formatDateTime(candidate.firstObservedAt)}
              </td>
              <td className="text-text-muted">{candidate.observationCount}</td>
              <td className="text-text-muted text-[length:var(--text-sm)]">{candidate.reviewReason ?? DASH}</td>
              <td className="text-text-muted text-[length:var(--text-sm)]">
                {dateProvenanceLabel(candidate.dateProvenance)}
              </td>
              <td>
                <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                  <Button variant="outline" size="sm" onClick={() => onOpenDetail(candidate.id)}>
                    Details
                  </Button>
                  {candidate.hasArticle && <Badge variant="danger">Linked article</Badge>}
                  {actions.map((action) => (
                    <ReviewActionButton
                      key={action}
                      action={action}
                      onRun={(a, reason) => onRun(candidate.id, a, reason)}
                      variant={REVIEW_ACTION_VARIANT[action]}
                      busy={isBusy}
                      disabled={mutating && !isBusy}
                    />
                  ))}
                  {actions.length === 0 && blocked && (
                    <span className="text-text-muted text-[length:var(--text-xs)]" title={blocked}>
                      No actions
                    </span>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </AdminTableWrap>
  );
}
