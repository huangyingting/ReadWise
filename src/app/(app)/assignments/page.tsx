import Link from "next/link";
import { BookOpenCheck } from "lucide-react";
import { requireSession } from "@/lib/session";
import { listAssignmentsForStudent } from "@/lib/classroom";
import { EmptyState, PageHeader, PageShell } from "@/components/ui";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import CompleteAssignmentButton from "@/components/teacher/CompleteAssignmentButton";
import { isAssignmentOverdue } from "@/lib/classroom/overdue";
import { formatMediumDate } from "@/lib/display-format";
import { assignmentStatusDisplay } from "@/lib/assignment-status";

type StudentAssignment = Awaited<ReturnType<typeof listAssignmentsForStudent>>[number];

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
        <AssignmentList assignments={assignments} />
      )}
    </PageShell>
  );
}

function AssignmentList({ assignments }: { assignments: StudentAssignment[] }) {
  return (
    <ul className="flex flex-col gap-[var(--space-3)]">
      {assignments.map((assignment) => (
        <AssignmentCard key={assignment.assignmentId} assignment={assignment} />
      ))}
    </ul>
  );
}

function AssignmentCard({ assignment }: { assignment: StudentAssignment }) {
  const due = formatMediumDate(assignment.dueDate);
  const completed = assignment.status === "COMPLETED";
  const overdue = isAssignmentOverdue(assignment.dueDate, assignment.status, new Date());
  const { label: statusLabel, variant: statusVariant } = assignmentStatusDisplay(assignment.status);

  return (
    <li>
      <Card>
        <CardBody className="flex items-start justify-between gap-[var(--space-4)]">
          <div className="flex flex-col gap-[var(--space-1)]">
            <Link
              href={`/reader/${assignment.articleId}`}
              className="font-medium text-text hover:underline"
            >
              {assignment.articleTitle}
            </Link>
            <p className="text-[length:var(--text-sm)] text-text-muted">
              {assignment.classroomName}
              {due ? ` · Due ${due}` : ""}
            </p>
            {assignment.instructions ? (
              <p className="text-[length:var(--text-sm)] text-text">
                {assignment.instructions}
              </p>
            ) : null}
            {assignment.feedback ? (
              <div className="flex flex-col gap-[var(--space-1)]">
                <span className="text-[length:var(--text-xs)] font-semibold text-text-muted uppercase tracking-wide">
                  Teacher feedback
                </span>
                <p className="text-[length:var(--text-sm)] text-text">
                  {assignment.feedback}
                </p>
              </div>
            ) : null}
            <div className="mt-1 flex flex-wrap gap-[var(--space-2)]">
              <Badge variant={statusVariant} className="w-fit">
                {statusLabel}
                {completed && assignment.quizScore != null
                  ? ` · quiz ${assignment.quizScore}%`
                  : ""}
              </Badge>
              {overdue ? (
                <Badge variant="danger" className="w-fit">
                  Overdue
                </Badge>
              ) : null}
            </div>
          </div>
          <CompleteAssignmentButton
            assignmentId={assignment.assignmentId}
            completed={completed}
            quizScore={assignment.quizScore}
          />
        </CardBody>
      </Card>
    </li>
  );
}
