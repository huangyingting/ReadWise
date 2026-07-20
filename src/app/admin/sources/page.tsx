import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import {
  listRecentCrawlRuns,
  listContentSources,
  summarizeSourceHealth,
  type CrawlRunHistoryRow,
  type SourceHealthStatus,
} from "@/lib/scraper/sources";
import AdminSourceActions from "@/components/AdminSourceActions";
import AdminSourceSync from "@/components/AdminSourceSync";
import AdminSourceCrawlHistory from "@/components/admin/sources/AdminSourceCrawlHistory";
import { AdminPageHeader, AdminTableWrap } from "@/components/admin";
import { Badge, Card, CardBody } from "@/components/ui";
import { formatDateTime } from "@/lib/display-format";

type ContentSource = Awaited<ReturnType<typeof listContentSources>>[number];
type SourceHealth = ReturnType<typeof summarizeSourceHealth>;
type SourceRow = { source: ContentSource; health: SourceHealth; runs: CrawlRunHistoryRow[] };

function healthBadgeVariant(
  status: SourceHealthStatus,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "healthy") return "success";
  if (status === "degraded") return "warning";
  if (status === "failing") return "danger";
  return "neutral";
}

async function sourceRows(sources: ContentSource[]): Promise<SourceRow[]> {
  const runLists = await Promise.all(
    sources.map((source) => listRecentCrawlRuns(source.providerKey, 3)),
  );
  return sources.map((source, index) => ({
    source,
    health: summarizeSourceHealth(source),
    runs: runLists[index] ?? [],
  }));
}

export default async function AdminSourcesPage() {
  await requireCapability(CAPABILITIES.sourcesManage, "/admin/sources");

  const sources = await listContentSources();
  const rows = await sourceRows(sources);

  return (
    <section className="stack">
      <AdminPageHeader>Content sources</AdminPageHeader>
      <p className="m-0 text-text-muted">
        Provider governance &amp; ingestion health (RW-046/RW-050). Extraction
        logic lives in code; this page manages operational state — enable/disable
        a provider and watch its crawl health. Disabled providers are skipped by
        the scraper.
      </p>

      <AdminSourceSync />

      {rows.length === 0 ? (
        <EmptySourcesState />
      ) : (
        <SourcesTable rows={rows} />
      )}
    </section>
  );
}

function EmptySourcesState() {
  return (
    <Card>
      <CardBody className="mt-0">
        <p className="m-0 text-text-muted">
          No content sources yet. Use <strong>Sync from registry</strong> to
          create a row per code-registry provider.
        </p>
      </CardBody>
    </Card>
  );
}

function SourcesTable({ rows }: { rows: SourceRow[] }) {
  return (
    <AdminTableWrap ariaLabel="Content sources table (scrollable)">
      <thead>
        <tr>
          <th>Provider</th>
          <th>Health</th>
          <th>Last crawl</th>
          <th>Discovered / Scraped</th>
          <th>Failed / Dupes / Rejected</th>
          <th>Recent runs</th>
          <th>State</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ source, health, runs }) => (
          <tr key={source.id}>
            <td className="font-medium">
              {source.displayName}
              <div className="text-text-muted text-[length:var(--text-sm)]">
                {source.providerKey}
              </div>
            </td>
            <td>
              <SourceHealthSummary health={health} />
            </td>
            <td className="text-text-muted text-[length:var(--text-sm)]">
              {source.lastCrawledAt
                ? formatDateTime(source.lastCrawledAt)
                : "never"}
            </td>
            <td className="text-text-muted">
              {source.totalDiscovered} / {source.totalScraped}
              <div className="text-[length:var(--text-sm)]">
                last: {source.lastDiscoveryCount}
              </div>
            </td>
            <td className="text-text-muted text-[length:var(--text-sm)]">
              {source.totalFailed} / {source.totalDuplicates} /{" "}
              {source.totalRejected}
            </td>
            <td>
              <RecentRuns runs={runs} />
              <div className="mt-[var(--space-2)]">
                <AdminSourceCrawlHistory
                  providerKey={source.providerKey}
                  displayName={source.displayName}
                />
              </div>
            </td>
            <td>
              <AdminSourceActions
                providerKey={source.providerKey}
                enabled={source.enabled}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </AdminTableWrap>
  );
}

function formatDuration(durationMs: number | null): string {
  if (durationMs == null) return "duration unknown";
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function RecentRuns({ runs }: { runs: CrawlRunHistoryRow[] }) {
  if (runs.length === 0) {
    return <span className="text-text-muted text-[length:var(--text-sm)]">No recorded runs</span>;
  }

  return (
    <ul className="m-0 list-none p-0 text-[length:var(--text-sm)]">
      {runs.map((run) => (
        <li key={run.id} className="mb-[var(--space-2)] last:mb-0">
          <div className="font-medium">
            {run.outcome} · {formatDateTime(run.createdAt)}
          </div>
          <div className="text-text-muted">
            {run.source}/{run.mode} · {formatDuration(run.durationMs)}
          </div>
          <div className="text-text-muted">
            {run.discovered} discovered, {run.scraped} scraped, {run.failed} failed
          </div>
          {run.error ? (
            <div className="text-danger-text">error: {run.error}</div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function SourceHealthSummary({ health }: { health: SourceHealth }) {
  return (
    <>
      <Badge variant={healthBadgeVariant(health.status)}>{health.status}</Badge>
      {health.flagged ? (
        <div className="text-danger-text text-[length:var(--text-sm)]">
          ⚠ needs attention
        </div>
      ) : null}
      {health.reasons.length > 0 ? (
        <div className="text-text-muted text-[length:var(--text-sm)]">
          {health.reasons.join("; ")}
        </div>
      ) : null}
    </>
  );
}
