import { NextResponse } from "next/server";
import type { MembershipRole } from "@prisma/client";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, oneOf, nonEmptyString } from "@/lib/validation";
import { MEMBERSHIP_ROLES, CAPABILITIES } from "@/lib/rbac";
import { addMember, getOrganization, listOrgMembers } from "@/lib/org";
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

async function assertOrgExists(orgId: string): Promise<void> {
  const organization = await getOrganization(orgId);
  if (!organization) throw new ApiError(404, "Organization not found");
}

function memberCreatedResponse(membership: OrgMembership) {
  return NextResponse.json({ ok: true, membership }, CREATED_RESPONSE_INIT);
}

/**
 * Lists organization members. Requires `org.members.manage`.
 */
export const GET = createHandler(
  { params: idParams },
  async ({ params, session }) => {
    await requireMemberManagement(session, params.id);
    await assertOrgExists(params.id);
    const members = await listOrgMembers(params.id);
    return NextResponse.json({ members });
  },
);

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
