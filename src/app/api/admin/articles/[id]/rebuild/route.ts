import { NextResponse } from "next/server";
import { createAdminHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { rebuildArticleAi } from "@/lib/article-library";
import { revalidateTagsCache } from "@/lib/cache";
import { articleAccessContext } from "@/lib/article-library";
import { AUDIT_ACTIONS } from "@/lib/security/audit";

export const POST = createAdminHandler({ params: idParams }, async ({ req, params, session, requestId }) => {
  const result = await rebuildArticleAi(params.id, articleAccessContext(session.user), (auditResult) => ({
    req,
    session,
    requestId,
    action: AUDIT_ACTIONS.adminArticleRebuild,
    targetType: "article",
    targetId: params.id,
    metadata: auditResult.cleared,
  }));
  if (!result) {
    throw new ApiError(404, "Not found");
  }
  revalidateTagsCache();
  return NextResponse.json({ ok: true, ...result });
});
