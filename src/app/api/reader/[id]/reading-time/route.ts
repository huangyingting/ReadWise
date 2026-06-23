import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, number } from "@/lib/validation";
import { articleAccessContext, getReadableArticleById } from "@/lib/article-access";
import { updateArticleMastery } from "@/lib/article-mastery";
import { clampActiveTime, MAX_ACTIVE_TIME_MS } from "@/lib/reading-speed";

const bodySchema = object({
  activeMs: number({ min: 0, max: MAX_ACTIVE_TIME_MS }),
});

/**
 * POST /api/reader/[id]/reading-time (#378)
 *
 * Accepts the active reading time (in ms) for a session with this article and
 * ACCUMULATES it into `ArticleMastery.timeSpentMs`. The client sends a delta
 * (time spent in this session), not the running total, so the server simply
 * adds it to whatever is already stored. This makes the route idempotent-safe
 * and collision-friendly across multiple tabs / devices.
 *
 * Body:    { activeMs: number }  — clamped server-side to MAX_ACTIVE_TIME_MS.
 * Returns: { timeSpentMs: number | null }
 * Errors:  401 (unauthenticated) · 404 (article not found / access denied)
 */
export const POST = createHandler(
  { params: idParams, body: bodySchema },
  async ({ params, body, session }) => {
    const article = await getReadableArticleById(
      params.id,
      articleAccessContext(session.user),
    );
    if (!article) {
      throw new ApiError(404, "Article not found");
    }

    // Belt-and-suspenders clamp (schema already enforces max, but be explicit).
    const deltaMs = clampActiveTime(body.activeMs);

    const mastery = await updateArticleMastery(session.user.id, params.id, {
      timeSpentMs: deltaMs,
      accumulateTime: true,
    });

    return NextResponse.json({
      timeSpentMs: mastery?.timeSpentMs ?? null,
    });
  },
);
