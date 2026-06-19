"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/Select";
import ConfirmAction from "@/components/ConfirmAction";

type Role = "Admin" | "Reader";

export default function AdminMemberActions({
  memberId,
  role,
  isSelf,
}: {
  memberId: string;
  role: Role;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"role" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function changeRole(nextRole: Role) {
    if (nextRole === role) return;
    setBusy("role");
    setError(null);
    try {
      const res = await fetch(`/api/admin/members/${memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? `Role change failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Role change failed");
    } finally {
      setBusy(null);
    }
  }

  async function runDelete() {
    setBusy("delete");
    setError(null);
    try {
      const res = await fetch(`/api/admin/members/${memberId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? `Remove failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="admin-actions">
      <div className="admin-actions-row">
        <div className="w-auto">
          <Select
            selectSize="sm"
            className="w-auto"
            aria-label="Member role"
            value={role}
            disabled={busy !== null || isSelf}
            onChange={(e) => changeRole(e.target.value as Role)}
          >
            <option value="Reader">Reader</option>
            <option value="Admin">Admin</option>
          </Select>
        </div>
        <ConfirmAction
          triggerLabel="Remove"
          triggerVariant="danger"
          confirmVariant="danger"
          confirmLabel="Confirm remove"
          confirmMessage="Permanently remove this member and all of their progress, saved words and sessions? This cannot be undone."
          onConfirm={runDelete}
          loading={busy === "delete"}
          disabled={isSelf || busy === "role"}
          disabledTitle={
            isSelf ? "You cannot remove your own account" : undefined
          }
        />
      </div>

      {error && (
        <p
          className="text-danger-text text-[length:var(--text-sm)]"
          style={{ margin: 0 }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
