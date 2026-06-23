import { NextResponse } from "next/server";
import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { queryInt, queryString } from "@/lib/validation";
import {
  getAnalyticsOverview,
  getRetentionCohorts,
  resolveTimeRange,
  type AnalyticsSegment,
} from "@/lib/analytics-queries";

type ExportQuery = {
  format: "csv" | "json";
  days: number;
  segment?: AnalyticsSegment;
};

function parseQuery(params: URLSearchParams): ExportQuery {
  const format = queryString(params, "format", "json") === "csv" ? "csv" : "json";
  const days = queryInt(params, "days", { fallback: 30, min: 1, max: 365 });
  const level = queryString(params, "level").trim();
  const topic = queryString(params, "topic").trim();
  const segment: AnalyticsSegment | undefined =
    level || topic ? { level: level || null, topic: topic || null } : undefined;
  return { format, days, segment };
}

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

/**
 * Exports the product analytics aggregates (funnel / conversion / feature usage
 * / retention cohorts) as CSV or JSON for the requested time range + segment.
 * Gated on `analytics.view`.
 */
export const GET = createCapabilityHandler(
  CAPABILITIES.analyticsView,
  { query: (params) => ({ ok: true, value: parseQuery(params) }) },
  async ({ query }) => {
    const { since, until, days } = resolveTimeRange(query.days);
    const [overview, cohorts] = await Promise.all([
      getAnalyticsOverview({ since, until, segment: query.segment }),
      getRetentionCohorts({ weeks: 8, segment: query.segment }),
    ]);

    if (query.format === "json") {
      return NextResponse.json({
        range: { since: since.toISOString(), until: until.toISOString(), days },
        segment: query.segment ?? null,
        overview,
        retention: cohorts,
      });
    }

    const rows: (string | number)[][] = [];
    rows.push(["section", "key", "label", "value", "extra"]);
    for (const s of overview.funnel) {
      rows.push(["funnel", s.key, s.label, s.users, `${s.conversionFromStartPct}%`]);
    }
    rows.push([
      "conversion",
      "activation",
      "Onboarded → read",
      `${overview.activation.ratePct}%`,
      `${overview.activation.numerator}/${overview.activation.denominator}`,
    ]);
    rows.push([
      "conversion",
      "reading_completion",
      "Read → completed",
      `${overview.readingCompletion.ratePct}%`,
      `${overview.readingCompletion.numerator}/${overview.readingCompletion.denominator}`,
    ]);
    rows.push([
      "conversion",
      "study_conversion",
      "Saved → returned",
      `${overview.studyConversion.ratePct}%`,
      `${overview.studyConversion.numerator}/${overview.studyConversion.denominator}`,
    ]);
    for (const f of overview.featureUsage) {
      rows.push(["feature_usage", f.type, f.label, f.events, f.users]);
    }
    for (const c of cohorts) {
      for (const cell of c.cells) {
        rows.push([
          "retention",
          c.cohortWeek,
          `week+${cell.offset}`,
          `${cell.pct}%`,
          `${cell.count}/${c.size}`,
        ]);
      }
    }

    const csv = toCsv(rows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="analytics-${days}d.csv"`,
      },
    });
  },
);
