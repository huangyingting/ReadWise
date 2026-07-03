import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { object, nonEmptyString, clampedInt, optional } from "@/lib/validation";
import { recordPronunciationAttempt } from "@/lib/pronunciation";
import { checkRateLimit } from "@/lib/security/rate-limit/index";
import { articleAccessContext, getReadableArticleById } from "@/lib/article-library";
import { recordSkillEvidence } from "@/lib/learning/skill-mastery";
import { bestEffortMastery } from "@/lib/learning/primitives";

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

type PronunciationAttemptBody = Parameters<typeof recordPronunciationAttempt>[1];

async function assertReadableArticle(articleId: string | undefined, user: Parameters<typeof articleAccessContext>[0]) {
  if (!articleId) return;

  const article = await getReadableArticleById(articleId, articleAccessContext(user));
  if (!article) {
    throw new ApiError(404, "Article not found");
  }
}

async function recordPronunciationMastery(userId: string, body: PronunciationAttemptBody) {
  await Promise.all([
    bestEffortMastery("pronunciation.skill", () =>
      recordSkillEvidence(userId, "pronunciation", body.pronScore / 100),
    ),
    bestEffortMastery("pronunciation.listening_skill", () =>
      recordSkillEvidence(userId, "listening", body.accuracyScore / 100, 0.5),
    ),
  ]);
}

/**
 * POST /api/pronunciation/attempt
 *
 * Persists a pronunciation attempt scored by the client-side Speech SDK.
 * Returns the saved attempt and the user's all-time best pronScore.
 */
export const POST = createHandler({ body: bodySchema }, async ({ session, body }) => {
  await checkRateLimit(session.user.id, "ai");

  await assertReadableArticle(body.articleId, session.user);

  const result = await recordPronunciationAttempt(session.user.id, body);
  // Best-effort mastery: pronunciation score feeds the pronunciation skill;
  // accuracy is a (weaker) listening signal. Never break the attempt write.
  await recordPronunciationMastery(session.user.id, body);
  return NextResponse.json(result);
});
