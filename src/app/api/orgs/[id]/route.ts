import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { CAPABILITIES } from "@/lib/rbac";
import { getOrganization } from "@/lib/org";
import { requireOrgCapabilityApi } from "@/lib/tenant-api";

/**
 * Returns one organization when the caller belongs to it (or is a system admin).
 */
export const GET = createHandler(
  { params: idParams },
  async ({ params, session }) => {
    await requireOrgCapabilityApi(session, params.id, CAPABILITIES.articlesRead);
    const organization = await getOrganization(params.id);
    if (!organization) throw new ApiError(404, "Organization not found");
    return NextResponse.json({ organization });
  },
);
