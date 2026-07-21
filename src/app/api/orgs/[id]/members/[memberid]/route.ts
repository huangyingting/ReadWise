import { NextResponse } from "next/server";
import type { MembershipRole } from "@prisma/client";
import { createHandler } from "@/lib/api-handler";
import { throwIfFailed } from "@/lib/result";
import { object, oneOf, nonEmptyString } from "@/lib/validation";
import { CAPABILITIES, MEMBERSHIP_ROLES } from "@/lib/rbac";
import { removeMember, updateMemberRole } from "@/lib/org";
import { requireOrgCapabilityApi } from "@/lib/tenant-api";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";

const memberParams = object({
  id: nonEmptyString(200),
  memberid: nonEmptyString(200),
});

const updateRoleBody = object({
  role: oneOf<MembershipRole>(MEMBERSHIP_ROLES),
});

async function requireMemberManagement(
  session: Parameters<typeof requireOrgCapabilityApi>[0],
  orgId: string,
) {
  await requireOrgCapabilityApi(session, orgId, CAPABILITIES.orgMembersManage);
}

export const PATCH = createHandler(
  { params: memberParams, body: updateRoleBody },
  async ({ req, params, body, session, requestId }) => {
    await requireMemberManagement(session, params.id);
    const result = await updateMemberRole(params.id, params.memberid, body.role);
    throwIfFailed(result);
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.orgMemberRoleUpdate,
      targetType: "org_membership",
      targetId: params.memberid,
      metadata: { orgId: params.id, targetUserId: params.memberid, role: result.role },
    });
    return NextResponse.json({ ok: true, role: result.role });
  },
);

export const DELETE = createHandler(
  { params: memberParams },
  async ({ req, params, session, requestId }) => {
    await requireMemberManagement(session, params.id);
    const result = await removeMember(params.id, params.memberid);
    throwIfFailed(result);
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.orgMemberRemove,
      targetType: "org_membership",
      targetId: params.memberid,
      metadata: { orgId: params.id, targetUserId: params.memberid },
    });
    return NextResponse.json({ ok: true });
  },
);
