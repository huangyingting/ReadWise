"use client";

import { useMemo, useState } from "react";
import type { MembershipRole } from "@prisma/client";
import { deleteJson, patchJson } from "@/lib/client-fetch";
import { MEMBERSHIP_ROLES } from "@/lib/rbac";
import { useAdminAction } from "@/hooks/useAdminAction";
import ConfirmAction from "@/components/ConfirmAction";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Select,
} from "@/components/ui";

type OrgMember = {
  userId: string;
  role: MembershipRole;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  };
};

type MemberAction = `role:${string}` | `remove:${string}`;

interface OrgMembersCardProps {
  orgId: string;
  orgName: string;
  viewerUserId: string;
  initialMembers: OrgMember[];
}

const SELF_REMOVE_TITLE = "You cannot remove yourself from this organization";

function memberDisplayName(member: OrgMember): string {
  return member.user.name ?? member.user.email ?? member.userId;
}

function memberSecondaryLabel(member: OrgMember): string {
  return member.user.email ?? member.userId;
}

function roleActionKey(memberId: string): MemberAction {
  return `role:${memberId}`;
}

function removeActionKey(memberId: string): MemberAction {
  return `remove:${memberId}`;
}

function actionableError(message: string): string {
  if (message.includes("last organization admin")) {
    return `${message}. Promote another member to OrgAdmin first.`;
  }
  if (message.includes("Membership not found")) {
    return "This membership no longer exists. Refresh and try again.";
  }
  return message;
}

export default function OrgMembersCard({
  orgId,
  orgName,
  viewerUserId,
  initialMembers,
}: OrgMembersCardProps) {
  const [members, setMembers] = useState(initialMembers);
  const [notice, setNotice] = useState<string | null>(null);
  const { busy, error, run } = useAdminAction<MemberAction>();
  const actionsDisabled = busy !== null;
  const errorMessage = useMemo(
    () => (error ? actionableError(error) : null),
    [error],
  );

  async function updateRole(memberId: string, role: MembershipRole) {
    const member = members.find((candidate) => candidate.userId === memberId);
    if (!member || member.role === role) return;
    setNotice(null);
    await run(roleActionKey(memberId), async () => {
      const data = await patchJson<{ ok: true; role: MembershipRole }>(
        `/api/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(memberId)}`,
        { role },
      );
      setMembers((current) =>
        current.map((candidate) =>
          candidate.userId === memberId
            ? { ...candidate, role: data.role }
            : candidate,
        ),
      );
      setNotice(`Updated ${memberDisplayName(member)} to ${data.role}.`);
    }, {
      errorFallback: "Failed to update member role",
    });
  }

  async function removeMember(memberId: string) {
    const member = members.find((candidate) => candidate.userId === memberId);
    if (!member) return;
    setNotice(null);
    await run(removeActionKey(memberId), async () => {
      await deleteJson<{ ok: true }>(
        `/api/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(memberId)}`,
      );
      setMembers((current) =>
        current.filter((candidate) => candidate.userId !== memberId),
      );
      setNotice(`Removed ${memberDisplayName(member)} from ${orgName}.`);
    }, {
      errorFallback: "Failed to remove organization member",
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-[var(--space-2)]">
          <span>{orgName}</span>
          <Badge variant="neutral">{members.length} members</Badge>
        </CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-[var(--space-3)]">
        {members.length === 0 ? (
          <p className="m-0 text-[length:var(--text-sm)] text-text-muted">
            No members yet.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0">
            {members.map((member) => {
              const displayName = memberDisplayName(member);
              const isSelf = member.userId === viewerUserId;
              return (
                <li
                  key={member.userId}
                  className="flex flex-col gap-[var(--space-2)] rounded-[var(--radius-md)] border border-border p-[var(--space-3)]"
                >
                  <div>
                    <p className="m-0 font-medium text-text">{displayName}</p>
                    <p className="m-0 text-[length:var(--text-sm)] text-text-muted">
                      {memberSecondaryLabel(member)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                    <Select
                      selectSize="sm"
                      className="w-auto"
                      aria-label={`Role for ${displayName}`}
                      value={member.role}
                      disabled={actionsDisabled}
                      onChange={(event) =>
                        updateRole(member.userId, event.target.value as MembershipRole)
                      }
                    >
                      {MEMBERSHIP_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </Select>
                    <ConfirmAction
                      triggerLabel="Remove"
                      triggerAriaLabel={`Remove ${displayName}`}
                      triggerVariant="danger-ghost"
                      confirmVariant="danger"
                      confirmLabel="Confirm remove"
                      confirmMessage={`Remove ${displayName} from ${orgName}?`}
                      onConfirm={() => removeMember(member.userId)}
                      loading={busy === removeActionKey(member.userId)}
                      disabled={isSelf || actionsDisabled}
                      disabledTitle={isSelf ? SELF_REMOVE_TITLE : undefined}
                      className="!min-w-0"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {notice ? (
          <p className="m-0 text-[length:var(--text-sm)] text-text-muted">{notice}</p>
        ) : null}
        {errorMessage ? (
          <p role="alert" className="m-0 text-[length:var(--text-sm)] text-danger-text">
            {errorMessage}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
