"use client";

import { EmptyState, Skeleton } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import type { AdminFetchErrorState } from "@/lib/admin/admin-fetch-state";

/**
 * Shared loading / error / pagination states for admin client panels and
 * review queues (security, candidate review, canonical conflicts, deleted
 * articles). Each renders the same deny-by-default fetch states (forbidden /
 * unauthorized / not found / generic) and the same prev/next pager.
 * Composed only from `@/components/ui` primitives; token-driven.
 */

/** A bounded skeleton placeholder while a panel's data loads. */
export function PanelSkeleton({ label, rows = 6 }: { label: string; rows?: number }) {
  return (
    <div className="flex flex-col gap-[var(--space-2)]" aria-busy="true">
      <span className="sr-only" role="status">
        {label}
      </span>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-[var(--space-8)] w-full" />
      ))}
    </div>
  );
}

/**
 * Renders the deny-by-default and generic fetch-error states for a
 * capability-gated admin resource. `resourceLabel` names the resource in the
 * not-found copy ("The audit log could not be found."); `forbiddenAction`
 * defaults to "Viewing the {resourceLabel}" and `signInTo` to "continue".
 */
export function PanelErrorState({
  error,
  resourceLabel,
  capability,
  forbiddenAction = `Viewing the ${resourceLabel}`,
  signInTo = "continue",
  onRetry,
}: {
  error: AdminFetchErrorState;
  resourceLabel: string;
  capability: string;
  forbiddenAction?: string;
  signInTo?: string;
  onRetry: () => void;
}) {
  if (error.kind === "forbidden") {
    return (
      <EmptyState
        title="You don't have access"
        description={`${forbiddenAction} requires the ${capability} capability. Ask an administrator to grant access.`}
      />
    );
  }
  if (error.kind === "unauthorized") {
    return (
      <EmptyState
        title="Please sign in"
        description={`Your session has expired. Sign in again to ${signInTo}.`}
        action={{ label: "Sign in", href: "/signin" }}
      />
    );
  }
  return (
    <PanelRetryError
      message={error.kind === "notFound" ? `The ${resourceLabel} could not be found.` : error.message}
      onRetry={onRetry}
    />
  );
}

/** An announced error message with a Retry action. */
export function PanelRetryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="stack" role="alert">
      <p className="m-0 text-danger-text text-[length:var(--text-sm)]">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry} className="w-auto">
        Retry
      </Button>
    </div>
  );
}

function PagerControls({
  label,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: {
  label: string;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (!hasPrev && !hasNext) return null;
  return (
    <div className="admin-pagination">
      <Button variant="outline" size="sm" disabled={!hasPrev} onClick={onPrev}>
        ← Previous
      </Button>
      <span className="muted">{label}</span>
      <Button variant="outline" size="sm" disabled={!hasNext} onClick={onNext}>
        Next →
      </Button>
    </div>
  );
}

/** A 1-based numbered pager. */
export function PanelPagination({
  page,
  totalPages,
  onGoto,
}: {
  page: number;
  totalPages: number;
  onGoto: (page: number) => void;
}) {
  return (
    <PagerControls
      label={`Page ${page} of ${totalPages}`}
      hasPrev={page > 1}
      hasNext={page < totalPages}
      onPrev={() => onGoto(page - 1)}
      onNext={() => onGoto(page + 1)}
    />
  );
}

/** A pager over an offset/limit window; `onGoto` receives the new offset. */
export function OffsetPagination({
  offset,
  limit,
  total,
  onGoto,
}: {
  offset: number;
  limit: number;
  total: number;
  onGoto: (offset: number) => void;
}) {
  const current = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return (
    <PagerControls
      label={`Page ${current} of ${totalPages}`}
      hasPrev={offset > 0}
      hasNext={offset + limit < total}
      onPrev={() => onGoto(Math.max(0, offset - limit))}
      onNext={() => onGoto(offset + limit)}
    />
  );
}
