import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import {
  listContentSources,
  summarizeSourceHealth,
  type SourceHealthStatus,
} from "@/lib/content-sources";
import AdminSourceActions from "@/components/AdminSourceActions";
import AdminSourceSync from "@/components/AdminSourceSync";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

function healthBadgeVariant(
  status: SourceHealthStatus,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "healthy") return "success";
  if (status === "degraded") return "warning";
  if (status === "failing") return "danger";
  return "neutral";
}

export default async function AdminSourcesPage() {
  await requireCapability(CAPABILITIES.sourcesManage, "/admin/sources");

  const sources = await listContentSources();
  const rows = sources.map((source) => ({
    source,
    health: summarizeSourceHealth(source),
  }));

  return (
    <section className="stack">
      <h1 className="m-0 text-[length:var(--text-3xl)] font-[family-name:var(--font-display)] font-bold text-text">
        Content sources
      </h1>
      <p className="muted" style={{ margin: 0 }}>
        Provider governance &amp; ingestion health (RW-046/RW-050). Extraction
        logic lives in code; this page manages operational state — enable/disable
        a provider and watch its crawl health. Disabled providers are skipped by
        the scraper.
      </p>

      <AdminSourceSync />

      {rows.length === 0 ? (
        <Card>
          <p className="muted" style={{ margin: 0 }}>
            No content sources yet. Use{" "}
            <strong>Sync from registry</strong> to create a row per code-registry
            provider.
          </p>
        </Card>
      ) : (
        <div
          className="admin-table-wrap"
          tabIndex={0}
          aria-label="Content sources table (scrollable)"
        >
          <table className="admin-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Health</th>
                <th>Last crawl</th>
                <th>Discovered / Scraped</th>
                <th>Failed / Dupes / Rejected</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ source, health }) => (
                <tr key={source.id}>
                  <td className="font-medium">
                    {source.displayName}
                    <div className="muted text-[length:var(--text-sm)]">
                      {source.providerKey}
                    </div>
                  </td>
                  <td>
                    <Badge variant={healthBadgeVariant(health.status)}>
                      {health.status}
                    </Badge>
                    {health.flagged && (
                      <div className="text-danger-text text-[length:var(--text-sm)]">
                        ⚠ needs attention
                      </div>
                    )}
                    {health.reasons.length > 0 && (
                      <div className="muted text-[length:var(--text-sm)]">
                        {health.reasons.join("; ")}
                      </div>
                    )}
                  </td>
                  <td className="muted text-[length:var(--text-sm)]">
                    {source.lastCrawledAt
                      ? new Date(source.lastCrawledAt).toLocaleString()
                      : "never"}
                  </td>
                  <td className="muted">
                    {source.totalDiscovered} / {source.totalScraped}
                    <div className="text-[length:var(--text-sm)]">
                      last: {source.lastDiscoveryCount}
                    </div>
                  </td>
                  <td className="muted text-[length:var(--text-sm)]">
                    {source.totalFailed} / {source.totalDuplicates} /{" "}
                    {source.totalRejected}
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
          </table>
        </div>
      )}
    </section>
  );
}
