import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { object, nonEmptyString, number, optional } from "@/lib/validation";
import { recordPronunciationAttempt } from "@/lib/pronunciation";

const bodySchema = object({
  referenceText: nonEmptyString(2000),
  accuracyScore: number({ min: 0, max: 100, int: true }),
  fluencyScore: number({ min: 0, max: 100, int: true }),
  completenessScore: number({ min: 0, max: 100, int: true }),
  pronScore: number({ min: 0, max: 100, int: true }),
  articleId: optional(nonEmptyString(200)),
});

/**
 * POST /api/pronunciation/attempt
 *
 * Persists a pronunciation attempt scored by the client-side Speech SDK.
 * Returns the saved attempt and the user's all-time best pronScore.
 */
export const POST = createHandler({ body: bodySchema }, async ({ session, body }) => {
  const result = await recordPronunciationAttempt(session.user.id, body);
  return NextResponse.json(result);
});
