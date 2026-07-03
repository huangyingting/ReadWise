"use client";

import { useState, type FormEvent } from "react";
import { postJson } from "@/lib/client-fetch";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Field } from "@/components/ui/Field";
import { useMutation } from "@/hooks/useMutation";
import { TeacherFormShell } from "./TeacherFormShell";

const ARTICLE_ID_MAX_LENGTH = 200;
const INSTRUCTIONS_MAX_LENGTH = 2000;
const EMPTY_ASSIGNMENT_FORM = {
  articleId: "",
  dueDate: "",
  instructions: "",
};

interface AssignArticleFormProps {
  classroomId: string;
}

type AssignmentFormField = keyof typeof EMPTY_ASSIGNMENT_FORM;

function buildAssignmentPayload(
  articleId: string,
  dueDate: string,
  instructions: string,
) {
  return {
    articleId,
    dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
    instructions: instructions.trim() || undefined,
  };
}

/**
 * Assigns an article to a classroom (RW-061): an article id, an optional due
 * date, and optional instructions. Posts to `/api/classrooms/[id]/assignments`.
 */
export default function AssignArticleForm({ classroomId }: AssignArticleFormProps) {
  const [form, setForm] = useState(EMPTY_ASSIGNMENT_FORM);
  const { busy, error, run } = useMutation("Failed to assign article");

  const trimmedArticleId = form.articleId.trim();

  function resetForm() {
    setForm(EMPTY_ASSIGNMENT_FORM);
  }

  function updateField(field: AssignmentFormField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!trimmedArticleId) return;

    await run(async () => {
      await postJson(
        `/api/classrooms/${classroomId}/assignments`,
        buildAssignmentPayload(trimmedArticleId, form.dueDate, form.instructions),
      );
      resetForm();
    }, { refreshOnSuccess: true });
  }

  return (
    <TeacherFormShell
      onSubmit={submit}
      busy={busy}
      canSubmit={!!trimmedArticleId}
      submitLabel="Assign article"
      busyLabel="Assigning…"
      buttonSize="md"
    >
      <Field label="Article ID" error={error ?? undefined}>
        <Input
          value={form.articleId}
          onChange={(e) => updateField("articleId", e.target.value)}
          placeholder="Article id to assign"
          maxLength={ARTICLE_ID_MAX_LENGTH}
          required
        />
      </Field>
      <Field label="Due date (optional)">
        <Input
          type="date"
          value={form.dueDate}
          onChange={(e) => updateField("dueDate", e.target.value)}
        />
      </Field>
      <Field label="Instructions (optional)">
        <Textarea
          value={form.instructions}
          onChange={(e) => updateField("instructions", e.target.value)}
          placeholder="What should students focus on?"
          rows={3}
          maxLength={INSTRUCTIONS_MAX_LENGTH}
        />
      </Field>
    </TeacherFormShell>
  );
}
