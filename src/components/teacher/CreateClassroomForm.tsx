"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Field } from "@/components/ui/Field";

export type TeachableOrg = { id: string; name: string };

/**
 * Creates a classroom inside an org the teacher can manage (RW-061). Posts to
 * `/api/classrooms`; the creator becomes the classroom's teacher.
 */
export default function CreateClassroomForm({ orgs }: { orgs: TeachableOrg[] }) {
  const router = useRouter();
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/classrooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, name }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Failed (${res.status})`);
      }
      setName("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create classroom");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-[var(--space-3)]">
      <Field label="Organization">
        <Select value={orgId} onChange={(e) => setOrgId(e.target.value)}>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Classroom name" error={error ?? undefined}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Period 3 — Reading"
          maxLength={120}
          required
        />
      </Field>
      <div>
        <Button type="submit" disabled={busy || !orgId || !name.trim()}>
          {busy ? "Creating…" : "Create classroom"}
        </Button>
      </div>
    </form>
  );
}
