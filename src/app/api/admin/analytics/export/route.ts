import { NextResponse } from "next/server";
import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import {
  type AnalyticsOverview,
  type AnalyticsSegment,
  type RetentionCohort,
  getAnalyticsOverview,
  getRetentionCohorts,
  resolveTimeRange,
  parseAnalyticsQuery,
} from "@/lib/analytics/queries";
import { csvRows } from "@/lib/csv";

type ExportFormat = "csv" | "json";
type CsvCell = string | number;
type CsvRow = CsvCell[];

const RETENTION_WEEKS = 8;
const CSV_HEADERS: CsvRow = ["section", "key", "label", "value", "extra"];

function parseFormat(params: URLSearchParams): ExportFormat {
  return params.get("format") === "csv" ? "csv" : "json";
}

function buildJsonPayload({
  since,
  until,
  days,
  segment,
  overview,
  cohorts,
}: {
  since: Date;
  until: Date;
  days: number;
  segment: AnalyticsSegment | undefined;
  overview: AnalyticsOverview;
  cohorts: RetentionCohort[];
}) {
  return {
    range: { since: since.toISOString(), until: until.toISOString(), days },
    segment: segment ?? null,
    overview,
    retention: cohorts,
  };
}

function appendConversionRows(rows: CsvRow[], overview: AnalyticsOverview) {
  rows.push(
    [
      "conversion",
      "activation",
      "Onboarded → read",
      `${overview.activation.ratePct}%`,
      `${overview.activation.numerator}/${overview.activation.denominator}`,
    ],
    [
      "conversion",
      "reading_completion",
      "Read → completed",
      `${overview.readingCompletion.ratePct}%`,
      `${overview.readingCompletion.numerator}/${overview.readingCompletion.denominator}`,
    ],
    [
      "conversion",
      "study_conversion",
      "Saved → returned",
      `${overview.studyConversion.ratePct}%`,
      `${overview.studyConversion.numerator}/${overview.studyConversion.denominator}`,
    ],
  );
}

function buildCsvRows(overview: AnalyticsOverview, cohorts: RetentionCohort[]): CsvRow[] {
  const rows: CsvRow[] = [CSV_HEADERS];
  for (const s of overview.funnel) {
    rows.push(["funnel", s.key, s.label, s.users, `${s.conversionFromStartPct}%`]);
  }
  appendConversionRows(rows, overview);
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
  return rows;
}

function csvResponse(rows: CsvRow[], days: number): NextResponse {
  return new NextResponse(csvRows(rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="analytics-${days}d.csv"`,
    },
  });
}

/**
 * Exports the product analytics aggregates (funnel / conversion / feature usage
 * / retention cohorts) as CSV or JSON for the requested time range + segment.
 * Gated on `analytics.view`.
 */
export const GET = createCapabilityHandler(
  CAPABILITIES.analyticsView,
  {
    query: (params) => ({
      ok: true,
      value: {
       format: parseFormat(params),
        ...parseAnalyticsQuery({
          days: params.get("days"),
          level: params.get("level"),
          topic: params.get("topic"),
        }),
      },
    }),
  },
  async ({ query }) => {
    const { since, until, days } = resolveTimeRange(query.days);
    const [overview, cohorts] = await Promise.all([
      getAnalyticsOverview({ since, until, segment: query.segment }),
      getRetentionCohorts({ weeks: RETENTION_WEEKS, segment: query.segment }),
    ]);

    if (query.format === "json") {
      return NextResponse.json(
        buildJsonPayload({ since, until, days, segment: query.segment, overview, cohorts }),
      );
    }

    return csvResponse(buildCsvRows(overview, cohorts), days);
  },
);
