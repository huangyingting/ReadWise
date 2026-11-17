/**
 * Classroom Text Set units (#1308): unit-level progress for each text set
 * assigned to the classroom. Renders nothing until a set is assigned.
 */
import Link from "next/link";
import { Badge, Card, CardBody, CardHeader, CardMeta, CardTitle } from "@/components/ui";
import type { ClassroomTextSetUnit } from "@/lib/classroom/text-sets";

export default function TextSetUnitsCard({ units }: { units: ClassroomTextSetUnit[] }) {
  if (units.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Text set units</CardTitle>
        <CardMeta>Progress across each assigned text set.</CardMeta>
      </CardHeader>
      <CardBody>
        <ul className="m-0 flex list-none flex-col gap-[var(--space-4)] p-0">
          {units.map((unit) => (
            <li key={unit.textSetId} className="flex flex-col gap-[var(--space-1)]">
              <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
                <Link
                  href={`/teacher/text-sets/${encodeURIComponent(unit.textSetId)}`}
                  className="font-medium text-text hover:underline"
                >
                  {unit.title}
                </Link>
                <Badge variant={unit.completionPercent >= 100 ? "success" : "neutral"}>
                  {unit.completionPercent}% complete
                </Badge>
              </div>
              {unit.essentialQuestion ? (
                <p className="m-0 text-[length:var(--type-ui)] text-text-muted">{unit.essentialQuestion}</p>
              ) : null}
              <p className="m-0 text-[length:var(--type-label)] text-text-muted">
                {unit.articleCount} {unit.articleCount === 1 ? "article" : "articles"} · {unit.studentsFinished} of{" "}
                {unit.studentCount} students finished
              </p>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
