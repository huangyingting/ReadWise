"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@/hooks/useMutation";
import { postJson } from "@/lib/client-fetch";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Field } from "@/components/ui/Field";

/**
 * Assigns an article to a classroom (RW-061): an article id, an optional due
 * date, and optional instructions. Posts to `/api/classrooms/[id]/assignments`.
 */
export default function AssignArticleForm({ classroomId }: { classroomId: string }) {
  const router = useRouter();
  const [articleId, setArticleId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [instructions, setInstructions] = useState("");
  const { busy, error, run } = useMutation("Failed to assign article");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedArticleId = articleId.trim();
    if (!trimmedArticleId) return;
    await run(async () => {
      await postJson(`/api/classrooms/${classroomId}/assignments`, {
        articleId: trimmedArticleId,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        instructions: instructions.trim() || undefined,
      });
      setArticleId("");
      setDueDate("");
      setInstructions("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-[var(--space-3)]">
      <Field label="Article ID" error={error ?? undefined}>
        <Input
          value={articleId}
          onChange={(e) => setArticleId(e.target.value)}
          placeholder="Article id to assign"
          maxLength={200}
          required
        />
      </Field>
      <Field label="Due date (optional)">
        <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </Field>
      <Field label="Instructions (optional)">
        <Textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="What should students focus on?"
          rows={3}
          maxLength={2000}
        />
      </Field>
      <div>
        <Button type="submit" disabled={busy || !articleId.trim()}>
          {busy ? "Assigning…" : "Assign article"}
        </Button>
      </div>
    </form>
  );
}
