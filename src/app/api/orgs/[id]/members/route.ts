import { NextResponse } from "next/server";
import type { MembershipRole } from "@prisma/client";
import { createHandler } from "@/lib/api-handler";
import { idParams, object, oneOf, nonEmptyString } from "@/lib/validation";
import { MEMBERSHIP_ROLES, CAPABILITIES } from "@/lib/rbac";
import { addMember } from "@/lib/org";
import { requireOrgCapabilityApi } from "@/lib/tenant-api";

const addMemberBody = object({
  userId: nonEmptyString(200),
  role: oneOf<MembershipRole>(MEMBERSHIP_ROLES),
});

/**
 * Adds (or re-roles) a member of an organization (RW-060). Requires the caller
 * to hold `org.members.manage` within the org (OrgAdmin) or be a system admin.
 */
export const POST = createHandler(
  { params: idParams, body: addMemberBody },
  async ({ params, body, session }) => {
    await requireOrgCapabilityApi(session, params.id, CAPABILITIES.orgMembersManage);
    const membership = await addMember(params.id, body.userId, body.role);
    return NextResponse.json({ ok: true, membership }, { status: 201 });
  },
);

