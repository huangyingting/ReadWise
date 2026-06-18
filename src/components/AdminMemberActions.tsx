"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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
      setConfirmingDelete(false);
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
        <select
          className="admin-input"
          aria-label="Member role"
          value={role}
          disabled={busy !== null || isSelf}
          onChange={(e) => changeRole(e.target.value as Role)}
        >
          <option value="Reader">Reader</option>
          <option value="Admin">Admin</option>
        </select>
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy !== null || isSelf}
          title={isSelf ? "You cannot remove your own account" : undefined}
          onClick={() => {
            setError(null);
            setConfirmingDelete((v) => !v);
          }}
        >
          Remove
        </button>
      </div>

      {confirmingDelete && (
        <div
          className="admin-confirm"
          role="alertdialog"
          aria-label="Confirm remove member"
        >
          <p style={{ margin: 0 }}>
            Permanently remove this member and all of their progress, saved words
            and sessions? This cannot be undone.
          </p>
          <div className="admin-actions-row">
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy === "delete"}
              onClick={runDelete}
            >
              {busy === "delete" ? "Removing…" : "Confirm remove"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy === "delete"}
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="admin-error" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}
