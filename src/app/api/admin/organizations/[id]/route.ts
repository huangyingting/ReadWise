import { NextResponse } from "next/server";
import { createCapabilityHandler, ApiError } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { idParams } from "@/lib/validation";
import { getOrganizationDetail } from "@/lib/admin/organizations";

/**
 * Platform-admin single-organization detail (#1163).
 *
 * Gated on `organizations.manage`. Member role changes / removal and classroom
 * management are NOT re-implemented here — the admin detail page reuses the
 * existing `/api/orgs/[id]/members/*` and `/api/classrooms/*` routes (which
 * already grant the system-admin super-user bypass).
 */
export const GET = createCapabilityHandler(
  CAPABILITIES.organizationsManage,
  { params: idParams },
  async ({ params }) => {
    const detail = await getOrganizationDetail(params.id);
    if (!detail) {
      throw new ApiError(404, "Organization not found");
    }
    return NextResponse.json({ organization: detail });
  },
);
