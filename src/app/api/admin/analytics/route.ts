import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { getAdminAnalytics } from "@/lib/admin-analytics";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.error) {
    return auth.error;
  }

  const analytics = await getAdminAnalytics();
  return NextResponse.json(analytics);
}
