"use client";

import { deleteJson, patchJson } from "@/lib/client-fetch";
import { Select } from "@/components/ui/Select";
import ConfirmAction from "@/components/ConfirmAction";
import { useAdminAction } from "@/hooks/useAdminAction";

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
  const { busy, error, run } = useAdminAction<"role" | "delete">();

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
            onChange={(e) =>
              run("role", () =>
                patchJson(`/api/admin/members/${memberId}`, {
                  role: e.target.value,
                }),
              )
            }
          >
            <option value="Reader">Reader</option>
            <option value="Admin">Admin</option>
          </Select>
        </div>
        <ConfirmAction
          triggerLabel="Remove"
          triggerVariant="danger-ghost"
          confirmVariant="danger"
          confirmLabel="Confirm remove"
          confirmMessage="Permanently remove this member and all of their progress, saved words and sessions? This cannot be undone."
          onConfirm={() => run("delete", () => deleteJson(`/api/admin/members/${memberId}`))}
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
