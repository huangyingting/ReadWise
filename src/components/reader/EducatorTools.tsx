"use client";

/**
 * Educator reader tools (#1304), shown to teachers, content staff, and
 * platform super-users on `/reader/[id]`:
 *
 *  - "Apply to your lesson" opens the lesson sheet (scaffolds, oral fluency
 *    passage, poll and Checks for Understanding).
 *  - "View as student" previews the exact student experience (`?view=student`),
 *    including a locked reading level and assignment activities.
 *  - "Assign to a class" assigns this article without leaving the reader.
 *
 * `StudentPreviewBanner` replaces the bar while previewing.
 */

import { useState, type SubmitEvent } from "react";
import Link from "next/link";
import { Eye, GraduationCap, Plus, X } from "lucide-react";
import { clientErrorMessage, postJson } from "@/lib/client-fetch";
import { Button, Card, CardBody, Field, IconButton, Input, PanelError, Select, Sheet, buttonVariants } from "@/components/ui";
import LessonSheet from "./LessonSheet";

function QuickAssignSheet({
  articleId,
  classrooms,
  open,
  onClose,
}: {
  articleId: string;
  classrooms: Array<{ id: string; name: string }>;
  open: boolean;
  onClose: () => void;
}) {
  const [classroomId, setClassroomId] = useState(classrooms[0]?.id ?? "");
  const [dueDate, setDueDate] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignedTo, setAssignedTo] = useState<{ id: string; name: string } | null>(null);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await postJson(`/api/classrooms/${encodeURIComponent(classroomId)}/assignments`, {
        articleId,
        ...(dueDate ? { dueDate } : {}),
      });
      setAssignedTo(classrooms.find((classroom) => classroom.id === classroomId) ?? null);
    } catch (err) {
      setError(clientErrorMessage(err, "Couldn’t assign this article."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} side="right" label="Assign to a class">
      <div className="flex items-center justify-between gap-[var(--space-4)] border-b border-border px-[var(--space-5)] py-[var(--space-4)]">
        <h2 className="m-0 text-[length:var(--text-lg)] font-semibold text-text">Assign to a class</h2>
        <IconButton aria-label="Close assign sheet" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </IconButton>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-[var(--space-4)] px-[var(--space-5)] py-[var(--space-4)]">
        <Field label="Class">
          <Select value={classroomId} onChange={(event) => setClassroomId(event.target.value)}>
            {classrooms.map((classroom) => (
              <option key={classroom.id} value={classroom.id}>
                {classroom.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Due date (optional)">
          <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </Field>
        <div>
          <Button type="submit" loading={pending} disabled={pending || !classroomId}>
            Assign
          </Button>
        </div>
        {assignedTo ? (
          <p role="status" className="m-0 text-[length:var(--text-sm)] text-text">
            Assigned to {assignedTo.name}.{" "}
            <Link href={`/teacher/classrooms/${encodeURIComponent(assignedTo.id)}`} className="text-primary-text underline">
              Open the classroom
            </Link>{" "}
            to set targets, a reading level, or activities.
          </p>
        ) : null}
        {error ? <PanelError message={error} /> : null}
      </form>
    </Sheet>
  );
}

export function EducatorBar({
  articleId,
  articleTitle,
  plainText,
  classrooms,
  previewHref,
}: {
  articleId: string;
  articleTitle: string;
  plainText: string;
  classrooms: Array<{ id: string; name: string }>;
  /** Reader URL with `view=student`. */
  previewHref: string;
}) {
  const [lessonOpen, setLessonOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  return (
    <Card className="mb-[var(--space-4)]" aria-label="Educator tools">
      <CardBody className="flex flex-col gap-[var(--space-3)] sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] font-semibold text-text">
          <GraduationCap size={16} aria-hidden="true" className="text-primary-text" />
          Educator tools
        </span>
        <div className="flex flex-wrap gap-[var(--space-2)]">
          <Button type="button" size="sm" onClick={() => setLessonOpen(true)}>
            Apply to your lesson
          </Button>
          <Link
            href={previewHref}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Eye size={14} aria-hidden="true" />
            View as student
          </Link>
          {classrooms.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              leadingIcon={<Plus size={14} aria-hidden="true" />}
              onClick={() => setAssignOpen(true)}
            >
              Assign to a class
            </Button>
          ) : null}
        </div>
      </CardBody>
      <LessonSheet
        open={lessonOpen}
        onClose={() => setLessonOpen(false)}
        articleId={articleId}
        articleTitle={articleTitle}
        plainText={plainText}
      />
      {classrooms.length > 0 ? (
        <QuickAssignSheet articleId={articleId} classrooms={classrooms} open={assignOpen} onClose={() => setAssignOpen(false)} />
      ) : null}
    </Card>
  );
}

export function StudentPreviewBanner({ exitHref }: { exitHref: string }) {
  return (
    <Card className="mb-[var(--space-4)]" aria-label="Student preview">
      <CardBody className="flex flex-col gap-[var(--space-3)] sm:flex-row sm:items-center sm:justify-between">
        <p className="m-0 flex items-start gap-[var(--space-2)] text-[length:var(--text-sm)] text-text">
          <Eye size={16} aria-hidden="true" className="mt-[var(--space-1)] shrink-0 text-primary-text" />
          You’re previewing this article as a student, with your assignment’s reading level and activities.
          Responses aren’t saved.
        </p>
        <Link
          href={exitHref}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Exit preview
        </Link>
      </CardBody>
    </Card>
  );
}
