import { NextResponse } from "next/server";
import { createCapabilityHandler, ApiError } from "@/lib/api-handler";
import {
  idParams,
  object,
  optional,
  string,
  nonEmptyString,
  oneOf,
  array,
} from "@/lib/validation";
import { CAPABILITIES } from "@/lib/rbac";
import { reviewArticle, REVIEW_STATES, type ReviewState } from "@/lib/content-review";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/audit";
import { revalidateArticlesCache, revalidateTagsCache } from "@/lib/cache";

const reviewBody = object({
  title: optional(nonEmptyString(500)),
  excerpt: optional(string({ max: 2000 })),
  category: optional(string({ max: 100 })),
  difficulty: optional(string({ max: 10 })),
  status: optional(oneOf(["DRAFT", "PUBLISHED"] as const)),
  reviewState: optional(oneOf<ReviewState>(REVIEW_STATES)),
  qualityFlags: optional(array(nonEmptyString(50), { max: 20 })),
  tags: optional(array(nonEmptyString(60), { max: 25 })),
  note: optional(string({ max: 2000 })),
});

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
