import { NextResponse } from "next/server";
import { createCapabilityHandler, ApiError } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { object, string, optional, queryInt, queryString } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { addMember, createOrganization } from "@/lib/org";
import { listOrganizations } from "@/lib/admin/organizations";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";

/**
 * Platform-admin organization list + create (#1163).
 *
 * Gated on `organizations.manage` (global `Admin` only). The list is the
 * platform-wide oversight surface; create seeds the target user as the org's
 * first OrgAdmin by REUSING the existing tenant commands (`createOrganization`
 * + `addMember`) — it does not re-implement tenant logic.
 */

function organizationsQuery(params: URLSearchParams) {
  return {
    ok: true as const,
    value: {
      q: queryString(params, "q").trim().slice(0, 200),
      page: queryInt(params, "page", { fallback: 1, min: 1 }),
      sort: queryString(params, "sort").trim() || undefined,
      order: queryString(params, "order").trim() || undefined,
    },
  };
}

const createOrgBody = object({
  name: string({ min: 1, max: 120 }),
  slug: optional(string({ min: 1, max: 120 })),
  ownerUserId: string({ min: 1, max: 200 }),
});

export const GET = createCapabilityHandler(
  CAPABILITIES.organizationsManage,
  { query: organizationsQuery },
  async ({ query }) => {
    const result = await listOrganizations({
      q: query.q,
      page: query.page,
      sort: query.sort,
      order: query.order,
    });
    return NextResponse.json(result);
  },
);

export const POST = createCapabilityHandler(
  CAPABILITIES.organizationsManage,
  { body: createOrgBody },
  async ({ req, body, session, requestId }) => {
    const owner = await prisma.user.findUnique({
      where: { id: body.ownerUserId },
      select: { id: true },
    });
    if (!owner) {
      throw new ApiError(404, "Owner user not found");
    }
    const { organization } = await createOrganization(
      { name: body.name, slug: body.slug },
      owner.id,
    );
    const membership = await addMember(organization.id, owner.id, "OrgAdmin");
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminOrganizationCreate,
      targetType: "organization",
      targetId: organization.id,
      metadata: { ownerUserId: owner.id, slug: organization.slug },
    });
    return NextResponse.json({ ok: true, organization, membership }, { status: 201 });
  },
);
