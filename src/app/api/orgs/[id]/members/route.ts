import { NextResponse } from "next/server";
import type { MembershipRole } from "@prisma/client";
import { createHandler, ApiError } from "@/lib/api-handler";
import { throwIfFailed } from "@/lib/result";
import { idParams, object, oneOf, nonEmptyString } from "@/lib/validation";
import { MEMBERSHIP_ROLES, CAPABILITIES } from "@/lib/rbac";
import {
  addMember,
  getMembership,
  getOrganization,
  listOrgMembers,
  updateMemberRole,
} from "@/lib/org";
import { requireOrgCapabilityApi } from "@/lib/tenant-api";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";

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

function memberUpdatedResponse(membership: OrgMembership, role: MembershipRole) {
  return NextResponse.json({ ok: true, membership: { ...membership, role } });
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
 * Adds a member of an organization (RW-060). Existing memberships are re-roled
 * through updateMemberRole so the last-OrgAdmin invariant is enforced.
 */
export const POST = createHandler(
  { params: idParams, body: addMemberBody },
  async ({ req, params, body, session, requestId }) => {
    await requireMemberManagement(session, params.id);
    const existingMembership = await getMembership(body.userId, params.id);
    if (existingMembership) {
      const result = await updateMemberRole(params.id, body.userId, body.role);
      throwIfFailed(result);
      await recordAuditFromRequest({
        req,
        session,
        requestId,
        action: AUDIT_ACTIONS.orgMemberRoleUpdate,
        targetType: "org_membership",
        targetId: body.userId,
        metadata: {
          orgId: params.id,
          targetUserId: body.userId,
          role: result.role,
          previousRole: existingMembership.role,
        },
      });
      return memberUpdatedResponse(existingMembership, result.role);
    }
    const membership = await addMember(params.id, body.userId, body.role);
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.orgMemberAdd,
      targetType: "org_membership",
      targetId: body.userId,
      metadata: { orgId: params.id, targetUserId: body.userId, role: body.role },
    });
    return memberCreatedResponse(membership);
  },
);
