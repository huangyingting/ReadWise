import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { object, nonEmptyString, clampedInt, optional } from "@/lib/validation";
import { recordPronunciationAttempt } from "@/lib/pronunciation";
import { checkRateLimit } from "@/lib/rate-limit";
import { articleAccessContext, getReadableArticleById } from "@/lib/article-access";

/**
 * Pronunciation scores are computed CLIENT-SIDE by the Azure Speech SDK (by
 * design — the recorded audio is never uploaded to the server). The server can
 * therefore not re-score; instead it CLAMPS each score to an integer 0–100,
 * bounds the reference text length, drops any unknown payload fields (e.g. raw
 * word/phoneme arrays are not persisted), and rate-limits the endpoint so a
 * forged/out-of-range value cannot corrupt history/aggregates.
 */
const bodySchema = object({
  referenceText: nonEmptyString(2000),
  accuracyScore: clampedInt(0, 100),
  fluencyScore: clampedInt(0, 100),
  completenessScore: clampedInt(0, 100),
  pronScore: clampedInt(0, 100),
  articleId: optional(nonEmptyString(200)),
});

/**
 * POST /api/pronunciation/attempt
 *
 * Persists a pronunciation attempt scored by the client-side Speech SDK.
 * Returns the saved attempt and the user's all-time best pronScore.
 */
export const POST = createHandler({ body: bodySchema }, async ({ session, body }) => {
  checkRateLimit(session.user.id, "ai");

  // Validate articleId existence when provided.
  if (body.articleId) {
    const article = await getReadableArticleById(body.articleId, articleAccessContext(session.user));
    if (!article) {
      throw new ApiError(404, "Article not found");
    }
  }

  const result = await recordPronunciationAttempt(session.user.id, body);
  return NextResponse.json(result);
});
