import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { getAdminOverview } from "@/lib/admin";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.error) {
    return auth.error;
  }

  const overview = await getAdminOverview();
  return NextResponse.json(overview);
}
