import { NextResponse } from "next/server";
import { createCapabilityHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { CAPABILITIES } from "@/lib/rbac";
import { reviewArticle, type ReviewState } from "@/lib/article-library";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";
import { revalidateArticlesCache, revalidateTagsCache } from "@/lib/cache";
import { reviewBody } from "@/lib/admin/articles/schemas";

/**
 * Records a content review / moderation action on an article (RW-048): applies
 * field corrections + a review verdict and appends a `ContentReview` history
 * row. Audited. Gated on `content.moderate`.
 */
export const POST = createCapabilityHandler(
  CAPABILITIES.contentModerate,
  { params: idParams, body: reviewBody },
  async ({ req, params, body, session, requestId }) => {
    const result = await reviewArticle({
      articleId: params.id,
      reviewerId: session.user.id,
      ...body,
    });
    if (!result.ok) {
      throw new ApiError(result.status, result.error);
    }
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminArticleReview,
      targetType: "article",
      targetId: params.id,
      metadata: { reviewState: result.reviewState, changed: Object.keys(result.changes) },
    });
    revalidateArticlesCache();
    revalidateTagsCache();
    return NextResponse.json({ ok: true, reviewState: result.reviewState, changes: result.changes });
  },
);
