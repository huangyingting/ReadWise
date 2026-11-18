import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/session";
import { listAssignmentSubmissions } from "@/lib/classroom/writing";
import { WRITE_STATUS_LABELS } from "@/lib/classroom/writing-rubric";
import { formatMediumDate } from "@/lib/display-format";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardMeta,
  CardTitle,
  EmptyState,
  PageHeader,
  PageShell,
  buttonVariants,
} from "@/components/ui";
import WriteReviewForm from "@/components/teacher/WriteReviewForm";

/**
 * Written responses for one assignment (#1305), for the classroom's teacher,
 * org admin, or a system admin. Drafts are never shown; independent writing
 * never appears here.
 */
export default async function AssignmentResponsesPage({
  params,
}: {
  params: Promise<{ id: string; assignmentId: string }>;
}) {
  const { id, assignmentId } = await params;
  const session = await requireSession(
    `/teacher/classrooms/${encodeURIComponent(id)}/assignments/${encodeURIComponent(assignmentId)}/responses`,
  );
  const result = await listAssignmentSubmissions(assignmentId, session.user);
  if (!result.ok) {
    if (result.status === 403) redirect("/forbidden");
    notFound();
  }
  if (result.assignment.classroomId !== id) notFound();
  const { assignment, submissions } = result;

  return (
    <PageShell variant="narrow">
      <PageHeader
        title="Written responses"
        description={`${assignment.articleTitle} · ${assignment.classroomName}`}
        actions={
          <Link href={`/teacher/classrooms/${encodeURIComponent(id)}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            <ArrowLeft size={14} aria-hidden />
            Back to classroom
          </Link>
        }
      />
      <Card className="mb-[var(--space-5)]">
        <CardHeader>
          <CardTitle>Prompt</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="m-0 text-[length:var(--type-body)] text-text">{assignment.prompt}</p>
        </CardBody>
      </Card>
      {submissions.length === 0 ? (
        <EmptyState title="No responses yet" description="Submitted responses appear here. Drafts stay private until students submit." />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-[var(--space-4)] p-0">
          {submissions.map((submission) => {
            const studentLabel = submission.student.name ?? submission.student.email ?? "Student";
            return (
              <li key={submission.id}>
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                      <CardTitle>{studentLabel}</CardTitle>
                      <Badge
                        variant={
                          submission.status === "GRADED"
                            ? "success"
                            : submission.status === "NEEDS_REVISION"
                              ? "warning"
                              : "primary"
                        }
                      >
                        {WRITE_STATUS_LABELS[submission.status]}
                      </Badge>
                    </div>
                    <CardMeta>
                      {submission.status === "NEEDS_REVISION" ? "Revision in progress" : `${submission.wordCount} words`}
                      {submission.submittedAt ? ` · submitted ${formatMediumDate(submission.submittedAt)}` : ""}
                      {submission.revisionCount > 0 ? ` · revision ${submission.revisionCount}` : ""}
                    </CardMeta>
                  </CardHeader>
                  <CardBody className="flex flex-col gap-[var(--space-4)]">
                    {submission.prompt !== assignment.prompt ? (
                      <p className="m-0 text-[length:var(--type-ui)] text-text-muted">
                        <span className="font-semibold">Answered prompt: </span>
                        {submission.prompt}
                      </p>
                    ) : null}
                    {submission.status === "NEEDS_REVISION" ? (
                      <p className="m-0 text-[length:var(--type-ui)] text-text-muted">
                        Waiting for the student to revise. Their revision stays private until they resubmit.
                      </p>
                    ) : (
                      <>
                        <p className="m-0 whitespace-pre-line text-[length:var(--type-body)] text-text">{submission.body}</p>
                        <WriteReviewForm
                          submissionId={submission.id}
                          studentLabel={studentLabel}
                          initialScores={submission.rubricScores}
                          initialFeedback={submission.teacherFeedback}
                        />
                      </>
                    )}
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
