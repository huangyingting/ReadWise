import Link from "next/link";
import { BookOpenCheck } from "lucide-react";
import { requireSession } from "@/lib/session";
import { listAssignmentsForStudent } from "@/lib/classroom";
import { EmptyState, PageHeader, PageShell } from "@/components/ui";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import CompleteAssignmentButton from "@/components/teacher/CompleteAssignmentButton";
import { formatMediumDate } from "@/lib/display-format";

/**
 * Student assignments (RW-061). Shows the signed-in student's assigned readings
 * across all their classrooms, with ONLY their own completion status — never a
 * peer's. Additive: a learner in no classroom simply sees an empty state.
 */
export default async function AssignmentsPage() {
  const session = await requireSession("/assignments");
  const assignments = await listAssignmentsForStudent(session.user.id);

  return (
    <PageShell variant="narrow">
      <PageHeader
        title="Assignments"
        description="Readings your teachers have assigned to you."
      />

      {assignments.length === 0 ? (
        <EmptyState
          icon={BookOpenCheck}
          title="No assignments yet"
          description="When a teacher assigns you a reading, it'll show up here."
        />
      ) : (
        <ul className="flex flex-col gap-[var(--space-3)]">
          {assignments.map((a) => {
            const due = formatMediumDate(a.dueDate);
            const completed = a.status === "COMPLETED";
            return (
              <li key={a.assignmentId}>
                <Card>
                  <CardBody className="flex items-start justify-between gap-[var(--space-4)]">
                    <div className="flex flex-col gap-[var(--space-1)]">
                      <Link
                        href={`/reader/${a.articleId}`}
                        className="font-medium text-text hover:underline"
                      >
                        {a.articleTitle}
                      </Link>
                      <p className="text-[length:var(--text-sm)] text-text-muted">
                        {a.classroomName}
                        {due ? ` · Due ${due}` : ""}
                      </p>
                      {a.instructions ? (
                        <p className="text-[length:var(--text-sm)] text-text">
                          {a.instructions}
                        </p>
                      ) : null}
                      {completed ? (
                        <Badge variant="success" className="mt-1 w-fit">
                          Completed
                          {a.quizScore == null ? "" : ` · quiz ${a.quizScore}%`}
                        </Badge>
                      ) : null}
                    </div>
                    <CompleteAssignmentButton
                      assignmentId={a.assignmentId}
                      completed={completed}
                    />
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}
