"use client";

import { EmptyState, Skeleton } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import type { AdminFetchErrorState } from "@/lib/admin/admin-fetch-state";

/**
 * Shared loading / error / pagination primitives for the /admin/security client
 * panels (#1143). Both the security-events and audit-log islands render the same
 * deny-by-default fetch states (forbidden / unauthorized / generic) and the same
 * numbered pager, so those are extracted here rather than duplicated per panel.
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
 * Renders the deny-by-default and generic fetch-error states an admin panel can
 * hit while loading a `security.view`-gated resource. `resourceLabel` names the
 * resource in the copy (e.g. "audit log", "security events").
 */
export function PanelErrorState({
  error,
  resourceLabel,
  onRetry,
}: {
  error: AdminFetchErrorState;
  resourceLabel: string;
  onRetry: () => void;
}) {
  if (error.kind === "forbidden") {
    return (
      <EmptyState
        title="You don't have access"
        description={`Viewing the ${resourceLabel} requires the security.view capability. Ask an administrator to grant access.`}
      />
    );
  }
  if (error.kind === "unauthorized") {
    return (
      <EmptyState
        title="Please sign in"
        description="Your session has expired. Sign in again to continue."
        action={{ label: "Sign in", href: "/signin" }}
      />
    );
  }
  return (
    <div className="stack" role="alert">
      <p className="m-0 text-danger-text text-[length:var(--text-sm)]">
        {error.kind === "notFound" ? `The ${resourceLabel} could not be found.` : error.message}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry} className="w-auto">
        Retry
      </Button>
    </div>
  );
}

/** A 1-based numbered pager mirroring DeletedArticleQueue's `QueuePagination`. */
export function PanelPagination({
  page,
  totalPages,
  onGoto,
}: {
  page: number;
  totalPages: number;
  onGoto: (page: number) => void;
}) {
  const hasPrev = page > 1;
  const hasNext = page < totalPages;
  if (!hasPrev && !hasNext) return null;
  return (
    <div className="admin-pagination">
      <Button variant="outline" size="sm" disabled={!hasPrev} onClick={() => onGoto(page - 1)}>
        ← Previous
      </Button>
      <span className="muted">
        Page {page} of {totalPages}
      </span>
      <Button variant="outline" size="sm" disabled={!hasNext} onClick={() => onGoto(page + 1)}>
        Next →
      </Button>
    </div>
  );
}
