import { NextResponse } from "next/server";
import type { MembershipRole } from "@prisma/client";
import { createHandler } from "@/lib/api-handler";
import { throwIfFailed } from "@/lib/result";
import { object, oneOf, nonEmptyString } from "@/lib/validation";
import { CAPABILITIES, MEMBERSHIP_ROLES } from "@/lib/rbac";
import { removeMember, updateMemberRole } from "@/lib/org";
import { requireOrgCapabilityApi } from "@/lib/tenant-api";

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
  async ({ params, body, session }) => {
    await requireMemberManagement(session, params.id);
    const result = await updateMemberRole(params.id, params.memberid, body.role);
    throwIfFailed(result);
    return NextResponse.json({ ok: true, role: result.role });
  },
);

export const DELETE = createHandler(
  { params: memberParams },
  async ({ params, session }) => {
    await requireMemberManagement(session, params.id);
    const result = await removeMember(params.id, params.memberid);
    throwIfFailed(result);
    return NextResponse.json({ ok: true });
  },
);
