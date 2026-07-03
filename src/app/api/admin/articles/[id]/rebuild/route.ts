import { NextResponse } from "next/server";
import { createAdminHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import {
  articleAccessContext,
  rebuildArticleAi,
  type RebuildResult,
} from "@/lib/article-library";
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
}: AdminArticleAuditContext) {
  return {
    req,
    session,
    requestId,
    targetType: "article",
    targetId: articleId,
  };
}

function articleRebuildAudit(context: AdminArticleAuditContext) {
  return (result: RebuildResult): AuditRequestInput => ({
    ...adminArticleAuditBase(context),
    action: AUDIT_ACTIONS.adminArticleRebuild,
    metadata: result.cleared,
  });
}

export const POST = createAdminHandler(
  { params: idParams },
  async ({ req, params, session, requestId }) => {
    const articleId = params.id;
    const result = await rebuildArticleAi(
      articleId,
      articleAccessContext(session.user),
      articleRebuildAudit({
        req,
        session,
        requestId,
        articleId,
      }),
    );
    if (!result) {
      throw new ApiError(404, "Not found");
    }
    revalidateTagsCache();
    return NextResponse.json({ ok: true, ...result });
  },
);
