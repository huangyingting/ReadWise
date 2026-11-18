import Link from "next/link";
import { BookOpenCheck } from "lucide-react";
import { requireSession } from "@/lib/session";
import { groupAssignmentsByTextSet, listAssignmentsForStudent } from "@/lib/classroom";
import { EmptyState, PageHeader, PageShell, buttonVariants } from "@/components/ui";
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
        actions={
          <Link href="/join-class" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Join a class
          </Link>
        }
      />

      {assignments.length === 0 ? (
        <EmptyState
          icon={BookOpenCheck}
          title="No assignments yet"
          description="When a teacher assigns you a reading, it'll show up here. Got a class code from your teacher?"
          action={{ href: "/join-class", label: "Join a class" }}
        />
      ) : (
        <AssignmentList assignments={assignments} />
      )}
    </PageShell>
  );
}

function AssignmentList({ assignments }: { assignments: StudentAssignment[] }) {
  const { units, standalone } = groupAssignmentsByTextSet(assignments);
  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      {units.map((unit) => (
        <section key={unit.key} aria-labelledby={`unit-${unit.key}`} className="flex flex-col gap-[var(--space-3)]">
          <div className="flex flex-col gap-[var(--space-1)]">
            <div className="flex flex-wrap items-center gap-[var(--space-2)]">
              <h2
                id={`unit-${unit.key}`}
                className="m-0 font-[family-name:var(--font-display)] text-[length:var(--type-section-title)] font-semibold text-text"
              >
                {unit.textSet.title}
              </h2>
              <Badge variant={unit.completed === unit.assignments.length ? "success" : "neutral"}>
                {unit.completed} of {unit.assignments.length} done
              </Badge>
            </div>
            <p className="m-0 text-[length:var(--type-ui)] text-text-muted">
              Text set · {unit.classroomName}
            </p>
            {unit.textSet.essentialQuestion ? (
              <p className="m-0 text-[length:var(--type-body)] text-text">
                <span className="font-semibold">Essential question: </span>
                {unit.textSet.essentialQuestion}
              </p>
            ) : null}
          </div>
          <ol className="m-0 flex list-none flex-col gap-[var(--space-3)] p-0">
            {unit.assignments.map((assignment) => (
              <AssignmentCard key={assignment.assignmentId} assignment={assignment} />
            ))}
          </ol>
        </section>
      ))}
      {standalone.length > 0 ? (
        <section aria-label={units.length > 0 ? "Other assignments" : "Assignments"} className="flex flex-col gap-[var(--space-3)]">
          {units.length > 0 ? (
            <h2 className="m-0 font-[family-name:var(--font-display)] text-[length:var(--type-section-title)] font-semibold text-text">
              Other assignments
            </h2>
          ) : null}
          <ul className="m-0 flex list-none flex-col gap-[var(--space-3)] p-0">
            {standalone.map((assignment) => (
              <AssignmentCard key={assignment.assignmentId} assignment={assignment} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function AssignmentCard({ assignment }: { assignment: StudentAssignment }) {
  const due = formatMediumDate(assignment.dueDate);
  const completed = assignment.status === "COMPLETED";
  const overdue = isAssignmentOverdue(assignment.dueDate, assignment.status, new Date());
  const { label: statusLabel, variant: statusVariant } = assignmentStatusDisplay(assignment.status);
  const displayTitle = assignment.title ?? assignment.articleTitle;
  const scoreLabel = assignment.pointsAwarded != null
    ? `Score: ${assignment.pointsAwarded}${assignment.points != null ? ` / ${assignment.points}` : ""} points`
    : assignment.points != null
      ? `Worth ${assignment.points} points`
      : null;

  return (
    <li>
      <Card>
        <CardBody className="flex items-start justify-between gap-[var(--space-4)]">
          <div className="flex flex-col gap-[var(--space-1)]">
            <Link
              href={`/reader/${assignment.articleId}`}
              className="font-medium text-text hover:underline"
            >
              {displayTitle}
            </Link>
            {assignment.title ? (
              <p className="m-0 text-[length:var(--text-xs)] text-text-muted">
                Article: {assignment.articleTitle}
              </p>
            ) : null}
            <p className="text-[length:var(--text-sm)] text-text-muted">
              {assignment.classroomName}
              {due ? ` · Due ${due}` : ""}
            </p>
            {assignment.instructions ? (
              <p className="whitespace-pre-line text-[length:var(--type-ui)] text-text">
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
              {scoreLabel ? (
                <Badge variant="neutral" className="w-fit">
                  {scoreLabel}
                </Badge>
              ) : null}
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
