import { NextResponse } from "next/server";
import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { getAdminAnalytics } from "@/lib/analytics/admin";

export const GET = createCapabilityHandler(
  CAPABILITIES.analyticsView,
  {}, async () => {
  return adminAnalyticsResponse();
});

async function adminAnalyticsResponse(): Promise<NextResponse> {
  const analytics = await getAdminAnalytics();
  return NextResponse.json(analytics);
}
