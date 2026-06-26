"use client";

import { useState } from "react";
import { useMutation } from "@/hooks/useMutation";
import { postJson } from "@/lib/client-fetch";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";

/**
 * Creates an organization (RW-060). The creator becomes its first OrgAdmin so
 * they can then spin up classrooms. Posts to `/api/orgs` and refreshes.
 */
export default function CreateOrgForm() {
  const [name, setName] = useState("");
  const { busy, error, run } = useMutation("Failed to create organization");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await run(async () => {
      await postJson("/api/orgs", { name });
      setName("");
    }, { refreshOnSuccess: true });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-[var(--space-3)]">
      <Field label="Organization name" error={error ?? undefined}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Lincoln High ESL"
          maxLength={120}
          required
        />
      </Field>
      <div>
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create organization"}
        </Button>
      </div>
    </form>
  );
}
