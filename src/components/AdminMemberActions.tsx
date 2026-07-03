"use client";

import { deleteJson, patchJson } from "@/lib/client-fetch";
import { Select } from "@/components/ui/Select";
import ConfirmAction from "@/components/ConfirmAction";
import { useAdminAction } from "@/hooks/useAdminAction";

type Role = "Admin" | "Reader";

interface AdminMemberActionsProps {
  memberId: string;
  role: Role;
  isSelf: boolean;
}

const ROLE_OPTIONS: Role[] = ["Reader", "Admin"];
const selfRemovalTitle = "You cannot remove your own account";

export default function AdminMemberActions({
  memberId,
  role,
  isSelf,
}: AdminMemberActionsProps) {
  const { busy, error, run } = useAdminAction<"role" | "delete">();
  const actionsDisabled = busy !== null || isSelf;
  const removeDisabledTitle = isSelf ? selfRemovalTitle : undefined;

  function updateRole(nextRole: string) {
    return run("role", () =>
      patchJson(`/api/admin/members/${memberId}`, {
        role: nextRole,
      }),
    );
  }

  function removeMember() {
    return run("delete", () => deleteJson(`/api/admin/members/${memberId}`));
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
            disabled={actionsDisabled}
            onChange={(e) => updateRole(e.target.value)}
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </div>
        <ConfirmAction
          triggerLabel="Remove"
          triggerVariant="danger-ghost"
          confirmVariant="danger"
          confirmLabel="Confirm remove"
          confirmMessage="Permanently remove this member and all of their progress, saved words and sessions? This cannot be undone."
          onConfirm={removeMember}
          loading={busy === "delete"}
          disabled={isSelf || busy === "role"}
          disabledTitle={removeDisabledTitle}
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
