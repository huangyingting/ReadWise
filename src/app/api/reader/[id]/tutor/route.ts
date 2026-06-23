import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, string } from "@/lib/validation";
import { MAX_QUESTION_LENGTH, getTutorMessages, askTutor, clearTutor } from "@/lib/tutor";
import { articleAccessContext, getReadableArticleById } from "@/lib/article-access";
import { checkRateLimit } from "@/lib/rate-limit";

const questionBody = object({ question: string({ min: 1, max: MAX_QUESTION_LENGTH }) });

/** GET /api/reader/[id]/tutor — returns the user's conversation for this article. */
export const GET = createHandler({ params: idParams }, async ({ params, session }) => {
  const context = articleAccessContext(session.user);
  const article = await getReadableArticleById(params.id, context);
  if (!article) {
    throw new ApiError(404, "Article not found");
  }
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
  { params: idParams, body: questionBody },
  async ({ params, body, session }) => {
    const context = articleAccessContext(session.user);
    const article = await getReadableArticleById(params.id, context);
    if (!article) throw new ApiError(404, "Article not found");
    checkRateLimit(session.user.id, "ai");
    const result = await askTutor(session.user.id, params.id, body.question, context);
    if (!result) {
      throw new ApiError(404, "Article not found");
    }
    return NextResponse.json(result);
  },
);

/** DELETE /api/reader/[id]/tutor — clears the user's conversation for this article. */
export const DELETE = createHandler({ params: idParams }, async ({ params, session }) => {
  const article = await getReadableArticleById(params.id, articleAccessContext(session.user));
  if (!article) {
    throw new ApiError(404, "Article not found");
  }
  await clearTutor(session.user.id, params.id);
  return NextResponse.json({ ok: true });
});
