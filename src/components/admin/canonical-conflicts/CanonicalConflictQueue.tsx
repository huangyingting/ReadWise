"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { Badge, EmptyState, Skeleton } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { AdminTableWrap } from "@/components/admin";
import { getJson } from "@/lib/client-fetch";
import { formatDateTime } from "@/lib/display-format";
import { classifyAdminFetchError, type AdminFetchErrorState } from "@/lib/admin/admin-fetch-state";
import ConflictDetailSheet from "./ConflictDetailSheet";
import {
  CONFLICT_STATUSES,
  CONFLICT_STATUS_LABELS,
  DEFAULT_CONFLICT_LIMIT,
  conflictStatusBadge,
  summarizeDependentData,
  totalDependentData,
  type CanonicalConflict,
  type CanonicalConflictPage,
  type ConflictStatus,
} from "@/lib/scraper/incremental/canonical-conflict-ui";

const DASH = "—";

type Filters = {
  status: ConflictStatus;
  providerKey: string;
  offset: number;
  limit: number;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: AdminFetchErrorState }
  | { status: "ready"; page: CanonicalConflictPage };

type Feedback =
  | { kind: "none" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export interface CanonicalConflictQueueProps {
  initialStatus: ConflictStatus;
  initialProviderKey: string;
  initialOffset: number;
  initialLimit: number;
}

function buildQuery(f: Filters): string {
  const params = new URLSearchParams();
  params.set("status", f.status);
  if (f.providerKey) params.set("providerKey", f.providerKey);
  params.set("offset", String(f.offset));
  params.set("limit", String(f.limit));
  return params.toString();
}

/**
 * Canonical conflict queue (#1104, AC1). Client island that fetches the sanitized
 * OPEN / RESOLVED / DISMISSED conflict queue from `/api/admin/canonical-conflicts`,
 * filters + paginates it, and opens a detail drawer where an operator selects the
 * surviving public Article and resolves the conflict (required audit reason +
 * explicit confirm). Renders every required state: loading, empty, unauthorized
 * (401/403), and generic error; stale (409) + bad-selection (400) are surfaced in
 * the drawer. Shows ONLY sanitized identity + dependent-data COUNTS — never a URL
 * or article body.
 */
export default function CanonicalConflictQueue({
  initialStatus,
  initialProviderKey,
  initialOffset,
  initialLimit,
}: CanonicalConflictQueueProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [filters, setFilters] = useState<Filters>({
    status: initialStatus,
    providerKey: initialProviderKey,
    offset: initialOffset,
    limit: initialLimit || DEFAULT_CONFLICT_LIMIT,
  });
  const [providerDraft, setProviderDraft] = useState(initialProviderKey);

  const [data, setData] = useState<LoadState>({ status: "loading" });
  const [feedback, setFeedback] = useState<Feedback>({ kind: "none" });
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async (f: Filters) => {
    setData({ status: "loading" });
    try {
      const page = await getJson<CanonicalConflictPage>(`/api/admin/canonical-conflicts?${buildQuery(f)}`);
      setData({ status: "ready", page });
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

  const onStatusChange = (status: ConflictStatus) => {
    setFeedback({ kind: "none" });
    applyFilters({ ...filters, status, offset: 0 });
  };

  const onSubmitFilters = (e: React.FormEvent) => {
    e.preventDefault();
    applyFilters({ ...filters, providerKey: providerDraft.trim(), offset: 0 });
  };

  const goToOffset = (offset: number) => applyFilters({ ...filters, offset });

  const onResolved = useCallback(
    (message: string) => {
      setDetailId(null);
      setFeedback({ kind: "success", message });
      void load(filters);
    },
    [filters, load],
  );

  return (
    <div className="stack">
      <SegmentedControl<ConflictStatus>
        label="Conflict status"
        value={filters.status}
        onChange={onStatusChange}
        options={CONFLICT_STATUSES.map((s) => ({ value: s, label: CONFLICT_STATUS_LABELS[s] }))}
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
        <Button type="submit" variant="primary" size="md" className="w-auto">
          Filter
        </Button>
      </form>

      <FeedbackBanner feedback={feedback} onDismiss={() => setFeedback({ kind: "none" })} />

      {data.status === "loading" && <QueueSkeleton />}

      {data.status === "error" && <QueueErrorState error={data.error} onRetry={() => void load(filters)} />}

      {data.status === "ready" && (
        <>
          <p className="muted m-0" aria-live="polite">
            {data.page.total === 0
              ? "No conflicts match."
              : `${data.page.total} conflict${data.page.total === 1 ? "" : "s"} · showing ${
                  data.page.offset + 1
                }–${Math.min(data.page.offset + data.page.limit, data.page.total)}`}
          </p>

          {data.page.conflicts.length === 0 ? (
            <EmptyState
              title="No conflicts"
              description={
                filters.status === "OPEN"
                  ? "No open canonical conflicts match these filters."
                  : `No ${filters.status.toLowerCase()} conflicts match these filters.`
              }
            />
          ) : (
            <ConflictTable conflicts={data.page.conflicts} onOpenDetail={setDetailId} />
          )}

          <QueuePagination page={data.page} onGoto={goToOffset} />
        </>
      )}

      <ConflictDetailSheet conflictId={detailId} onClose={() => setDetailId(null)} onResolved={onResolved} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FeedbackBanner({ feedback, onDismiss }: { feedback: Feedback; onDismiss: () => void }) {
  if (feedback.kind === "none") return null;

  if (feedback.kind === "success") {
    return (
      <div
        role="status"
        className="flex flex-wrap items-center justify-between gap-[var(--space-3)] rounded-[var(--radius-md)] border border-border bg-bg-subtle px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-sm)] text-success-text"
      >
        <span>{feedback.message}</span>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-sm)] text-danger-text"
    >
      {feedback.message}
    </div>
  );
}

function ConflictTable({
  conflicts,
  onOpenDetail,
}: {
  conflicts: CanonicalConflict[];
  onOpenDetail: (id: string) => void;
}) {
  return (
    <AdminTableWrap ariaLabel="Canonical conflicts table (scrollable)">
      <thead>
        <tr>
          <th scope="col">Status</th>
          <th scope="col">Provider</th>
          <th scope="col">Identity</th>
          <th scope="col">Reason</th>
          <th scope="col">Reader data</th>
          <th scope="col">Detected</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {conflicts.map((conflict) => {
          const badge = conflictStatusBadge(conflict.status);
          const total = totalDependentData(conflict.dependentData);
          const isOpen = conflict.status === "OPEN";
          return (
            <tr key={conflict.id}>
              <td>
                <div className="flex flex-col gap-[var(--space-1)]">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  <span className="text-text-muted text-[length:var(--text-xs)]">
                    {conflict.conflictingArticleIds.length} article
                    {conflict.conflictingArticleIds.length === 1 ? "" : "s"}
                  </span>
                </div>
              </td>
              <td className="text-text-muted">{conflict.providerKey}</td>
              <td>
                <code className="text-[length:var(--text-xs)] break-all">{conflict.canonicalKey}</code>
                <div className="text-text-muted text-[length:var(--text-xs)]">v{conflict.identityVersion}</div>
              </td>
              <td className="text-text-muted text-[length:var(--text-sm)]">{conflict.reason ?? DASH}</td>
              <td className="text-text-muted text-[length:var(--text-sm)]">
                {total === 0 ? "None" : summarizeDependentData(conflict.dependentData)}
              </td>
              <td className="text-text-muted text-[length:var(--text-sm)]">
                {formatDateTime(conflict.detectedAt)}
              </td>
              <td>
                <Button
                  variant={isOpen ? "primary" : "outline"}
                  size="sm"
                  onClick={() => onOpenDetail(conflict.id)}
                >
                  {isOpen ? "Review & resolve" : "Details"}
                </Button>
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
  page: CanonicalConflictPage;
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
        Loading canonical conflicts
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
        description="Resolving canonical conflicts requires the sources.manage capability. Ask an administrator to grant access."
      />
    );
  }
  if (error.kind === "unauthorized") {
    return (
      <EmptyState
        title="Please sign in"
        description="Your session has expired. Sign in again to resolve conflicts."
        action={{ label: "Sign in", href: "/signin" }}
      />
    );
  }
  return (
    <div className="stack" role="alert">
      <p className="m-0 text-danger-text text-[length:var(--text-sm)]">
        {error.kind === "notFound" ? "The conflict queue could not be found." : error.message}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry} className="w-auto">
        Retry
      </Button>
    </div>
  );
}
