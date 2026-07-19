"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { Badge, EmptyState, Skeleton } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { AdminTableWrap } from "@/components/admin";
import { getJson, postJson } from "@/lib/client-fetch";
import { formatDateTime } from "@/lib/display-format";
import { classifyAdminFetchError, type AdminFetchErrorState } from "@/lib/admin/admin-fetch-state";
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

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: AdminFetchErrorState }
  | { status: "ready"; page: ReviewCandidatePage };

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
  const router = useRouter();
  const pathname = usePathname();

  const [filters, setFilters] = useState<Filters>({
    status: initialStatus,
    providerKey: initialProviderKey,
    discoverySourceId: initialDiscoverySourceId,
    offset: initialOffset,
    limit: initialLimit || DEFAULT_REVIEW_LIMIT,
  });
  const [providerDraft, setProviderDraft] = useState(initialProviderKey);
  const [sourceDraft, setSourceDraft] = useState(initialDiscoverySourceId);

  const [data, setData] = useState<LoadState>({ status: "loading" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<Feedback>({ kind: "none" });
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async (f: Filters) => {
    setData({ status: "loading" });
    try {
      const page = await getJson<ReviewCandidatePage>(`/api/admin/candidates?${buildQuery(f)}`);
      setData({ status: "ready", page });
      setSelected(new Set());
    } catch (err) {
      setData({ status: "error", error: classifyAdminFetchError(err) });
    }
  }, []);

  useEffect(() => {
    void load(filters);
  }, [filters, load]);

  const applyFilters = useCallback(
    (next: Filters) => {
      setFilters(next);
      router.replace(`${pathname}?${buildQuery(next)}`, { scroll: false });
    },
    [pathname, router],
  );

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

  const goToOffset = (offset: number) => applyFilters({ ...filters, offset });

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
          inputSize="md"
          className="flex-[1_1_180px]"
          aria-label="Filter by provider key"
        />
        <Input
          type="search"
          name="discoverySourceId"
          value={sourceDraft}
          onChange={(e) => setSourceDraft(e.target.value)}
          placeholder="Discovery source id…"
          inputSize="md"
          className="flex-[1_1_180px]"
          aria-label="Filter by discovery source id"
        />
        <Button type="submit" variant="primary" size="md" className="w-auto">
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

      {data.status === "loading" && <QueueSkeleton />}

      {data.status === "error" && (
        <QueueErrorState error={data.error} onRetry={() => void load(filters)} />
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

          <QueuePagination page={data.page} onGoto={goToOffset} />
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

  if (feedback.kind === "success") {
    return (
      <div
        role="status"
        className="rounded-[var(--radius-md)] border border-border bg-bg-subtle px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-sm)] text-success-text"
      >
        {feedback.message}
      </div>
    );
  }

  if (feedback.kind === "error") {
    return (
      <div
        role="alert"
        className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-sm)] text-danger-text"
      >
        {feedback.message}
      </div>
    );
  }

  if (feedback.kind === "stale") {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--warning)_34%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-sm)] text-warning-text"
      >
        <span>{feedback.message} The queue may be out of date.</span>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          Refresh queue
        </Button>
      </div>
    );
  }

  // Partial-batch outcome.
  const { response } = feedback;
  const stale = batchHasStale(response);
  return (
    <div
      role="status"
      className="flex flex-col gap-[var(--space-2)] rounded-[var(--radius-md)] border border-border bg-bg-subtle px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-sm)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
        <strong>{summarizeBatch(response)}</strong>
        <div className="flex gap-[var(--space-2)]">
          {stale && (
            <Button variant="outline" size="sm" onClick={onRefresh}>
              Refresh queue
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>
      <ul className="m-0 flex flex-col gap-[var(--space-1)] p-0 list-none">
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
    </div>
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
    <div className="flex flex-wrap items-center gap-[var(--space-3)] rounded-[var(--radius-md)] border border-border bg-surface px-[var(--space-4)] py-[var(--space-3)]">
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

function QueuePagination({
  page,
  onGoto,
}: {
  page: ReviewCandidatePage;
  onGoto: (offset: number) => void;
}) {
  const hasPrev = page.offset > 0;
  const hasNext = page.offset + page.limit < page.total;
  if (!hasPrev && !hasNext) return null;
  const current = Math.floor(page.offset / page.limit) + 1;
  const totalPages = Math.max(1, Math.ceil(page.total / page.limit));
  return (
    <div className="admin-pagination">
      <Button
        variant="outline"
        size="sm"
        disabled={!hasPrev}
        onClick={() => onGoto(Math.max(0, page.offset - page.limit))}
      >
        ← Previous
      </Button>
      <span className="muted">
        Page {current} of {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={!hasNext}
        onClick={() => onGoto(page.offset + page.limit)}
      >
        Next →
      </Button>
    </div>
  );
}

function QueueSkeleton() {
  return (
    <div className="flex flex-col gap-[var(--space-2)]" aria-busy="true">
      <span className="sr-only" role="status">
        Loading review candidates
      </span>
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-[var(--space-8)] w-full" />
      ))}
    </div>
  );
}

function QueueErrorState({
  error,
  onRetry,
}: {
  error: AdminFetchErrorState;
  onRetry: () => void;
}) {
  if (error.kind === "forbidden") {
    return (
      <EmptyState
        title="You don't have access"
        description="Reviewing crawl candidates requires the sources.manage capability. Ask an administrator to grant access."
      />
    );
  }
  if (error.kind === "unauthorized") {
    return (
      <EmptyState
        title="Please sign in"
        description="Your session has expired. Sign in again to review candidates."
        action={{ label: "Sign in", href: "/signin" }}
      />
    );
  }
  return (
    <div className="stack" role="alert">
      <p className="m-0 text-danger-text text-[length:var(--text-sm)]">
        {error.kind === "notFound" ? "The review queue could not be found." : error.message}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry} className="w-auto">
        Retry
      </Button>
    </div>
  );
}
