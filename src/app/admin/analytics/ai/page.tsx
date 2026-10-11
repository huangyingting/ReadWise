import Link from "next/link";
import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import { getAiCostOverview, getContentOpsOverview } from "@/lib/processing/admin-ops";
import { AnalyticsTabs } from "@/components/admin/AnalyticsTabs";
import { AdminPageHeader, AdminTableWrap } from "@/components/admin";
import { Card } from "@/components/ui/Card";
import { Metric, MetricStrip } from "@/components/ui";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatUSD } from "@/lib/display-format";

type SearchParams = { hours?: string };

const DEFAULT_WINDOW_HOURS = 168;
const SECTION_TITLE_CLASS =
  "m-0 font-[family-name:var(--font-display)] font-semibold text-[length:var(--type-section-title)] text-text";
const SUBSECTION_TITLE_CLASS =
  "m-0 font-[family-name:var(--font-display)] font-semibold text-[length:var(--type-section-title-compact)] text-text";

const HOUR_PRESETS = [
  { hours: 24, label: "Last 24 hours" },
  { hours: 168, label: "Last 7 days" },
  { hours: 720, label: "Last 30 days" },
];

function compactId(id: string): string {
  return `${id.slice(0, 12)}…`;
}

export default async function AdminAiOpsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireCapability(CAPABILITIES.analyticsView, "/admin/analytics/ai");

  const sp = await searchParams;
  const hours =
    Number.parseInt(sp.hours ?? String(DEFAULT_WINDOW_HOURS), 10) ||
    DEFAULT_WINDOW_HOURS;

  const [ai, ops] = await Promise.all([
    getAiCostOverview({ hours }),
    getContentOpsOverview(),
  ]);

  const statusBuckets = Object.entries(ops.jobs.byStatus);

  return (
    <section className="stack">
      <AdminPageHeader actions={<AnalyticsTabs active="ai" />}>
        AI &amp; content ops
      </AdminPageHeader>

      <form method="get" className="flex flex-wrap items-end gap-[var(--space-2)]">
        <label className="flex flex-col gap-[var(--space-1)] text-[length:var(--type-label)]">
          <span className="muted">Time range</span>
          <Select
            name="hours"
            defaultValue={String(ai.windowHours)}
            selectSize="sm"
            className="w-auto"
          >
            {HOUR_PRESETS.map((p) => (
              <option key={p.hours} value={p.hours}>
                {p.label}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" variant="primary" size="sm" className="w-auto">
          Apply
        </Button>
      </form>

      <p className="m-0 text-[length:var(--type-ui)] text-text-subtle">
        {ai.range.since.slice(0, 10)} → {ai.range.until.slice(0, 10)}
      </p>

      <h2 className={SECTION_TITLE_CLASS}>AI usage &amp; cost</h2>
      <MetricStrip columns={6}>
        <Metric label="Total calls" value={ai.summary.total.count} />
        <Metric label="Est. cost" value={formatUSD(ai.summary.total.estimatedCostUsd)} />
        <Metric label="Total tokens" value={ai.summary.total.totalTokens} />
        <Metric label="Fallbacks" value={ai.summary.total.fallbackCount} />
        <Metric label="Cache hits" value={ai.summary.total.cacheHitCount} />
        <Metric
          label="Avg latency"
          value={ai.latency.avgMs !== null ? `${ai.latency.avgMs}ms` : "—"}
        />
      </MetricStrip>

      {ai.highFallbackFeatures.length > 0 && (
        <Card className="border border-danger">
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

      {ai.fallbackReasons.length > 0 && (
        <>
          <h3 className={SUBSECTION_TITLE_CLASS}>Fallback reasons</h3>
          <AdminTableWrap ariaLabel="AI fallback reasons (scrollable)">
            <thead>
              <tr>
                <th>Reason</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {ai.fallbackReasons.map((r) => (
                <tr key={r.reason}>
                  <td>{r.reason}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </AdminTableWrap>
        </>
      )}

      <h3 className={SUBSECTION_TITLE_CLASS}>By feature</h3>
      <AdminTableWrap ariaLabel="AI usage by feature (scrollable)">
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
                <td>{formatUSD(f.estimatedCostUsd)}</td>
                <td className={f.fallbackRatePct >= 25 ? "text-danger-text" : "muted"}>
                  {f.fallbackRatePct}%
                </td>
              </tr>
            ))
          )}
        </tbody>
      </AdminTableWrap>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[var(--space-4)]">
        <div className="stack">
          <h3 className={SUBSECTION_TITLE_CLASS}>Top users by cost</h3>
          <AdminTableWrap ariaLabel="Top users by AI cost (scrollable)">
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
                  <td colSpan={3} className="muted">
                    No data.
                  </td>
                </tr>
              ) : (
                ai.topUsers.map((u) => (
                  <tr key={u.key}>
                    <td>
                      {u.key === "—" ? (
                        <span className="muted">system / anonymous</span>
                      ) : (
                        <Link href={`/admin/members/${u.key}`}>{compactId(u.key)}</Link>
                      )}
                    </td>
                    <td>{u.count}</td>
                    <td>{formatUSD(u.estimatedCostUsd)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </AdminTableWrap>
        </div>

        <div className="stack">
          <h3 className={SUBSECTION_TITLE_CLASS}>Top articles by cost</h3>
          <AdminTableWrap ariaLabel="Top articles by AI cost (scrollable)">
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
                  <td colSpan={3} className="muted">
                    No data.
                  </td>
                </tr>
              ) : (
                ai.topArticles.map((a) => (
                  <tr key={a.key}>
                    <td>
                      <Link href={`/admin/articles/${a.key}`}>{compactId(a.key)}</Link>
                    </td>
                    <td>{a.count}</td>
                    <td>{formatUSD(a.estimatedCostUsd)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </AdminTableWrap>
        </div>
      </div>

      <h2 className={SECTION_TITLE_CLASS}>Content operations</h2>
      <MetricStrip columns={6}>
        <Metric label="Steps generated" value={ops.totals.generated} />
        <Metric label="Skipped" value={ops.totals.skipped} />
        <Metric label="Fallback" value={ops.totals.fallback} />
        <Metric
          label="Failed"
          value={ops.totals.failed}
          tone={ops.totals.failed > 0 ? "danger" : "default"}
        />
        <Metric label="Pending" value={ops.totals.pending} />
        <Metric label="Job backlog" value={ops.jobs.total} />
      </MetricStrip>

      <h3 className={SUBSECTION_TITLE_CLASS}>Processing steps</h3>
      <AdminTableWrap ariaLabel="Processing steps (scrollable)">
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
      </AdminTableWrap>

      {ops.problemArticles.length > 0 && (
        <>
          <h3 className={SUBSECTION_TITLE_CLASS}>Articles needing attention</h3>
          <AdminTableWrap ariaLabel="Problem articles (scrollable)">
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
                    {a.steps
                      .map((st) =>
                        st.fallbackReason
                          ? `${st.step}:${st.status}(${st.fallbackReason})`
                          : `${st.step}:${st.status}`,
                      )
                      .join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminTableWrap>
        </>
      )}

      <h3 className={SUBSECTION_TITLE_CLASS}>Job queue health</h3>
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
