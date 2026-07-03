"use client";

import { useState } from "react";
import { postJson } from "@/lib/client-fetch";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { useMutation } from "@/hooks/useMutation";
import { TeacherFormShell } from "./TeacherFormShell";

const ORG_NAME_MAX_LENGTH = 120;

/**
 * Creates an organization (RW-060). The creator becomes its first OrgAdmin so
 * they can then spin up classrooms. Posts to `/api/orgs` and refreshes.
 */
export default function CreateOrgForm() {
  const [name, setName] = useState("");
  const { busy, error, run } = useMutation("Failed to create organization");
  const hasName = name.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!hasName) return;
    await run(async () => {
      await postJson("/api/orgs", { name });
      setName("");
    }, { refreshOnSuccess: true });
  }

  return (
    <TeacherFormShell
      onSubmit={submit}
      busy={busy}
      canSubmit={hasName}
      submitLabel="Create organization"
      busyLabel="Creating…"
    >
      <Field label="Organization name" error={error ?? undefined}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Lincoln High ESL"
          maxLength={ORG_NAME_MAX_LENGTH}
          required
        />
      </Field>
    </TeacherFormShell>
  );
}
