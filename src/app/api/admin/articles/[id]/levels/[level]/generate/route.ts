import { NextResponse } from "next/server";
import { createCapabilityHandler, ApiError } from "@/lib/api-handler";
import { nonEmptyString, object, oneOf, optional, boolean } from "@/lib/validation";
import { CAPABILITIES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";
import { ARTICLE_LEVEL_KEYS } from "@/lib/article-levels/levels";
import { enqueueLevelAdapt } from "@/lib/jobs/enqueue";
import { isAiConfigured } from "@/lib/ai";

const levelParams = object({ id: nonEmptyString(200), level: oneOf(ARTICLE_LEVEL_KEYS) });
const generateBody = object({ replace: optional(boolean()) });

/**
 * Queues a LEVEL_ADAPT job that writes an adapted reading level with the AI
 * provider (#1303). Returns 503 with a manual-entry hint when AI is
 * unconfigured. Gated on `content.moderate`; audited.
 */
export const POST = createCapabilityHandler(
  CAPABILITIES.contentModerate,
  { params: levelParams, body: generateBody },
  async ({ req, params, body, session, requestId }) => {
    const article = await prisma.article.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!article) throw new ApiError(404, "Article not found");
    if (!isAiConfigured()) {
      throw new ApiError(503, "AI is not configured — add this level manually");
    }
    const job = await enqueueLevelAdapt(params.id, params.level, {
      actorId: session.user.id,
      replace: body.replace === true,
    });
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminArticleLevelGenerate,
      targetType: "article",
      targetId: params.id,
      metadata: { level: params.level, jobId: job.id, replace: body.replace === true },
    });
    return NextResponse.json({ queued: true, jobId: job.id }, { status: 202 });
  },
);
