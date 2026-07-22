/**
 * Reader assignment banner (RW-061 PR2).
 *
 * Rendered above the article body in the reader when the signed-in student has
 * one or more classroom assignments for the current article. Shows classroom
 * name, due date, overdue status, instructions, status chip, and the
 * CompleteAssignmentButton affordance for manual completion/undo.
 *
 * This is a server component — no client boundary needed; CompleteAssignmentButton
 * is a client island embedded within.
 */
import type { StudentAssignment } from "@/lib/classroom";
import { isAssignmentOverdue } from "@/lib/classroom/overdue";
import { formatMediumDate } from "@/lib/display-format";
import { assignmentStatusDisplay } from "@/lib/assignment-status";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import CompleteAssignmentButton from "@/components/teacher/CompleteAssignmentButton";

function AssignmentItem({ assignment }: { assignment: StudentAssignment }) {
  const due = formatMediumDate(assignment.dueDate);
  const overdue = isAssignmentOverdue(assignment.dueDate, assignment.status, new Date());
  const { label: statusLabel, variant: statusVariant } = assignmentStatusDisplay(
    assignment.status,
  );

  return (
    <div className="flex items-start justify-between gap-[var(--space-4)]">
      <div className="flex flex-col gap-[var(--space-1)] min-w-0">
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <span className="font-semibold text-text text-[length:var(--text-sm)]">
            {assignment.classroomName}
          </span>
          {due ? (
            <span className="text-[length:var(--text-xs)] text-text-muted">
              Due {due}
            </span>
          ) : null}
          <Badge variant={statusVariant}>{statusLabel}</Badge>
          {overdue ? <Badge variant="danger">Overdue</Badge> : null}
        </div>
        {assignment.instructions ? (
          <p className="text-[length:var(--text-sm)] text-text m-0">
            {assignment.instructions}
          </p>
        ) : null}
        {assignment.feedback ? (
          <div className="flex flex-col gap-[var(--space-1)]">
            <span className="text-[length:var(--text-xs)] font-semibold text-text-muted uppercase tracking-wide">
              Teacher feedback
            </span>
            <p className="text-[length:var(--text-sm)] text-text m-0">
              {assignment.feedback}
            </p>
          </div>
        ) : null}
      </div>
      <div className="shrink-0">
        <CompleteAssignmentButton
          assignmentId={assignment.assignmentId}
          completed={assignment.status === "COMPLETED"}
          quizScore={assignment.quizScore}
        />
      </div>
    </div>
  );
}

interface AssignmentBannerProps {
  assignments: StudentAssignment[];
}

/**
 * Renders a banner for each classroom assignment tied to this article.
 * Returns null when the student has no assignments for this article.
 */
export default function AssignmentBanner({ assignments }: AssignmentBannerProps) {
  if (assignments.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Assignment"
      className="mb-[var(--space-4)]"
    >
      <Card>
        <CardBody className="flex flex-col gap-[var(--space-3)]">
          <p className="text-[length:var(--text-xs)] font-semibold uppercase tracking-wide text-text-muted m-0">
            Assignment
          </p>
          {assignments.map((a) => (
            <AssignmentItem key={a.assignmentId} assignment={a} />
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
