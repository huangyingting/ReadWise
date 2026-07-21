"use client";

import { useState } from "react";
import type { MembershipRole } from "@prisma/client";
import { postJson } from "@/lib/client-fetch";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { useMutation } from "@/hooks/useMutation";
import {
  ADMIN_ORG_MEMBER_ROLES,
  addOrganizationMemberBody,
  orgMembersEndpoint,
} from "@/lib/admin/organizations/manage-ui";

interface AdminOrgAddMemberFormProps {
  orgId: string;
}

/**
 * Client island: add or re-role an organization member from the admin detail
 * surface (#1185). Reuses the existing tenant POST route, which enforces the
 * same org-admin/system-admin RBAC as the rest of org membership management.
 */
export default function AdminOrgAddMemberForm({
  orgId,
}: AdminOrgAddMemberFormProps) {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<MembershipRole>("Member");
  const [success, setSuccess] = useState<string | null>(null);
  const { busy, error, setError, run } = useMutation("Could not add member");
  const trimmedUserId = userId.trim();
  const canSubmit = trimmedUserId.length > 0 && !busy;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSuccess(null);
    if (!trimmedUserId) {
      setError("Enter a user ID.");
      return;
    }

    const result = await run(
      () =>
        postJson(orgMembersEndpoint(orgId), addOrganizationMemberBody({ userId, role })),
      { refreshOnSuccess: true, fallbackMessage: "Could not add member" },
    );
    if (!result) return;
    setUserId("");
    setRole("Member");
    setSuccess("Member added. The membership list has been refreshed.");
  }

  return (
    <Card className="stack">
      <h3 className="m-0 font-semibold text-[length:var(--text-lg)]">
        Add member
      </h3>
      <form onSubmit={submit} className="stack">
        <div className="flex flex-wrap gap-[var(--space-3)] items-start">
          <Field
            label="User ID"
            hint="Paste an existing user ID. The route will add or update this member."
            className="flex-[1_1_240px]"
            required
          >
            <Input
              name="userId"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              inputSize="md"
              disabled={busy}
              autoComplete="off"
            />
          </Field>
          <Field label="Role" className="flex-[1_1_160px]" required>
            <Select
              name="role"
              value={role}
              onChange={(event) => setRole(event.target.value as MembershipRole)}
              selectSize="md"
              disabled={busy}
            >
              {ADMIN_ORG_MEMBER_ROLES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            type="submit"
            variant="primary"
            size="md"
            className="w-auto mt-[var(--space-7)]"
            disabled={!canSubmit}
            loading={busy}
          >
            Add member
          </Button>
        </div>
        {error && (
          <p className="m-0 text-danger-text text-[length:var(--text-sm)]" role="alert">
            {error}
          </p>
        )}
        {success && (
          <p className="m-0 text-success-text text-[length:var(--text-sm)]" aria-live="polite">
            {success}
          </p>
        )}
      </form>
    </Card>
  );
}
