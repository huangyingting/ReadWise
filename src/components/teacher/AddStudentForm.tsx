"use client";

import { useState } from "react";
import { postJson } from "@/lib/client-fetch";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { TeacherFormShell, useTeacherMutation } from "./TeacherFormShell";

/**
 * Adds a student to a classroom by their user id (RW-061). Posts to
 * `/api/classrooms/[id]/members`. Lean by design — a fuller invite/search flow
 * can layer on later; the API + roster are the foundation.
 */
export default function AddStudentForm({ classroomId }: { classroomId: string }) {
  const [userId, setUserId] = useState("");
  const { busy, error, run } = useTeacherMutation("Failed to add student");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedUserId = userId.trim();
    if (!trimmedUserId) return;
    await run(async () => {
      await postJson(`/api/classrooms/${classroomId}/members`, {
        userId: trimmedUserId,
        role: "Student",
      });
      setUserId("");
    }, { refreshOnSuccess: true });
  }

  return (
    <TeacherFormShell
      onSubmit={submit}
      busy={busy}
      canSubmit={!!userId.trim()}
      submitLabel="Add student"
      busyLabel="Adding…"
    >
      <Field label="Student user ID" error={error ?? undefined}>
        <Input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="User id"
          maxLength={200}
          required
        />
      </Field>
    </TeacherFormShell>
  );
}
