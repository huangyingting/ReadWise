import { NextResponse } from "next/server";
import { createAdminHandler } from "@/lib/api-handler";
import { listAdminTagMergeTargets } from "@/lib/article-library/admin-tags";

/** Returns tags as a lightweight list for the merge target dropdown (capped at 500). */
export const GET = createAdminHandler({}, async () => {
  const tags = await listAdminTagMergeTargets();
  return NextResponse.json(tags);
});
