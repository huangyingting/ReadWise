import { NextResponse } from "next/server";
import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { listAdminTagMergeTargets } from "@/lib/article-library/admin-tags";

/** Returns tags as a lightweight list for the merge target dropdown (capped at 500). */
export const GET = createCapabilityHandler(
  CAPABILITIES.tagsManage,
  {}, async () => {
  return mergeTargetTagsResponse();
});

async function mergeTargetTagsResponse(): Promise<NextResponse> {
  const tags = await listAdminTagMergeTargets();
  return NextResponse.json(tags);
}
