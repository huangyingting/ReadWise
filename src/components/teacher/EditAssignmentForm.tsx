"use client";

import { useState, type FormEvent } from "react";
import { patchJson } from "@/lib/client-fetch";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { useMutation } from "@/hooks/useMutation";
import { TeacherFormShell } from "./TeacherFormShell";

interface EditAssignmentFormProps {
  assignmentId: string;
  assignmentTitle: string;
  /** ISO date string (or null) for the current due date. */
  initialDueDate: string | null;
  initialInstructions: string | null;
}

const INSTRUCTIONS_MAX_LENGTH = 2000;

/** Turns an ISO timestamp into the `yyyy-mm-dd` value a date input expects. */
function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function buildUpdatePayload(dueDate: string, instructions: string) {
  return {
    ...(dueDate ? { dueDate: new Date(dueDate).toISOString() } : {}),
    instructions: instructions.trim(),
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
}: EditAssignmentFormProps) {
  const [open, setOpen] = useState(false);
  const [dueDate, setDueDate] = useState(toDateInputValue(initialDueDate));
  const [instructions, setInstructions] = useState(initialInstructions ?? "");
  const { busy, error, run } = useMutation("Failed to update assignment");

  async function submit(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await patchJson(
        `/api/assignments/${encodeURIComponent(assignmentId)}`,
        buildUpdatePayload(dueDate, instructions),
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
      <Field label="Due date (optional)" error={error ?? undefined}>
        <Input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </Field>
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
