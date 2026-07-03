import { NextResponse } from "next/server";
import { createAdminHandler } from "@/lib/api-handler";
import { getAdminAnalytics } from "@/lib/analytics/admin";

export const GET = createAdminHandler({}, async () => {
  return adminAnalyticsResponse();
});

async function adminAnalyticsResponse(): Promise<NextResponse> {
  const analytics = await getAdminAnalytics();
  return NextResponse.json(analytics);
}
