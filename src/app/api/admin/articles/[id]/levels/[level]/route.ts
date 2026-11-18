import { NextResponse } from "next/server";
import { createCapabilityHandler, ApiError } from "@/lib/api-handler";
import { nonEmptyString, object, oneOf, string } from "@/lib/validation";
import { CAPABILITIES } from "@/lib/rbac";
import { AUDIT_ACTIONS } from "@/lib/security/audit";
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
 * ids, level, and measured metrics only — never the text — in the save's
 * transaction (ADR-0003).
 */
export const PUT = createCapabilityHandler(
  CAPABILITIES.contentModerate,
  { params: levelParams, body: levelBody },
  async ({ req, params, body, session, requestId }) => {
    const result = await saveArticleLevel(params.id, params.level, body, {
      actorId: session.user.id,
      source: "manual",
      audit: (level) => ({
        req,
        session,
        requestId,
        action: AUDIT_ACTIONS.adminArticleLevelSave,
        targetType: "article",
        targetId: params.id,
        metadata: { level: params.level, wordCount: level.wordCount, lexileApprox: level.lexileApprox },
      }),
    });
    if (!result.ok) {
      throw new ApiError(result.status, result.reason === "not_found" ? "Article not found" : "Add a headline and at least one paragraph");
    }
    return NextResponse.json({ level: result.level });
  },
);

/** Removes an adapted reading level and its quiz (#1303). Audited in the same transaction. */
export const DELETE = createCapabilityHandler(
  CAPABILITIES.contentModerate,
  { params: levelParams },
  async ({ req, params, session, requestId }) => {
    const deleted = await deleteArticleLevel(params.id, params.level, () => ({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminArticleLevelDelete,
      targetType: "article",
      targetId: params.id,
      metadata: { level: params.level },
    }));
    if (!deleted) throw new ApiError(404, "Reading level not found");
    return NextResponse.json({ ok: true });
  },
);
