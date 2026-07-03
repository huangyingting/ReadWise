import { NextResponse } from "next/server";
import type { MembershipRole } from "@prisma/client";
import { createHandler } from "@/lib/api-handler";
import { idParams, object, oneOf, nonEmptyString } from "@/lib/validation";
import { MEMBERSHIP_ROLES, CAPABILITIES } from "@/lib/rbac";
import { addMember } from "@/lib/org";
import { requireOrgCapabilityApi } from "@/lib/tenant-api";

const CREATED_RESPONSE_INIT = { status: 201 } as const;

const addMemberBody = object({
  userId: nonEmptyString(200),
  role: oneOf<MembershipRole>(MEMBERSHIP_ROLES),
});

type OrgSession = Parameters<typeof requireOrgCapabilityApi>[0];
type OrgMembership = Awaited<ReturnType<typeof addMember>>;

async function requireMemberManagement(session: OrgSession, orgId: string) {
  await requireOrgCapabilityApi(session, orgId, CAPABILITIES.orgMembersManage);
}

function memberCreatedResponse(membership: OrgMembership) {
  return NextResponse.json({ ok: true, membership }, CREATED_RESPONSE_INIT);
}

/**
 * Adds (or re-roles) a member of an organization (RW-060). Requires the caller
 * to hold `org.members.manage` within the org (OrgAdmin) or be a system admin.
 */
export const POST = createHandler(
  { params: idParams, body: addMemberBody },
  async ({ params, body, session }) => {
    await requireMemberManagement(session, params.id);
    const membership = await addMember(params.id, body.userId, body.role);
    return memberCreatedResponse(membership);
  },
);
