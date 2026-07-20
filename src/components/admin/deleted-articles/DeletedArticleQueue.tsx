"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { Badge, EmptyState, Skeleton } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AdminTableWrap } from "@/components/admin";
import { getJson, postJson } from "@/lib/client-fetch";
import { formatDateTime } from "@/lib/display-format";
import { classifyAdminFetchError, type AdminFetchErrorState } from "@/lib/admin/admin-fetch-state";
import DeletedRecoverButton from "./DeletedRecoverButton";
import {
  DEFAULT_DELETED_LIMIT,
  classifyRecoverError,
  deletedCandidateBadge,
  describeRecoverOutcome,
  terminalReasonLabel,
  type DeletedCandidate,
  type DeletedCandidatePage,
  type RecoverResponse,
} from "@/lib/scraper/incremental/deleted-article-ui";

const DASH = "—";

type Filters = {
  providerKey: string;
  offset: number;
  limit: number;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: AdminFetchErrorState }
  | { status: "ready"; page: DeletedCandidatePage };

type Feedback =
  | { kind: "none" }
  | { kind: "success"; message: string }
  | { kind: "refresh"; message: string }
  | { kind: "error"; message: string };

export interface DeletedArticleQueueProps {
  initialProviderKey: string;
  initialOffset: number;
  initialLimit: number;
}

function buildQuery(f: Filters): string {
  const params = new URLSearchParams();
  if (f.providerKey) params.set("providerKey", f.providerKey);
  params.set("offset", String(f.offset));
  params.set("limit", String(f.limit));
  return params.toString();
}

/**
 * Deleted-identity recovery queue (#1104, AC2). Client island that fetches the
 * sanitized queue of governance-deleted identities from `/api/admin/deleted-articles`,
 * filters + paginates it, and lets an operator explicitly RE-ADMIT one for
 * re-ingestion (required audit reason + explicit confirm). Renders every required
 * state: loading, empty, unauthorized (401/403), generic error, and concurrent-
 * change (409 → refresh & retry). Shows ONLY sanitized identity — never a URL or
 * article body (a deleted article's content is permanently gone).
 */
export default function DeletedArticleQueue({
  initialProviderKey,
  initialOffset,
  initialLimit,
}: DeletedArticleQueueProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [filters, setFilters] = useState<Filters>({
    providerKey: initialProviderKey,
    offset: initialOffset,
    limit: initialLimit || DEFAULT_DELETED_LIMIT,
  });
  const [providerDraft, setProviderDraft] = useState(initialProviderKey);

  const [data, setData] = useState<LoadState>({ status: "loading" });
  const [feedback, setFeedback] = useState<Feedback>({ kind: "none" });
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const load = useCallback(async (f: Filters) => {
    setData({ status: "loading" });
    try {
      const page = await getJson<DeletedCandidatePage>(`/api/admin/deleted-articles?${buildQuery(f)}`);
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

  const onSubmitFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback({ kind: "none" });
    applyFilters({ ...filters, providerKey: providerDraft.trim(), offset: 0 });
  };

  const goToOffset = (offset: number) => applyFilters({ ...filters, offset });

  const runRecover = useCallback(
    async (id: string, reason: string) => {
      setRowBusy(id);
      setFeedback({ kind: "none" });
      try {
        const res = await postJson<RecoverResponse>(
          `/api/admin/deleted-articles/${encodeURIComponent(id)}/recover`,
          { reason, confirm: true },
        );
        setFeedback({ kind: "success", message: describeRecoverOutcome(res) });
        await load(filters);
      } catch (err) {
        const classified = classifyRecoverError(err);
        if (classified.kind === "conflict") {
          setFeedback({ kind: "refresh", message: classified.message });
        } else {
          setFeedback({ kind: "error", message: classified.message });
        }
      } finally {
        setRowBusy(null);
      }
    },
    [filters, load],
  );

  return (
    <div className="stack">
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

      <FeedbackBanner
        feedback={feedback}
        onRefresh={() => void load(filters)}
        onDismiss={() => setFeedback({ kind: "none" })}
      />

      {data.status === "loading" && <QueueSkeleton />}

      {data.status === "error" && <QueueErrorState error={data.error} onRetry={() => void load(filters)} />}

      {data.status === "ready" && (
        <>
          <p className="muted m-0" aria-live="polite">
            {data.page.total === 0
              ? "No deleted identities match."
              : `${data.page.total} deleted ${data.page.total === 1 ? "identity" : "identities"} · showing ${
                  data.page.offset + 1
                }–${Math.min(data.page.offset + data.page.limit, data.page.total)}`}
          </p>

          {data.page.candidates.length === 0 ? (
            <EmptyState
              title="Nothing to recover"
              description="No governance-deleted article identities match these filters."
            />
          ) : (
            <DeletedTable
              candidates={data.page.candidates}
              rowBusy={rowBusy}
              mutating={rowBusy !== null}
              onRecover={runRecover}
            />
          )}

          <QueuePagination page={data.page} onGoto={goToOffset} />
        </>
      )}
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
        className="flex flex-wrap items-center justify-between gap-[var(--space-3)] rounded-[var(--radius-md)] border border-border bg-bg-subtle px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-sm)] text-success-text"
      >
        <span>{feedback.message}</span>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    );
  }

  if (feedback.kind === "refresh") {
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

  return (
    <div
      role="alert"
      className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-sm)] text-danger-text"
    >
      {feedback.message}
    </div>
  );
}

