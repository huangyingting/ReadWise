import Link from "next/link";
import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import {
  getAnalyticsOverview,
  getRetentionCohorts,
  resolveTimeRange,
  TIME_RANGE_PRESETS,
  type AnalyticsSegment,
} from "@/lib/analytics/product";
import { StatCard } from "@/components/analytics/StatCard";
import { BarChart, BarChartRow, AdminTableWrap } from "@/components/admin";
import { AnalyticsTabs } from "@/components/admin/AnalyticsTabs";
import { RetentionTable } from "@/components/admin/RetentionTable";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Button, buttonVariants } from "@/components/ui/Button";
import { ENGLISH_LEVELS } from "@/lib/option-registries";
import { CATEGORIES } from "@/lib/categories";

type SearchParams = {
  days?: string;
  level?: string;
  topic?: string;
};

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireCapability(CAPABILITIES.analyticsView, "/admin/analytics");

  const sp = await searchParams;
  const days = Number.parseInt(sp.days ?? "30", 10) || 30;
  const level = (sp.level ?? "").trim();
  const topic = (sp.topic ?? "").trim();
  const segment: AnalyticsSegment | undefined =
    level || topic ? { level: level || null, topic: topic || null } : undefined;

  const { since, until, days: resolvedDays } = resolveTimeRange(days);

  const [overview, cohorts] = await Promise.all([
    getAnalyticsOverview({ since, until, segment }),
    getRetentionCohorts({ weeks: 8, segment }),
  ]);

  const funnelBuckets = overview.funnel.map((s) => ({
    key: s.key,
    label: s.label,
    count: s.users,
  }));
  const featureBuckets = overview.featureUsage.map((f) => ({
    key: f.type,
    label: f.label,
    count: f.events,
  }));

  const exportParams = new URLSearchParams();
  exportParams.set("days", String(resolvedDays));
  if (level) exportParams.set("level", level);
  if (topic) exportParams.set("topic", topic);

  return (
    <section className="stack">
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
        <h1 className="m-0 text-[length:var(--text-3xl)] font-[family-name:var(--font-display)] font-bold text-text">
          Analytics
        </h1>
        <AnalyticsTabs active="product" />
      </div>

      <form method="get" className="flex flex-wrap items-end gap-[var(--space-2)]">
        <label className="flex flex-col gap-[var(--space-1)] text-[length:var(--text-sm)]">
          <span className="muted">Time range</span>
          <Select name="days" defaultValue={String(resolvedDays)} selectSize="md" className="w-auto">
            {TIME_RANGE_PRESETS.map((p) => (
              <option key={p.days} value={p.days}>
                {p.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-[var(--space-1)] text-[length:var(--text-sm)]">
          <span className="muted">Level</span>
          <Select name="level" defaultValue={level} selectSize="md" className="w-auto">
            <option value="">All levels</option>
            {ENGLISH_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-[var(--space-1)] text-[length:var(--text-sm)]">
          <span className="muted">Topic</span>
          <Select name="topic" defaultValue={topic} selectSize="md" className="w-auto">
            <option value="">All topics</option>
            {CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" variant="primary" size="md" className="w-auto">
          Apply
        </Button>
        <Link
          className={buttonVariants({ variant: "outline", size: "md" })}
          href={`/api/admin/analytics/export?format=csv&${exportParams.toString()}`}
          prefetch={false}
        >
          Export CSV
        </Link>
        <Link
          className={buttonVariants({ variant: "outline", size: "md" })}
          href={`/api/admin/analytics/export?format=json&${exportParams.toString()}`}
          prefetch={false}
        >
          Export JSON
        </Link>
      </form>

      <p className="muted m-0">
        {since.toISOString().slice(0, 10)} → {until.toISOString().slice(0, 10)} ·{" "}
        {overview.totals.events} events · {overview.totals.users} users
        {overview.segmentUserCount !== null
          ? ` · segment: ${overview.segmentUserCount} members`
          : ""}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-[var(--space-4)]">
        <StatCard label="Activation rate" value={`${overview.activation.ratePct}%`} />
        <StatCard
          label="Reading completion"
          value={`${overview.readingCompletion.ratePct}%`}
        />
        <StatCard label="Study conversion" value={`${overview.studyConversion.ratePct}%`} />
        <StatCard label="Total events" value={overview.totals.events} />
      </div>

      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
        Onboarding → study funnel
      </h2>
      <BarChart title="Conversion funnel" buckets={funnelBuckets} />
      <Card>
        <AdminTableWrap ariaLabel="Funnel detail (scrollable)">
          <thead>
            <tr>
              <th>Stage</th>
              <th>Users</th>
              <th>From previous</th>
              <th>From start</th>
            </tr>
          </thead>
          <tbody>
            {overview.funnel.map((s) => (
              <tr key={s.key}>
                <td>{s.label}</td>
                <td>{s.users}</td>
                <td className="muted">{s.conversionFromPrevPct}%</td>
                <td className="muted">{s.conversionFromStartPct}%</td>
              </tr>
            ))}
          </tbody>
        </AdminTableWrap>
      </Card>

      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
        Conversion rates
      </h2>
      <Card>
        <div className="stack">
          <BarChartRow
            label="Activation (onboarded → read)"
            valuenow={overview.activation.ratePct}
            renderValue={`${overview.activation.ratePct}% (${overview.activation.numerator}/${overview.activation.denominator})`}
          />
          <BarChartRow
            label="Reading completion (read → completed)"
            valuenow={overview.readingCompletion.ratePct}
            renderValue={`${overview.readingCompletion.ratePct}% (${overview.readingCompletion.numerator}/${overview.readingCompletion.denominator})`}
          />
          <BarChartRow
            label="Study conversion (saved → returned)"
            valuenow={overview.studyConversion.ratePct}
            renderValue={`${overview.studyConversion.ratePct}% (${overview.studyConversion.numerator}/${overview.studyConversion.denominator})`}
          />
        </div>
      </Card>

      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
        Weekly retention cohorts
      </h2>
      <RetentionTable cohorts={cohorts} />

      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
        Feature usage (events)
      </h2>
      <BarChart title="Feature usage" buckets={featureBuckets} />
    </section>
  );
}
