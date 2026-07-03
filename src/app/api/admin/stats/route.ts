import { NextResponse } from "next/server";
import { createAdminHandler } from "@/lib/api-handler";
import { getAdminOverview } from "@/lib/admin/overview";

export const GET = createAdminHandler({}, async () => {
  return adminOverviewResponse();
});

async function adminOverviewResponse(): Promise<NextResponse> {
  const overview = await getAdminOverview();
  return NextResponse.json(overview);
}
