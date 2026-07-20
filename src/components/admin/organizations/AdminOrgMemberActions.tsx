"use client";

import { deleteJson, patchJson } from "@/lib/client-fetch";
import { Select } from "@/components/ui/Select";
import ConfirmAction from "@/components/ConfirmAction";
import { useAdminAction } from "@/hooks/useAdminAction";
import type { MembershipRole } from "@prisma/client";
import {
  ADMIN_ORG_MEMBER_ROLES,
  orgMemberEndpoint,
} from "@/lib/admin/organizations/manage-ui";

interface AdminOrgMemberActionsProps {
  orgId: string;
  memberId: string;
  role: MembershipRole;
}

/**
 * Client island: change an org member's role or remove them from the platform-
 * admin surface (#1163). REUSES the existing tenant routes
 * `PATCH/DELETE /api/orgs/[id]/members/[memberId]` (which grant the system-admin
 * super-user bypass and enforce the last-admin guard) — no duplicated mutation.
 */
export default function AdminOrgMemberActions({
  orgId,
  memberId,
  role,
}: AdminOrgMemberActionsProps) {
  const { busy, error, run } = useAdminAction<"role" | "delete">();
  const actionsDisabled = busy !== null;

  function updateRole(nextRole: string) {
    return run(
      "role",
      () => patchJson(orgMemberEndpoint(orgId, memberId), { role: nextRole }),
      { errorFallback: "Could not update role" },
    );
  }

  function removeMember() {
    return run(
      "delete",
      () => deleteJson(orgMemberEndpoint(orgId, memberId)),
      { errorFallback: "Could not remove member" },
    );
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
            {ADMIN_ORG_MEMBER_ROLES.map((option) => (
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
          confirmMessage="Remove this member from the organization? The last organization admin cannot be removed."
          onConfirm={removeMember}
          loading={busy === "delete"}
          disabled={busy === "role"}
        />
      </div>

      {error && (
        <p className="text-danger-text text-[length:var(--text-sm)] m-0">
          {error}
        </p>
      )}
    </div>
  );
}
