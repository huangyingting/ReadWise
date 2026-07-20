"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge, EmptyState, Select } from "@/components/ui";
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
  DEFAULT_SECURITY_EVENTS_LIMIT,
  SECURITY_SEVERITIES,
  securityEventsEndpoint,
  severityBadgeVariant,
  type SecurityEventRow,
  type SecurityEventsFilters,
  type SecurityEventsResponse,
} from "@/lib/admin/security/events-ui";
import { PanelErrorState, PanelSkeleton } from "./panel-states";

const DASH = "—";

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: AdminFetchErrorState }
  | { status: "ready"; data: SecurityEventsResponse };

function cell(value: string | number | null | undefined) {
  return value ?? DASH;
}

/**
 * In-process security-event queue (#1143). Client island that fetches the
 * point-in-time ring buffer from `/api/admin/security/events` with type +
 * severity filters (the durable trail lives in the audit-log panel below), and
 * renders every required state: loading Skeleton, empty EmptyState,
 * unauthorized/forbidden, and generic error + retry. Holds its OWN filter state
 * (independent of the sibling audit panel). Shows ONLY sanitized metadata —
 * type / severity / status / route / actor id / IP / count / timestamp.
 */
export default function AdminSecurityEventsPanel() {
  const [filters, setFilters] = useState<SecurityEventsFilters>({
    type: "",
    severity: "",
    limit: DEFAULT_SECURITY_EVENTS_LIMIT,
  });
  const [typeDraft, setTypeDraft] = useState("");
  const [severityDraft, setSeverityDraft] = useState("");
  const [data, setData] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async (f: SecurityEventsFilters) => {
    setData({ status: "loading" });
    try {
      const res = await getJson<SecurityEventsResponse>(securityEventsEndpoint(f));
      setData({ status: "ready", data: res });
    } catch (err) {
      setData({ status: "error", error: classifyAdminFetchError(err) });
    }
  }, []);

  useEffect(() => {
    void load(filters);
  }, [filters, load]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFilters({
      type: typeDraft.trim(),
      severity: severityDraft,
      limit: DEFAULT_SECURITY_EVENTS_LIMIT,
    });
  };

  const refresh = () => void load(filters);

  return (
    <div className="stack">
      <form
        onSubmit={onSubmit}
        className="flex flex-wrap gap-[var(--space-2)] items-center"
      >
        <Input
          type="search"
          value={typeDraft}
          onChange={(e) => setTypeDraft(e.target.value)}
          placeholder="Event type…"
          inputSize="md"
          className="flex-[1_1_180px]"
          aria-label="Filter by event type"
        />
        <Select
          value={severityDraft}
          onChange={(e) => setSeverityDraft(e.target.value)}
          selectSize="md"
          className="w-auto"
          aria-label="Filter by severity"
        >
          <option value="">All severities</option>
          {SECURITY_SEVERITIES.map((severity) => (
            <option key={severity} value={severity}>
              {severity}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="primary" size="md" className="w-auto">
          Filter
        </Button>
        <Button
          type="button"
          variant="outline"
          size="md"
          className="w-auto"
          onClick={refresh}
        >
          Refresh
        </Button>
      </form>

      {data.status === "loading" && <PanelSkeleton label="Loading security events" />}

      {data.status === "error" && (
        <PanelErrorState error={data.error} resourceLabel="security events" onRetry={refresh} />
      )}

      {data.status === "ready" && (
        <>
          <p className="muted m-0" aria-live="polite">
            {data.data.count === 0
              ? "No security events match."
              : `${data.data.count} event${data.data.count === 1 ? "" : "s"} · point-in-time snapshot`}
          </p>
          {data.data.events.length === 0 ? (
            <EmptyState
              title="No security events"
              description="No in-process security events match these filters yet."
            />
          ) : (
            <EventsTable events={data.data.events} />
          )}
        </>
      )}
    </div>
  );
}

function EventsTable({ events }: { events: SecurityEventRow[] }) {
  return (
    <AdminTableWrap ariaLabel="Recent security events (scrollable)">
      <thead>
        <tr>
          <th scope="col">Time</th>
          <th scope="col">Type</th>
          <th scope="col">Severity</th>
          <th scope="col">Status</th>
          <th scope="col">Route</th>
          <th scope="col">Actor</th>
          <th scope="col">IP</th>
          <th scope="col">Count</th>
        </tr>
      </thead>
      <tbody>
        {events.map((event, index) => (
          <tr key={`${event.timestamp}-${index}`}>
            <td className="text-text-muted text-[length:var(--text-sm)]">
              {formatDateTime(event.timestamp)}
            </td>
            <td>{event.type}</td>
            <td>
              <Badge variant={severityBadgeVariant(event.severity)}>{event.severity}</Badge>
            </td>
            <td className="text-text-muted">{cell(event.status)}</td>
            <td className="text-text-muted">{cell(event.route)}</td>
            <td className="text-text-muted">{cell(event.actorId)}</td>
            <td className="text-text-muted">{cell(event.ip)}</td>
            <td className="text-text-muted">{event.count}</td>
          </tr>
        ))}
      </tbody>
    </AdminTableWrap>
  );
}
