import { NextResponse } from "next/server";
import { createCapabilityHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { CAPABILITIES } from "@/lib/rbac";
import { applyTakedown, type TakedownState } from "@/lib/article-library";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";
import { revalidateArticlesCache } from "@/lib/cache";
import { takedownBody } from "@/lib/admin/articles/schemas";

/**
 * Applies a rights/takedown transition to an article (RW-047). Non-active
 * states force the article to DRAFT so it leaves public feeds. Audited. Gated on
 * `content.moderate`.
 */
export const POST = createCapabilityHandler(
  CAPABILITIES.contentModerate,
  { params: idParams, body: takedownBody },
  async ({ req, params, body, session, requestId }) => {
    const result = await applyTakedown({
      articleId: params.id,
      state: body.state,
      note: body.note ?? null,
      rightsNote: body.rightsNote,
      reviewerId: session.user.id,
    });
    if (!result.ok) {
      throw new ApiError(result.status, result.error);
    }
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminArticleTakedown,
      targetType: "article",
      targetId: params.id,
      metadata: {
        previousState: result.previousState,
        state: result.state,
        status: result.status,
      },
    });
    revalidateArticlesCache();
    return NextResponse.json({
      ok: true,
      state: result.state,
      status: result.status,
    });
  },
);
