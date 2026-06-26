import { NextResponse } from "next/server";
import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import {
  getAnalyticsOverview,
  getRetentionCohorts,
  resolveTimeRange,
  parseAnalyticsQuery,
} from "@/lib/analytics/queries";
import { csvRows } from "@/lib/csv";

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
        format: params.get("format") === "csv" ? ("csv" as const) : ("json" as const),
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

    const csv = csvRows(rows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="analytics-${days}d.csv"`,
      },
    });
  },
);