function DeletedTable({
  candidates,
  rowBusy,
  mutating,
  onRecover,
}: {
  candidates: DeletedCandidate[];
  rowBusy: string | null;
  mutating: boolean;
  onRecover: (id: string, reason: string) => void | Promise<void>;
}) {
  return (
    <AdminTableWrap ariaLabel="Deleted article identities table (scrollable)">
      <thead>
        <tr>
          <th scope="col">Status</th>
          <th scope="col">Provider</th>
          <th scope="col">Identity</th>
          <th scope="col">Deleted</th>
          <th scope="col">Count</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {candidates.map((candidate) => {
          const badge = deletedCandidateBadge(candidate.terminalReason);
          const isBusy = rowBusy === candidate.id;
          return (
            <tr key={candidate.id}>
              <td>
                <div className="flex flex-col gap-[var(--space-1)]">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  <span className="text-text-muted text-[length:var(--text-xs)]">
                    {terminalReasonLabel(candidate.terminalReason)}
                  </span>
                </div>
              </td>
              <td className="text-text-muted">{candidate.providerKey}</td>
              <td>
                <code className="text-[length:var(--text-xs)] break-all">{candidate.provisionalKey}</code>
                <div className="text-text-muted text-[length:var(--text-xs)]">v{candidate.identityVersion}</div>
              </td>
              <td className="text-text-muted text-[length:var(--text-sm)]">
                {candidate.articleDeletedAt ? formatDateTime(candidate.articleDeletedAt) : DASH}
              </td>
              <td className="text-text-muted">{candidate.observationCount}</td>
              <td>
                <DeletedRecoverButton
                  onRun={(reason) => onRecover(candidate.id, reason)}
                  busy={isBusy}
                  disabled={mutating && !isBusy}
                />
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
  page: DeletedCandidatePage;
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
        Loading deleted article identities
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
        description="Recovering deleted article identities requires the sources.manage capability. Ask an administrator to grant access."
      />
    );
  }
  if (error.kind === "unauthorized") {
    return (
      <EmptyState
        title="Please sign in"
        description="Your session has expired. Sign in again to recover deleted identities."
        action={{ label: "Sign in", href: "/signin" }}
      />
    );
  }
  return (
    <div className="stack" role="alert">
      <p className="m-0 text-danger-text text-[length:var(--text-sm)]">
        {error.kind === "notFound" ? "The recovery queue could not be found." : error.message}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry} className="w-auto">
        Retry
      </Button>
    </div>
  );
}
