import { NextResponse } from "next/server";
import { createCapabilityHandler, ApiError } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { idParams } from "@/lib/validation";
import { articleAccessContext, deleteArticle } from "@/lib/article-library";
import { revalidateTagsCache } from "@/lib/cache";
import { AUDIT_ACTIONS, type AuditRequestInput } from "@/lib/security/audit";

type AdminArticleAuditContext = Pick<AuditRequestInput, "req" | "requestId"> & {
  session: NonNullable<AuditRequestInput["session"]>;
  articleId: string;
};

function adminArticleAuditBase({
  req,
  session,
  requestId,
  articleId,
}: AdminArticleAuditContext): Omit<AuditRequestInput, "action"> {
  return {
    req,
    session,
    requestId,
    targetType: "article",
    targetId: articleId,
  };
}

function articleDeleteAudit(context: AdminArticleAuditContext): AuditRequestInput {
  return {
    ...adminArticleAuditBase(context),
    action: AUDIT_ACTIONS.adminArticleDelete,
  };
}

export const DELETE = createCapabilityHandler(
  CAPABILITIES.articlesManage,
  { params: idParams },
  async ({ req, params, session, requestId }) => {
    const articleId = params.id;
    const ok = await deleteArticle(
      articleId,
      articleAccessContext(session.user),
      articleDeleteAudit({
        req,
        session,
        requestId,
        articleId,
      }),
    );
    if (!ok) {
      throw new ApiError(404, "Not found");
    }
    revalidateTagsCache();
    return NextResponse.json({ ok: true });
  },
);
