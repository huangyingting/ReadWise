"use client";

import { useState, type FormEvent } from "react";
import { patchJson } from "@/lib/client-fetch";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { useMutation } from "@/hooks/useMutation";
import AssignmentAudienceSelector from "./AssignmentAudienceSelector";
import { TeacherFormShell } from "./TeacherFormShell";

interface EditAssignmentFormProps {
  assignmentId: string;
  assignmentTitle: string;
  /** ISO date string (or null) for the current due date. */
  initialDueDate: string | null;
  initialInstructions: string | null;
  initialTitle: string | null;
  initialPoints: number | null;
  initialTargetIds: string[];
  students: { id: string; label: string }[];
}

const TITLE_MAX_LENGTH = 200;
const INSTRUCTIONS_MAX_LENGTH = 2000;

/** Turns an ISO timestamp into the `yyyy-mm-dd` value a date input expects. */
function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function buildUpdatePayload(
  dueDate: string,
  instructions: string,
  title: string,
  points: string,
  audience: "class" | "students",
  targetIds: string[],
) {
  return {
    dueDate,
    title: title.trim(),
    points: points ? Number(points) : null,
    instructions: instructions.trim(),
    studentIds: audience === "students" ? targetIds : [],
  };
}

/**
 * Lets a teacher edit an assignment's due date and instructions (RW-061).
 * PATCHes `/api/assignments/[id]`; the server re-checks classroom-manage
 * capability. Kept read-first: collapsed behind an "Edit" toggle.
 */
export default function EditAssignmentForm({
  assignmentId,
  assignmentTitle,
  initialDueDate,
  initialInstructions,
  initialTitle,
  initialPoints,
  initialTargetIds,
  students,
}: EditAssignmentFormProps) {
  const [open, setOpen] = useState(false);
  const [dueDate, setDueDate] = useState(toDateInputValue(initialDueDate));
  const [instructions, setInstructions] = useState(initialInstructions ?? "");
  const [title, setTitle] = useState(initialTitle ?? "");
  const [points, setPoints] = useState(initialPoints == null ? "" : String(initialPoints));
  const [audience, setAudience] = useState<"class" | "students">(
    initialTargetIds.length > 0 ? "students" : "class",
  );
  const [targetIds, setTargetIds] = useState<string[]>(initialTargetIds);
  const { busy, error, run } = useMutation("Failed to update assignment");

  function toggleTarget(studentId: string) {
    setTargetIds((current) =>
      current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : [...current, studentId],
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (audience === "students" && targetIds.length === 0) return;
    await run(async () => {
      await patchJson(
        `/api/assignments/${encodeURIComponent(assignmentId)}`,
        buildUpdatePayload(dueDate, instructions, title, points, audience, targetIds),
      );
      setOpen(false);
    }, { refreshOnSuccess: true });
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Edit assignment ${assignmentTitle}`}
        onClick={() => setOpen(true)}
      >
        Edit
      </Button>
    );
  }

  return (
    <TeacherFormShell
      onSubmit={submit}
      busy={busy}
      canSubmit
      submitLabel="Save changes"
      busyLabel="Saving…"
    >
      <Field label="Title (optional)">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={assignmentTitle}
          maxLength={TITLE_MAX_LENGTH}
        />
      </Field>
      <Field label="Points (optional)">
        <Input
          type="number"
          min={0}
          max={10000}
          step={1}
          value={points}
          onChange={(e) => setPoints(e.target.value)}
        />
      </Field>
      <Field label="Due date (optional)" error={error ?? undefined}>
        <Input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </Field>
      {students.length > 0 ? (
        <Field label="Assign to">
          <AssignmentAudienceSelector
            students={students}
            audience={audience}
            onAudienceChange={setAudience}
            targetIds={targetIds}
            onToggleTarget={toggleTarget}
          />
        </Field>
      ) : null}
      <Field label="Instructions (optional)">
        <Textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="What should students focus on?"
          rows={3}
          maxLength={INSTRUCTIONS_MAX_LENGTH}
        />
      </Field>
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </TeacherFormShell>
  );
}
