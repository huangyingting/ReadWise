"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { postJson } from "@/lib/client-fetch";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Field } from "@/components/ui/Field";
import { useMutation } from "@/hooks/useMutation";
import { TeacherFormShell } from "./TeacherFormShell";

export type TeachableOrg = { id: string; name: string };

function canCreateClassroom(orgId: string, name: string) {
  return Boolean(orgId && name.trim());
}

/**
 * Creates a classroom inside an org the teacher can manage (RW-061). Posts to
 * `/api/classrooms`; the creator becomes the classroom's teacher.
 */
export default function CreateClassroomForm({ orgs }: { orgs: TeachableOrg[] }) {
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? "");
  const [name, setName] = useState("");
  const { busy, error, run } = useMutation("Failed to create classroom");
  const canSubmit = canCreateClassroom(orgId, name);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    await run(async () => {
      await postJson("/api/classrooms", { orgId, name });
      setName("");
    }, { refreshOnSuccess: true });
  }

  return (
    <TeacherFormShell
      onSubmit={submit}
      busy={busy}
      canSubmit={canSubmit}
      submitLabel="Create classroom"
      busyLabel="Creating…"
    >
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
    </TeacherFormShell>
  );
}
