import type { ReactNode } from "react";
import Link from "next/link";
import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import {
  getAnalyticsOverview,
  getRetentionCohorts,
  resolveTimeRange,
  TIME_RANGE_PRESETS,
  parseAnalyticsQuery,
} from "@/lib/analytics/queries";
import { StatCard } from "@/components/analytics/StatCard";
import { BarChart, BarChartRow, AdminTableWrap } from "@/components/admin";
import { AnalyticsTabs } from "@/components/admin/AnalyticsTabs";
import { RetentionTable } from "@/components/admin/RetentionTable";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Button, buttonVariants } from "@/components/ui/Button";
import { ENGLISH_LEVELS } from "@/lib/option-registries";
import { CATEGORIES } from "@/lib/categories";

const RETENTION_COHORT_WEEKS = 8;
const FILTER_LABEL_CLASS = "flex flex-col gap-[var(--space-1)] text-[length:var(--text-sm)]";
const SECTION_HEADING_CLASS =
  "font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text";

const EXPORT_LINKS = [
  { format: "csv", label: "Export CSV" },
  { format: "json", label: "Export JSON" },
] as const;

type SearchParams = {
  days?: string;
  level?: string;
  topic?: string;
};

type AnalyticsOverview = Awaited<ReturnType<typeof getAnalyticsOverview>>;
type ExportFormat = (typeof EXPORT_LINKS)[number]["format"];

function toFunnelBuckets(funnel: AnalyticsOverview["funnel"]) {
  return funnel.map((step) => ({
    key: step.key,
    label: step.label,
    count: step.users,
  }));
}

function toFeatureBuckets(featureUsage: AnalyticsOverview["featureUsage"]) {
  return featureUsage.map((feature) => ({
    key: feature.type,
    label: feature.label,
    count: feature.events,
  }));
}

function buildExportParams(resolvedDays: number, level: string, topic: string) {
  const params = new URLSearchParams();
  params.set("days", String(resolvedDays));
  if (level) params.set("level", level);
  if (topic) params.set("topic", topic);
  return params;
}

function getExportHref(format: ExportFormat, params: URLSearchParams): string {
  return `/api/admin/analytics/export?format=${format}&${params.toString()}`;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className={SECTION_HEADING_CLASS}>{children}</h2>;
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireCapability(CAPABILITIES.analyticsView, "/admin/analytics");

  const sp = await searchParams;
  const { days, segment } = parseAnalyticsQuery(sp);
  const level = segment?.level ?? "";
  const topic = segment?.topic ?? "";

  const { since, until, days: resolvedDays } = resolveTimeRange(days);

  const [overview, cohorts] = await Promise.all([
    getAnalyticsOverview({ since, until, segment }),
    getRetentionCohorts({ weeks: RETENTION_COHORT_WEEKS, segment }),
  ]);

  const funnelBuckets = toFunnelBuckets(overview.funnel);
  const featureBuckets = toFeatureBuckets(overview.featureUsage);
  const exportParams = buildExportParams(resolvedDays, level, topic);

  return (
    <section className="stack">
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
        <h1 className="m-0 text-[length:var(--text-3xl)] font-[family-name:var(--font-display)] font-bold text-text">
          Analytics
        </h1>
        <AnalyticsTabs active="product" />
      </div>

      <form method="get" className="flex flex-wrap items-end gap-[var(--space-2)]">
        <label className={FILTER_LABEL_CLASS}>
          <span className="muted">Time range</span>
          <Select name="days" defaultValue={String(resolvedDays)} selectSize="md" className="w-auto">
            {TIME_RANGE_PRESETS.map((p) => (
              <option key={p.days} value={p.days}>
                {p.label}
              </option>
            ))}
          </Select>
        </label>
        <label className={FILTER_LABEL_CLASS}>
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
        <label className={FILTER_LABEL_CLASS}>
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
        {EXPORT_LINKS.map((link) => (
          <Link
            key={link.format}
            className={buttonVariants({ variant: "outline", size: "md" })}
            href={getExportHref(link.format, exportParams)}
            prefetch={false}
          >
            {link.label}
          </Link>
        ))}
      </form>

      <p className="muted m-0">
        {formatDate(since)} → {formatDate(until)} ·{" "}
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

      <SectionHeading>Onboarding → study funnel</SectionHeading>
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

      <SectionHeading>Conversion rates</SectionHeading>
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

      <SectionHeading>Weekly retention cohorts</SectionHeading>
      <RetentionTable cohorts={cohorts} />

      <SectionHeading>Feature usage (events)</SectionHeading>
      <BarChart title="Feature usage" buckets={featureBuckets} />
    </section>
  );
}
