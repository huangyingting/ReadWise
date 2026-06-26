import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { getTutorMessages, askTutor, clearTutor } from "@/lib/ai/tutor";
import { requireReadableArticle, requireReadableArticleForAI } from "@/lib/reader/route-guard";
import { tutorBody } from "@/lib/reader/schemas";

/** GET /api/reader/[id]/tutor — returns the user's conversation for this article. */
export const GET = createHandler({ params: idParams }, async ({ params, session }) => {
  await requireReadableArticle(params.id, session.user);
  const messages = await getTutorMessages(session.user.id, params.id);
  return NextResponse.json({ messages });
});

/**
 * POST /api/reader/[id]/tutor — ask a question; returns answer + updated conversation.
 * Body: { question: string (1–MAX_QUESTION_LENGTH chars) }
 * 400 if question missing or too long; 404 if article not found.
 * Always returns { answer, fallback, messages } — fallback:true means AI unavailable.
 */
export const POST = createHandler(
  { params: idParams, body: tutorBody },
  async ({ params, body, session }) => {
    const { context } = await requireReadableArticleForAI(params.id, session.user);
    const result = await askTutor(session.user.id, params.id, body.question, context, body.paragraphContext);
    if (!result) {
      throw new ApiError(404, "Article not found");
    }
    return NextResponse.json(result);
  },
);

/** DELETE /api/reader/[id]/tutor — clears the user's conversation for this article. */
export const DELETE = createHandler({ params: idParams }, async ({ params, session }) => {
  await requireReadableArticle(params.id, session.user);
  await clearTutor(session.user.id, params.id);
  return NextResponse.json({ ok: true });
});
