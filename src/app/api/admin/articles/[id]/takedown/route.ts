import { NextResponse } from "next/server";
import { createCapabilityHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, optional, string, oneOf } from "@/lib/validation";
import { CAPABILITIES } from "@/lib/rbac";
import { applyTakedown, TAKEDOWN_STATES, type TakedownState } from "@/lib/content-policy";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/audit";
import { revalidateArticlesCache } from "@/lib/cache";

const takedownBody = object({
  state: oneOf<TakedownState>(TAKEDOWN_STATES),
  note: optional(string({ max: 2000 })),
  rightsNote: optional(string({ max: 2000 })),
});

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
