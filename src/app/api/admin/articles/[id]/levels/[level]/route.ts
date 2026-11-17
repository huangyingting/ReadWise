import { NextResponse } from "next/server";
import { createCapabilityHandler, ApiError } from "@/lib/api-handler";
import { nonEmptyString, object, oneOf, string } from "@/lib/validation";
import { CAPABILITIES } from "@/lib/rbac";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";
import { ARTICLE_LEVEL_KEYS } from "@/lib/article-levels/levels";
import { LEVEL_TEXT_MAX_LENGTH, LEVEL_TITLE_MAX_LENGTH } from "@/lib/article-levels/variants";
import { deleteArticleLevel, saveArticleLevel } from "@/lib/article-levels/authoring";

const levelParams = object({ id: nonEmptyString(200), level: oneOf(ARTICLE_LEVEL_KEYS) });

const levelBody = object({
  title: nonEmptyString(LEVEL_TITLE_MAX_LENGTH),
  text: string({ min: 1, max: LEVEL_TEXT_MAX_LENGTH }),
});

/**
 * Creates or replaces an adapted reading level of an article (#1303) from a
 * headline and plain-text paragraphs. Gated on `content.moderate`; audited with
 * ids, level, and measured metrics only — never the text.
 */
export const PUT = createCapabilityHandler(
  CAPABILITIES.contentModerate,
  { params: levelParams, body: levelBody },
  async ({ req, params, body, session, requestId }) => {
    const result = await saveArticleLevel(params.id, params.level, body, {
      actorId: session.user.id,
      source: "manual",
    });
    if (!result.ok) {
      throw new ApiError(result.status, result.reason === "not_found" ? "Article not found" : "Add a headline and at least one paragraph");
    }
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminArticleLevelSave,
      targetType: "article",
      targetId: params.id,
      metadata: { level: params.level, wordCount: result.level.wordCount, lexileApprox: result.level.lexileApprox },
    });
    return NextResponse.json({ level: result.level });
  },
);

/** Removes an adapted reading level and its quiz (#1303). Audited. */
export const DELETE = createCapabilityHandler(
  CAPABILITIES.contentModerate,
  { params: levelParams },
  async ({ req, params, session, requestId }) => {
    if (!(await deleteArticleLevel(params.id, params.level))) {
      throw new ApiError(404, "Reading level not found");
    }
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminArticleLevelDelete,
      targetType: "article",
      targetId: params.id,
      metadata: { level: params.level },
    });
    return NextResponse.json({ ok: true });
  },
);
