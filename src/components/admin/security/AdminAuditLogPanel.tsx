"use client";

import { useCallback, useEffect, useState } from "react";

import { EmptyState } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AdminTableWrap } from "@/components/admin";
import { getJson } from "@/lib/client-fetch";
import { formatDateTime } from "@/lib/display-format";
import {
  classifyAdminFetchError,
  type AdminFetchErrorState,
} from "@/lib/admin/admin-fetch-state";
import {
  DEFAULT_AUDIT_PAGE_SIZE,
  auditLogEndpoint,
  type AuditLogFilters,
  type AuditLogPage,
  type AuditLogRow,
} from "@/lib/admin/security/audit-log-ui";
import { PanelErrorState, PanelPagination, PanelSkeleton } from "./panel-states";

const DASH = "—";

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: AdminFetchErrorState }
  | { status: "ready"; page: AuditLogPage };

function cell(value: string | null | undefined) {
  return value && value.length > 0 ? value : DASH;
}

/**
 * Durable audit-log trail (#1143). Client island that fetches the DB-backed
 * audit log from `/api/admin/audit-logs` with action / actorId / targetType
 * filters and page/prev-next pagination, and renders every required state:
 * loading Skeleton, empty EmptyState, unauthorized/forbidden, and generic error
 * + retry. Holds its OWN filter + page state (independent of the sibling events
 * panel). Renders ONLY metadata columns (ids / enums / roles / IP / request id /
 * timestamp) — never the sanitized metadata blob, the user-agent string, or any
 * user-private content.
 */
export default function AdminAuditLogPanel() {
  const [filters, setFilters] = useState<AuditLogFilters>({
    page: 1,
    pageSize: DEFAULT_AUDIT_PAGE_SIZE,
    action: "",
    actorId: "",
    targetType: "",
  });
  const [actionDraft, setActionDraft] = useState("");
  const [actorDraft, setActorDraft] = useState("");
  const [targetDraft, setTargetDraft] = useState("");
  const [data, setData] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async (f: AuditLogFilters) => {
    setData({ status: "loading" });
    try {
      const page = await getJson<AuditLogPage>(auditLogEndpoint(f));
      setData({ status: "ready", page });
    } catch (err) {
      setData({ status: "error", error: classifyAdminFetchError(err) });
    }
  }, []);

  useEffect(() => {
    void load(filters);
  }, [filters, load]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFilters((prev) => ({
      ...prev,
      page: 1,
      action: actionDraft.trim(),
      actorId: actorDraft.trim(),
      targetType: targetDraft.trim(),
    }));
  };

  const goToPage = (page: number) => setFilters((prev) => ({ ...prev, page }));

  return (
    <div className="stack">
      <form
        onSubmit={onSubmit}
        className="flex flex-wrap gap-[var(--space-2)] items-center"
      >
        <Input
          type="search"
          value={actionDraft}
          onChange={(e) => setActionDraft(e.target.value)}
          placeholder="Action…"
          inputSize="md"
          className="flex-[1_1_160px]"
          aria-label="Filter by action"
        />
        <Input
          type="search"
          value={actorDraft}
          onChange={(e) => setActorDraft(e.target.value)}
          placeholder="Actor id…"
          inputSize="md"
          className="flex-[1_1_160px]"
          aria-label="Filter by actor id"
        />
        <Input
          type="search"
          value={targetDraft}
          onChange={(e) => setTargetDraft(e.target.value)}
          placeholder="Target type…"
          inputSize="md"
          className="flex-[1_1_160px]"
          aria-label="Filter by target type"
        />
        <Button type="submit" variant="primary" size="md" className="w-auto">
          Filter
        </Button>
      </form>

      {data.status === "loading" && <PanelSkeleton label="Loading audit log" />}

      {data.status === "error" && (
        <PanelErrorState error={data.error} resourceLabel="audit log" onRetry={() => void load(filters)} />
      )}

      {data.status === "ready" && (
        <>
          <p className="muted m-0" aria-live="polite">
            {data.page.total === 0
              ? "No audit entries match."
              : `${data.page.total} audit ${data.page.total === 1 ? "entry" : "entries"} · page ${data.page.page} of ${data.page.totalPages}`}
          </p>
          {data.page.logs.length === 0 ? (
            <EmptyState
              title="No audit entries"
              description="No durable audit-log entries match these filters."
            />
          ) : (
            <AuditTable logs={data.page.logs} />
          )}
          <PanelPagination page={data.page.page} totalPages={data.page.totalPages} onGoto={goToPage} />
        </>
      )}
    </div>
  );
}

function AuditTable({ logs }: { logs: AuditLogRow[] }) {
  return (
    <AdminTableWrap ariaLabel="Durable audit log (scrollable)">
      <thead>
        <tr>
          <th scope="col">Time</th>
          <th scope="col">Action</th>
          <th scope="col">Actor</th>
          <th scope="col">Target</th>
          <th scope="col">IP</th>
          <th scope="col">Request</th>
        </tr>
      </thead>
      <tbody>
        {logs.map((log) => (
          <tr key={log.id}>
            <td className="text-text-muted text-[length:var(--text-sm)]">
              {formatDateTime(log.createdAt)}
            </td>
            <td>{log.action}</td>
            <td>
              <div className="flex flex-col gap-[var(--space-1)]">
                <code className="text-[length:var(--text-xs)] break-all">{cell(log.actorId)}</code>
                <span className="text-text-muted text-[length:var(--text-xs)]">
                  {cell(log.actorRole)}
                </span>
              </div>
            </td>
            <td>
              <div className="flex flex-col gap-[var(--space-1)]">
                <span className="text-text-muted text-[length:var(--text-xs)]">{log.targetType}</span>
                <code className="text-[length:var(--text-xs)] break-all">{cell(log.targetId)}</code>
              </div>
            </td>
            <td className="text-text-muted">{cell(log.ipAddress)}</td>
            <td>
              <code className="text-[length:var(--text-xs)] break-all">{cell(log.requestId)}</code>
            </td>
          </tr>
        ))}
      </tbody>
    </AdminTableWrap>
  );
}
