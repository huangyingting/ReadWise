/**
 * Classroom Reading Skills matrix card (#1302): quiz performance by reading
 * skill across enrolled students, with CSV export. Org admins (aggregate
 * view) see class totals only.
 */
import Link from "next/link";
import { Download } from "lucide-react";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardMeta,
  CardTitle,
  TableSurface,
  buttonVariants,
} from "@/components/ui";
import { readingSkillLabel, shortStandardCode } from "@/lib/learning/reading-skills";
import { skillCellPercent, type ClassroomSkillMatrix, type SkillCell } from "@/lib/classroom/skills";

const MASTERED_PERCENT = 80;
const DEVELOPING_PERCENT = 50;

function SkillCellBadge({ cell }: { cell: SkillCell | undefined }) {
  const pct = skillCellPercent(cell);
  if (pct === null) {
    return <span className="text-text-muted" aria-label="No data">—</span>;
  }
  const variant = pct >= MASTERED_PERCENT ? "success" : pct >= DEVELOPING_PERCENT ? "warning" : "danger";
  return (
    <Badge variant={variant} title={`${cell!.correct} of ${cell!.total} correct`}>
      {pct}%
    </Badge>
  );
}

export default function ReadingSkillsCard({
  classroomId,
  matrix,
}: {
  classroomId: string;
  matrix: ClassroomSkillMatrix;
}) {
  const exportHref = `/api/classrooms/${encodeURIComponent(classroomId)}/skills?format=csv`;
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-[var(--space-3)]">
        <div>
          <CardTitle>Reading skills</CardTitle>
          <CardMeta>
            Percent correct by skill on each student’s latest quiz for assigned articles.
          </CardMeta>
        </div>
        {matrix.attemptCount > 0 ? (
          <Link href={exportHref} prefetch={false} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Download size={14} aria-hidden />
            Export CSV
          </Link>
        ) : null}
      </CardHeader>
      <CardBody>
        {matrix.attemptCount === 0 ? (
          <p className="m-0 text-[length:var(--type-ui)] text-text-muted">
            No graded quizzes yet. Skill results appear once students take the quiz on an assigned article.
          </p>
        ) : (
          <TableSurface density="compact">
            <table className="admin-table w-full table-auto">
              <caption className="sr-only">Reading skills by student</caption>
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  {matrix.skills.map((skill) => (
                    <th key={skill} scope="col" title={readingSkillLabel(skill)}>
                      <span className="block">{shortStandardCode(skill)}</span>
                      <span className="block font-normal text-text-muted">{readingSkillLabel(skill)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(matrix.students ?? []).map((student) => (
                  <tr key={student.studentId}>
                    <th scope="row" className="font-medium">
                      {student.name ?? student.email ?? "Student"}
                    </th>
                    {matrix.skills.map((skill) => (
                      <td key={skill}>
                        <SkillCellBadge cell={student.cells[skill]} />
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th scope="row">Class</th>
                  {matrix.skills.map((skill) => (
                    <td key={skill}>
                      <SkillCellBadge cell={matrix.classTotals[skill]} />
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </TableSurface>
        )}
        {matrix.students === null && matrix.attemptCount > 0 ? (
          <p className="mt-[var(--space-3)] mb-0 text-[length:var(--type-label)] text-text-muted">
            Individual student results are hidden in the aggregate view.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
