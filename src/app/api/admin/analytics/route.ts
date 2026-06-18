import { NextResponse } from "next/server";
import { createAdminHandler } from "@/lib/api-handler";
import { getAdminAnalytics } from "@/lib/admin-analytics";

export const GET = createAdminHandler({}, async () => {
  const analytics = await getAdminAnalytics();
  return NextResponse.json(analytics);
});
