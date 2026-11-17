import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { getScopedClassroomSkills } from "@/lib/analytics/classroom-access";
import { skillCellPercent, type ClassroomSkillMatrix, type SkillCell } from "@/lib/classroom/skills";
import { readingSkillLabel, standardCodeFor } from "@/lib/learning/reading-skills";
import { csvRows } from "@/lib/csv";

type CsvCell = string | number;

function parseQuery(params: URLSearchParams) {
  return { ok: true as const, value: { format: params.get("format") === "csv" ? "csv" : "json" } };
}

function cellText(cell: SkillCell | undefined): string {
  const pct = skillCellPercent(cell);
  return pct === null ? "" : `${pct}% (${cell!.correct}/${cell!.total})`;
}

function buildCsv(matrix: ClassroomSkillMatrix): CsvCell[][] {
  const header: CsvCell[] = [
    "student",
    ...matrix.skills.map((skill) => `${standardCodeFor(skill)} ${readingSkillLabel(skill)}`),
  ];
  const rows: CsvCell[][] = [header];
  for (const student of matrix.students ?? []) {
    rows.push([
      student.name ?? student.email ?? student.studentId,
      ...matrix.skills.map((skill) => cellText(student.cells[skill])),
    ]);
  }
  rows.push(["Class", ...matrix.skills.map((skill) => cellText(matrix.classTotals[skill]))]);
  return rows;
}

/**
 * Classroom reading-skills matrix (#1302) as JSON or CSV (`?format=csv`).
 * Teachers and system admins get per-student rows; org admins get class
 * totals only (same visibility rules as classroom analytics).
 */
export const GET = createHandler({ params: idParams, query: parseQuery }, async ({ params, query, session }) => {
  const { role, matrix } = await getScopedClassroomSkills({ classroomId: params.id, viewer: session.user });
  if (query.format === "json") {
    return NextResponse.json({ role, matrix });
  }
  return new NextResponse(csvRows(buildCsv(matrix)), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="classroom-${params.id}-reading-skills.csv"`,
    },
  });
});
