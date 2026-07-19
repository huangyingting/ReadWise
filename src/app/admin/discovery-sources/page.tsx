import Link from "next/link";
import { DiscoverySourceLifecycleMode } from "@prisma/client";

import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import {
  listDiscoverySourceMetrics,
  type DiscoverySourceMetricsDto,
} from "@/lib/scraper/incremental/observability-query";
import {
  AdminPageHeader,
  AdminFilterBar,
  AdminTableWrap,
} from "@/components/admin";
import { Badge, Button, Card, CardBody, Input, Select } from "@/components/ui";
import {
  DiscoverySourceStatusBadge,
  gapBadgeVariant,
  healthBadgeVariant,
} from "@/components/DiscoverySourceStatusBadge";
import { formatAgeSeconds, formatDateTime } from "@/lib/display-format";

type SearchParams = {
  providerKey?: string;
  lifecycleMode?: string;
};

const LIFECYCLE_MODES = Object.values(DiscoverySourceLifecycleMode);

function parseMode(raw: string): DiscoverySourceLifecycleMode | undefined {
  return (LIFECYCLE_MODES as string[]).includes(raw)
    ? (raw as DiscoverySourceLifecycleMode)
    : undefined;
}

export default async function AdminDiscoverySourcesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireCapability(CAPABILITIES.sourcesManage, "/admin/discovery-sources");

  const sp = await searchParams;
  const providerKey = (sp.providerKey ?? "").trim();
  const lifecycleMode = parseMode((sp.lifecycleMode ?? "").trim());

  const sources = await listDiscoverySourceMetrics({
    providerKey: providerKey || undefined,
    lifecycleMode,
  });

  return (
    <section className="stack">
      <AdminPageHeader>Discovery sources</AdminPageHeader>
      <p className="m-0 text-text-muted">
        Incremental discovery observability (RW-1089). Each source shows its
        derived operational status, lifecycle mode, and drift signals — no crawl
        URLs, article content, or credentials are ever shown. Select a source to
        view full metrics and lifecycle controls.
      </p>

      <AdminFilterBar>
        <Input
          type="search"
          name="providerKey"
          defaultValue={providerKey}
          placeholder="Provider key…"
          inputSize="md"
          className="flex-[1_1_200px]"
          aria-label="Filter by provider key"
        />
        <Select
          name="lifecycleMode"
          defaultValue={lifecycleMode ?? ""}
          selectSize="md"
          className="w-auto"
          aria-label="Filter by lifecycle mode"
        >
          <option value="">All lifecycle modes</option>
          {LIFECYCLE_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="primary" size="md" className="w-auto">
          Filter
        </Button>
      </AdminFilterBar>

      <p className="muted m-0" aria-live="polite">
        {sources.length === 0
          ? "No discovery sources match."
          : `${sources.length} discovery source${sources.length === 1 ? "" : "s"}`}
      </p>

      {sources.length === 0 ? (
        <EmptyDiscoverySourcesState />
      ) : (
        <DiscoverySourcesTable sources={sources} />
      )}
    </section>
  );
}

function EmptyDiscoverySourcesState() {
  return (
    <Card>
      <CardBody className="mt-0">
        <p className="m-0 text-text-muted">
          No discovery sources yet. Sources appear here once the incremental
          scraper registers them; adjust the filters above to widen the search.
        </p>
      </CardBody>
    </Card>
  );
}

function DiscoverySourcesTable({
  sources,
}: {
  sources: DiscoverySourceMetricsDto[];
}) {
  return (
    <AdminTableWrap ariaLabel="Discovery sources table (scrollable)">
      <thead>
        <tr>
          <th>Source</th>
          <th>Status</th>
          <th>Lifecycle</th>
          <th>Automation</th>
          <th>Role</th>
          <th>Health</th>
          <th>Last run</th>
          <th>Watermark stall</th>
          <th>Backlog</th>
          <th>Gap</th>
        </tr>
      </thead>
      <tbody>
        {sources.map(({ id, providerKey, sourceKey, definitionVersion, metrics }) => (
          <tr key={id}>
            <td className="font-medium">
              <Link
                href={`/admin/discovery-sources/${id}`}
                className="text-primary-text hover:underline"
              >
                {providerKey}/{sourceKey}
              </Link>
              <div className="text-text-muted text-[length:var(--text-sm)]">
                v{definitionVersion}
              </div>
            </td>
            <td>
              <DiscoverySourceStatusBadge status={metrics.status} />
            </td>
            <td className="text-text-muted">{metrics.lifecycleMode}</td>
            <td className="text-text-muted">{metrics.automationPolicy}</td>
            <td className="text-text-muted">{metrics.role}</td>
            <td>
              <Badge variant={healthBadgeVariant(metrics.health)}>
                {metrics.health}
              </Badge>
            </td>
            <td className="text-text-muted text-[length:var(--text-sm)]">
              {metrics.lastRunAt ? formatDateTime(metrics.lastRunAt) : "never"}
            </td>
            <td className="text-text-muted text-[length:var(--text-sm)]">
              {formatAgeSeconds(metrics.watermarkStallSeconds)}
            </td>
            <td className="text-text-muted">{metrics.backlogCount}</td>
            <td>
              {metrics.gapState === "NONE" ? (
                <span className="text-text-muted text-[length:var(--text-sm)]">none</span>
              ) : (
                <Badge variant={gapBadgeVariant(metrics.gapState)}>
                  {metrics.gapState}
                </Badge>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </AdminTableWrap>
  );
}
