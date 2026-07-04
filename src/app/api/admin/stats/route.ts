import { NextResponse } from "next/server";
import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { getAdminOverview } from "@/lib/admin/overview";

export const GET = createCapabilityHandler(
  CAPABILITIES.adminAccess,
  {}, async () => {
  return adminOverviewResponse();
});

async function adminOverviewResponse(): Promise<NextResponse> {
  const overview = await getAdminOverview();
  return NextResponse.json(overview);
}
