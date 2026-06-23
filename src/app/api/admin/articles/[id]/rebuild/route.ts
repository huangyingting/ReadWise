import { NextResponse } from "next/server";
import { createAdminHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { rebuildArticleAi } from "@/lib/admin-articles";
import { revalidateTagsCache } from "@/lib/cache";
import { articleAccessContext } from "@/lib/article-access";

export const POST = createAdminHandler({ params: idParams }, async ({ params, session }) => {
  const result = await rebuildArticleAi(params.id, articleAccessContext(session.user));
  if (!result) {
    throw new ApiError(404, "Not found");
  }
  revalidateTagsCache();
  return NextResponse.json({ ok: true, ...result });
});
