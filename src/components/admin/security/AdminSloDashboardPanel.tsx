"use client";

import { useCallback, useEffect, useState } from "react";

import { AdminTableWrap } from "@/components/admin";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { getJson } from "@/lib/client-fetch";
import { formatDateTime } from "@/lib/display-format";
import {
  classifyAdminFetchError,
  type AdminFetchErrorState,
} from "@/lib/admin/admin-fetch-state";
import {
  formatLatencyThreshold,
  formatSloObjective,
  formatSloPercent,
  sliCatalogByKey,
  sloStatusBadgeVariant,
  sloStatusEndpoint,
  type SloDashboardResponse,
} from "@/lib/admin/security/slo-ui";
import { PanelErrorState, PanelSkeleton } from "./panel-states";

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: AdminFetchErrorState }
  | { status: "ready"; data: SloDashboardResponse };

/**
 * Read-only SLO dashboard (#1187). Fetches the point-in-time `/api/admin/slo`
 * snapshot and renders loading, empty, denied/error, and ready states with only
 * aggregated metrics — never request bodies, article text, prompts, or secrets.
 */
export default function AdminSloDashboardPanel() {
  const [data, setData] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async () => {
    setData({ status: "loading" });
    try {
      const response = await getJson<SloDashboardResponse>(sloStatusEndpoint());
      setData({ status: "ready", data: response });
    } catch (err) {
      setData({ status: "error", error: classifyAdminFetchError(err) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="stack">
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
        <p className="muted m-0">
          Point-in-time service-level status from in-process metrics.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-auto"
          onClick={() => void load()}
        >
          Refresh
        </Button>
      </div>

      {data.status === "loading" && <PanelSkeleton label="Loading SLO status" />}

      {data.status === "error" && (
        <PanelErrorState
          error={data.error}
          resourceLabel="SLO status"
          onRetry={() => void load()}
        />
      )}

      {data.status === "ready" && (
        <SloDashboardContent data={data.data} />
      )}
    </div>
  );
}

function SloDashboardContent({ data }: { data: SloDashboardResponse }) {
  const catalog = sliCatalogByKey(data.catalog);
  const { report } = data;

  if (report.slis.length === 0) {
    return (
      <EmptyState
        title="No SLO indicators configured"
        description="The SLO endpoint responded, but no indicators were available."
      />
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-[var(--space-3)]">
        <SloSummary label="Healthy" value={report.ok} />
        <SloSummary label="Breaching" value={report.breaching} />
        <SloSummary label="No data" value={report.noData} />
        <SloSummary label="Total" value={report.total} />
      </div>
      <p className="muted m-0" aria-live="polite">
        Evaluated {formatDateTime(report.evaluatedAt)} · {report.breaching}{" "}
        breaching · {report.noData} with no data.
      </p>
      <AdminTableWrap ariaLabel="Service-level objective status table (scrollable)">
        <thead>
          <tr>
            <th scope="col">Flow</th>
            <th scope="col">Status</th>
            <th scope="col">Metric</th>
            <th scope="col">Value</th>
            <th scope="col">Objective</th>
            <th scope="col">Threshold</th>
            <th scope="col">Samples</th>
          </tr>
        </thead>
        <tbody>
          {report.slis.map((sli) => (
            <tr key={sli.key}>
              <td>
                <div className="flex flex-col gap-[var(--space-1)]">
                  <span>{sli.flow}</span>
                  <span className="text-text-muted text-[length:var(--text-xs)]">
                    {catalog[sli.key]?.description ?? sli.title}
                  </span>
                </div>
              </td>
              <td>
                <Badge variant={sloStatusBadgeVariant(sli.status)}>
                  {sli.status}
                </Badge>
              </td>
              <td className="text-text-muted">
                {sli.category} · {sli.kind}
              </td>
              <td>{formatSloPercent(sli.value)}</td>
              <td>{formatSloObjective(sli.objective)}</td>
              <td className="text-text-muted">{formatLatencyThreshold(sli)}</td>
              <td className="text-text-muted">{sli.sampleCount}</td>
            </tr>
          ))}
        </tbody>
      </AdminTableWrap>
    </>
  );
}

function SloSummary({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-[var(--space-4)]">
      <p className="muted m-0">{label}</p>
      <p className="m-0 text-[length:var(--text-2xl)] font-semibold text-text">
        {value}
      </p>
    </Card>
  );
}
