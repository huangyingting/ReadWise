import { NextResponse } from "next/server";
import { createAdminHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { deleteArticle } from "@/lib/admin-articles";
import { revalidateTagsCache } from "@/lib/cache";
import { articleAccessContext } from "@/lib/article-access";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/audit";

export const DELETE = createAdminHandler({ params: idParams }, async ({ req, params, session, requestId }) => {
  const ok = await deleteArticle(params.id, articleAccessContext(session.user));
  if (!ok) {
    throw new ApiError(404, "Not found");
  }
  await recordAuditFromRequest({
    req,
    session,
    requestId,
    action: AUDIT_ACTIONS.adminArticleDelete,
    targetType: "article",
    targetId: params.id,
  });
  revalidateTagsCache();
  return NextResponse.json({ ok: true });
});
