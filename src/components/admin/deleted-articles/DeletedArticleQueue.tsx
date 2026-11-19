"use client";

import { useCallback, useState } from "react";

import { Badge, EmptyState } from "@/components/ui";
import { OffsetPagination, PanelErrorState, PanelSkeleton } from "@/components/admin/panel-states";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { useAdminQueue } from "@/components/admin/useAdminQueue";
import { Input } from "@/components/ui/Input";
import { AdminTableWrap } from "@/components/admin";
import { postJson } from "@/lib/client-fetch";
import { formatDateTime } from "@/lib/display-format";
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
  const { filters, data, load, applyFilters, goToOffset } = useAdminQueue<Filters, DeletedCandidatePage>({
    endpoint: "/api/admin/deleted-articles",
    initialFilters: {
      providerKey: initialProviderKey,
      offset: initialOffset,
      limit: initialLimit || DEFAULT_DELETED_LIMIT,
    },
    buildQuery,
  });
  const [providerDraft, setProviderDraft] = useState(initialProviderKey);

  const [feedback, setFeedback] = useState<Feedback>({ kind: "none" });
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const onSubmitFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback({ kind: "none" });
    applyFilters({ ...filters, providerKey: providerDraft.trim(), offset: 0 });
  };

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
          inputSize="sm"
          className="flex-[1_1_180px]"
          aria-label="Filter by provider key"
        />
        <Button type="submit" variant="primary" size="sm" className="w-auto">
          Filter
        </Button>
      </form>

      <FeedbackBanner
        feedback={feedback}
        onRefresh={() => void load(filters)}
        onDismiss={() => setFeedback({ kind: "none" })}
      />

      {data.status === "loading" && <PanelSkeleton label="Loading deleted article identities" />}

      {data.status === "error" && (
        <PanelErrorState
          error={data.error}
          resourceLabel="recovery queue"
          capability="sources.manage"
          forbiddenAction="Recovering deleted article identities"
          signInTo="recover deleted identities"
          onRetry={() => void load(filters)}
        />
      )}

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

          <OffsetPagination
            offset={data.page.offset}
            limit={data.page.limit}
            total={data.page.total}
            onGoto={goToOffset}
          />
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
      <Notice
        tone="success"
        action={
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Dismiss
          </Button>
        }
      >
        {feedback.message}
      </Notice>
    );
  }
  if (feedback.kind === "refresh") {
    return (
      <Notice
        tone="warning"
        action={
          <Button variant="outline" size="sm" onClick={onRefresh}>
            Refresh queue
          </Button>
        }
      >
        {feedback.message} The queue may be out of date.
      </Notice>
    );
  }
  return <Notice tone="danger">{feedback.message}</Notice>;
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
