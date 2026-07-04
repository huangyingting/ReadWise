import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import {
  getScopedClassroomAnalytics,
  parseClassroomAnalyticsFilters,
} from "@/lib/analytics/classroom-access";
import { csvRows } from "@/lib/csv";

type ExportFormat = "csv" | "json";
type CsvCell = string | number;
type CsvRow = CsvCell[];

const CSV_HEADERS: CsvRow = ["section", "key", "label", "value", "extra"];

function parseFormat(params: URLSearchParams): ExportFormat {
  return params.get("format") === "csv" ? "csv" : "json";
}

function parseExportQuery(params: URLSearchParams) {
  return {
    ok: true as const,
    value: {
      format: parseFormat(params),
      filters: parseClassroomAnalyticsFilters(params),
    },
  };
}

function dateCell(date: Date | string | null): string {
  if (!date) return "";
  return new Date(date).toISOString();
}

function buildCsvRows(
  payload: Awaited<ReturnType<typeof getScopedClassroomAnalytics>>,
): CsvRow[] {
  const { role, analytics } = payload;
  const rows: CsvRow[] = [CSV_HEADERS];
  rows.push(
    ["classroom", analytics.classroomId, "Classroom", analytics.classroomName, role],
    ["summary", "students", "Students", analytics.studentCount, ""],
    ["summary", "assignments", "Assignments", analytics.assignmentCount, ""],
    ["summary", "completion", "Completion", `${analytics.completionRate}%`, `${analytics.totalCompleted}/${analytics.totalExpected}`],
    ["summary", "average_quiz", "Average quiz", analytics.averageQuizScore ?? "", ""],
  );

  for (const assignment of analytics.perAssignment) {
    rows.push([
      "assignment",
      assignment.assignmentId,
      assignment.articleTitle,
      `${assignment.completionRate}%`,
      `${assignment.completed}/${assignment.assigned} completed; ${assignment.inProgress} in progress; quiz ${assignment.averageQuizScore ?? ""}`,
    ]);
  }

  if (!analytics.redacted) {
    for (const student of analytics.perStudent) {
      rows.push([
        "student",
        student.studentId,
        student.name ?? student.email ?? student.studentId,
        `${student.completionRate}%`,
        `${student.completed}/${student.total} completed; quiz ${student.averageQuizScore ?? ""}`,
      ]);
    }

    for (const row of analytics.drilldown?.rows ?? []) {
      rows.push([
        "drilldown",
        `${row.assignmentId}:${row.studentId}`,
        `${row.articleTitle} · ${row.name ?? row.email ?? row.studentId}`,
        row.status,
        `quiz ${row.quizScore ?? ""}; due ${dateCell(row.dueDate)}; completed ${dateCell(row.completedAt)}`,
      ]);
    }
  }

  return rows;
}

function csvResponse(rows: CsvRow[], classroomId: string): NextResponse {
  return new NextResponse(csvRows(rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="classroom-${classroomId}-analytics.csv"`,
    },
  });
}

/**
 * Exports classroom analytics as CSV/JSON. The same teacher/org-admin/system
 * admin visibility rules as the classroom analytics endpoint are applied before
 * serializing, so aggregate-only org admins never receive student/drilldown rows.
 */
export const GET = createHandler(
  { params: idParams, query: parseExportQuery },
  async ({ params, query, session }) => {
    const payload = await getScopedClassroomAnalytics({
      classroomId: params.id,
      viewer: session.user,
      filters: query.filters,
    });

    if (query.format === "json") {
      return NextResponse.json({
        role: payload.role,
        filters: query.filters,
        analytics: payload.analytics,
      });
    }

    return csvResponse(buildCsvRows(payload), params.id);
  },
);
