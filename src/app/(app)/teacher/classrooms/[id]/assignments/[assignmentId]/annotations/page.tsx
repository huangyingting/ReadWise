import Link from "next/link";
import { isArticleLevelKey, readingLevelLabel } from "@/lib/article-levels/levels";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/session";
import { getAssignmentAnnotationReview, type ReviewResponseRow } from "@/lib/classroom/annotations";
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

function studentLabel(row: ReviewResponseRow) {
  return row.student.name ?? row.student.email ?? "Student";
}

function ResponseList({ rows, label }: { rows: ReviewResponseRow[]; label: string }) {
  if (rows.length === 0) {
    return <p className="m-0 text-[length:var(--type-ui)] text-text-muted">No student replies yet.</p>;
  }
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col gap-[var(--space-3)] p-0">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-[var(--space-1)] border-t border-border pt-[var(--space-3)] first:border-0 first:pt-0">
          <span className="flex flex-wrap items-center gap-[var(--space-2)] text-[length:var(--type-ui)]">
            <span className="font-semibold text-text">{studentLabel(row)}</span>
            {row.quote ? <Badge variant="primary">Evidence</Badge> : null}
            {isArticleLevelKey(row.levelKey) ? <Badge variant="neutral">{readingLevelLabel(row.levelKey)}</Badge> : null}
            <span className="text-text-muted">{formatMediumDate(row.createdAt)}</span>
          </span>
          {row.quote ? (
            <blockquote className="m-0 border-l-2 border-border pl-[var(--space-3)] text-[length:var(--type-ui)] text-text-muted">
              &ldquo;{row.quote}&rdquo;
            </blockquote>
          ) : null}
          {row.body ? <p className="m-0 whitespace-pre-line text-[length:var(--type-body)] text-text">{row.body}</p> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Guided prompts and student replies/evidence for one assignment (#1307),
 * for the classroom's teacher, org admin, or a system admin. Students'
 * personal highlights never appear here — only what they explicitly shared.
 */
export default async function AssignmentAnnotationsPage({
  params,
}: {
  params: Promise<{ id: string; assignmentId: string }>;
}) {
  const { id, assignmentId } = await params;
  const session = await requireSession(
    `/teacher/classrooms/${encodeURIComponent(id)}/assignments/${encodeURIComponent(assignmentId)}/annotations`,
  );
  const result = await getAssignmentAnnotationReview(assignmentId, session.user);
  if (!result.ok) {
    if (result.status === 403) redirect("/forbidden");
    notFound();
  }
  if (result.review.assignment.classroomId !== id) notFound();
  const { assignment, guides, evidence } = result.review;

  return (
    <PageShell variant="narrow">
      <PageHeader
        title="Prompts & evidence"
        description={`${assignment.articleTitle} · ${assignment.classroomName}`}
        actions={
          <>
            <Link href={`/reader/${encodeURIComponent(assignment.articleId)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Open in reader
            </Link>
            <Link href={`/teacher/classrooms/${encodeURIComponent(id)}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              <ArrowLeft size={14} aria-hidden />
              Back to classroom
            </Link>
          </>
        }
      />
      {guides.length === 0 && evidence.length === 0 ? (
        <EmptyState
          title="No prompts yet"
          description="Open the article in the reader, highlight a passage, and add it as a class prompt from the Notes tab."
        />
      ) : (
        <div className="flex flex-col gap-[var(--space-4)]">
          {guides.map((guide, index) => (
            <Card key={guide.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                  <CardTitle>Prompt {index + 1}</CardTitle>
                  {isArticleLevelKey(guide.levelKey) ? (
                    <Badge variant="neutral">{readingLevelLabel(guide.levelKey)} level</Badge>
                  ) : null}
                </div>
                <CardMeta>
                  {guide.responses.length === 1 ? "1 reply" : `${guide.responses.length} replies`}
                </CardMeta>
              </CardHeader>
              <CardBody className="flex flex-col gap-[var(--space-3)]">
                <blockquote className="m-0 border-l-2 border-primary pl-[var(--space-3)] text-[length:var(--type-ui)] text-text-muted">
                  &ldquo;{guide.quote}&rdquo;
                </blockquote>
                <p className="m-0 whitespace-pre-line text-[length:var(--type-body)] font-medium text-text">{guide.prompt}</p>
                <ResponseList rows={guide.responses} label={`Replies to prompt ${index + 1}`} />
              </CardBody>
            </Card>
          ))}
          <Card>
            <CardHeader>
              <CardTitle>Other shared evidence</CardTitle>
              <CardMeta>Highlights students shared without choosing a prompt.</CardMeta>
            </CardHeader>
            <CardBody>
              <ResponseList rows={evidence} label="Other shared evidence" />
            </CardBody>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
