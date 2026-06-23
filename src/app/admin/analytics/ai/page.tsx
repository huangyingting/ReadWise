import Link from "next/link";
import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import { getAiCostOverview, getContentOpsOverview } from "@/lib/admin-ai-ops";
import { AdminStatCard } from "@/components/AdminStatCard";
import { AnalyticsTabs } from "@/components/admin/AnalyticsTabs";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

type SearchParams = { hours?: string };

const HOUR_PRESETS = [
  { hours: 24, label: "Last 24 hours" },
  { hours: 168, label: "Last 7 days" },
  { hours: 720, label: "Last 30 days" },
];

function usd(value: number): string {
  return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}

export default async function AdminAiOpsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireCapability(CAPABILITIES.analyticsView, "/admin/analytics/ai");

  const sp = await searchParams;
  const hours = Number.parseInt(sp.hours ?? "168", 10) || 168;

  const [ai, ops] = await Promise.all([
    getAiCostOverview({ hours }),
    getContentOpsOverview(),
  ]);

  const statusBuckets = Object.entries(ops.jobs.byStatus);

  return (
    <section className="stack">
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
        <h1 className="m-0 text-[length:var(--text-3xl)] font-[family-name:var(--font-display)] font-bold text-text">
          AI &amp; content ops
        </h1>
        <AnalyticsTabs active="ai" />
      </div>

      <form method="get" className="flex flex-wrap items-end gap-[var(--space-2)]">
        <label className="flex flex-col gap-[var(--space-1)] text-[length:var(--text-sm)]">
          <span className="muted">Time range</span>
          <Select name="hours" defaultValue={String(ai.windowHours)} selectSize="md" className="w-auto">
            {HOUR_PRESETS.map((p) => (
              <option key={p.hours} value={p.hours}>
                {p.label}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" variant="primary" size="md" className="w-auto">
          Apply
        </Button>
      </form>

      <p className="muted" style={{ margin: 0 }}>
        {ai.range.since.slice(0, 10)} → {ai.range.until.slice(0, 10)}
      </p>

      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
        AI usage &amp; cost
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-[var(--space-4)]">
        <AdminStatCard label="Total calls" value={ai.summary.total.count} />
        <AdminStatCard label="Est. cost" value={usd(ai.summary.total.estimatedCostUsd)} />
        <AdminStatCard label="Total tokens" value={ai.summary.total.totalTokens} />
        <AdminStatCard label="Fallbacks" value={ai.summary.total.fallbackCount} />
        <AdminStatCard label="Cache hits" value={ai.summary.total.cacheHitCount} />
        <AdminStatCard
          label="Avg latency"
          value={ai.latency.avgMs !== null ? `${ai.latency.avgMs}ms` : "—"}
        />
      </div>

      {ai.highFallbackFeatures.length > 0 && (
        <Card className="border-danger">
          <div className="stack">
            <strong className="text-danger-text">High-fallback features</strong>
            <p className="muted m-0">
              These features are degrading to non-AI fallbacks frequently —
              check provider config / budgets.
            </p>
            <ul className="m-0">
              {ai.highFallbackFeatures.map((f) => (
                <li key={f.key}>
                  {f.key}: {f.fallbackRatePct}% fallback ({f.fallbackCount}/{f.count})
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      <h3 className="font-[family-name:var(--font-display)] font-semibold text-text">By feature</h3>
      <Card>
        <div className="admin-table-wrap" tabIndex={0} aria-label="AI usage by feature (scrollable)">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Calls</th>
                <th>Tokens</th>
                <th>Est. cost</th>
                <th>Fallback rate</th>
              </tr>
            </thead>
            <tbody>
              {ai.byFeatureCost.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    No AI invocations recorded for this period.
                  </td>
                </tr>
              ) : (
                ai.byFeatureCost.map((f) => (
                  <tr key={f.key}>
                    <td>{f.key}</td>
                    <td>{f.count}</td>
                    <td>{f.totalTokens}</td>
                    <td>{usd(f.estimatedCostUsd)}</td>
                    <td className={f.fallbackRatePct >= 25 ? "text-danger-text" : "muted"}>
                      {f.fallbackRatePct}%
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[var(--space-4)]">
        <div className="stack">
          <h3 className="font-[family-name:var(--font-display)] font-semibold text-text">Top users by cost</h3>
          <Card>
            <div className="admin-table-wrap" tabIndex={0} aria-label="Top users by AI cost (scrollable)">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Calls</th>
                    <th>Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {ai.topUsers.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="muted">No data.</td>
                    </tr>
                  ) : (
                    ai.topUsers.map((u) => (
                      <tr key={u.key}>
                        <td>
                          {u.key === "—" ? (
                            <span className="muted">system / anonymous</span>
                          ) : (
                            <Link href={`/admin/members/${u.key}`}>{u.key.slice(0, 12)}…</Link>
                          )}
                        </td>
                        <td>{u.count}</td>
                        <td>{usd(u.estimatedCostUsd)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="stack">
          <h3 className="font-[family-name:var(--font-display)] font-semibold text-text">Top articles by cost</h3>
          <Card>
            <div className="admin-table-wrap" tabIndex={0} aria-label="Top articles by AI cost (scrollable)">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Article</th>
                    <th>Calls</th>
                    <th>Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {ai.topArticles.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="muted">No data.</td>
                    </tr>
                  ) : (
                    ai.topArticles.map((a) => (
                      <tr key={a.key}>
                        <td>
                          <Link href={`/admin/articles/${a.key}`}>{a.key.slice(0, 12)}…</Link>
                        </td>
                        <td>{a.count}</td>
                        <td>{usd(a.estimatedCostUsd)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>

      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
        Content operations
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-[var(--space-4)]">
        <AdminStatCard label="Steps generated" value={ops.totals.generated} />
        <AdminStatCard label="Skipped" value={ops.totals.skipped} />
        <AdminStatCard label="Fallback" value={ops.totals.fallback} />
        <AdminStatCard label="Failed" value={ops.totals.failed} />
        <AdminStatCard label="Pending" value={ops.totals.pending} />
        <AdminStatCard label="Job backlog" value={ops.jobs.total} />
      </div>

      <h3 className="font-[family-name:var(--font-display)] font-semibold text-text">Processing steps</h3>
      <Card>
        <div className="admin-table-wrap" tabIndex={0} aria-label="Processing steps (scrollable)">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Step</th>
                <th>Generated</th>
                <th>Skipped</th>
                <th>Fallback</th>
                <th>Failed</th>
                <th>Pending</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {ops.steps.map((s) => (
                <tr key={s.step}>
                  <td>{s.step}</td>
                  <td>{s.counts.generated}</td>
                  <td className="muted">{s.counts.skipped}</td>
                  <td className={s.counts.fallback > 0 ? "text-danger-text" : "muted"}>
                    {s.counts.fallback}
                  </td>
                  <td className={s.counts.failed > 0 ? "text-danger-text" : "muted"}>
                    {s.counts.failed}
                  </td>
                  <td className="muted">{s.counts.pending}</td>
                  <td>{s.counts.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {ops.problemArticles.length > 0 && (
        <>
          <h3 className="font-[family-name:var(--font-display)] font-semibold text-text">
            Articles needing attention
          </h3>
          <Card>
            <div className="admin-table-wrap" tabIndex={0} aria-label="Problem articles (scrollable)">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Article</th>
                    <th>Status</th>
                    <th>Failed</th>
                    <th>Fallback</th>
                    <th>Steps</th>
                  </tr>
                </thead>
                <tbody>
                  {ops.problemArticles.map((a) => (
                    <tr key={a.articleId}>
                      <td>
                        <Link href={`/admin/articles/${a.articleId}`}>
                          {a.title ?? a.articleId.slice(0, 12)}
                        </Link>
                      </td>
                      <td>
                        <Badge variant="neutral">{a.status}</Badge>
                      </td>
                      <td className={a.failed > 0 ? "text-danger-text" : "muted"}>{a.failed}</td>
                      <td className="muted">{a.fallback}</td>
                      <td className="muted">
                        {a.steps.map((st) => `${st.step}:${st.status}`).join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <h3 className="font-[family-name:var(--font-display)] font-semibold text-text">
        Job queue health
      </h3>
      <Card>
        <div className="stack">
          <p className="m-0">
            {ops.jobs.total} jobs total · {ops.jobs.stuck} stuck ·{" "}
            {ops.jobs.recentFailures.length} recent failures ·{" "}
            {ops.jobs.deadLetter.length} dead-letter ·{" "}
            <Link href="/admin/jobs">Manage jobs →</Link>
          </p>
          <div className="flex flex-wrap gap-[var(--space-2)]">
            {statusBuckets.map(([status, count]) => (
              <Badge key={status} variant="neutral">
                {status}: {count}
              </Badge>
            ))}
          </div>
        </div>
      </Card>
    </section>
  );
}
