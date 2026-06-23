"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";

/**
 * Adds a student to a classroom by their user id (RW-061). Posts to
 * `/api/classrooms/[id]/members`. Lean by design — a fuller invite/search flow
 * can layer on later; the API + roster are the foundation.
 */
export default function AddStudentForm({ classroomId }: { classroomId: string }) {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/classrooms/${classroomId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userId.trim(), role: "Student" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Failed (${res.status})`);
      }
      setUserId("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add student");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-[var(--space-3)]">
      <Field label="Student user ID" error={error ?? undefined}>
        <Input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="User id"
          maxLength={200}
          required
        />
      </Field>
      <div>
        <Button type="submit" size="sm" disabled={busy || !userId.trim()}>
          {busy ? "Adding…" : "Add student"}
        </Button>
      </div>
    </form>
  );
}
