import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { object, nonEmptyString } from "@/lib/validation";
import { recordTodayReflection } from "@/lib/learning/review-assets";
import { HIGHLIGHT_NOTE_MAX } from "@/lib/annotations/anchor";
import { isTodaySessionFeatureEnabled } from "@/lib/runtime-config/feature-flags";

/**
 * POST /api/today/reflection
 *
 * Optional Today completion bonus (#812): "write one sentence after reading".
 * The sentence is stored in the EXISTING note domain — the `note` of one of the
 * learner's own highlights — and NEVER in the `TodaySession` row or analytics,
 * so it cannot block or alter required Today completion. Purely additive and
 * easy to skip (the client simply never calls this).
 *
 * Body: { highlightId: string, sentence: string }
 * Response 200: { ok: true, highlightId }
 * Errors: 400 empty/too-long sentence; 401 unauthenticated; 404 feature
 * disabled or highlight not found / not owned by the caller.
 */
const reflectionBody = object({
  highlightId: nonEmptyString(200),
  sentence: nonEmptyString(HIGHLIGHT_NOTE_MAX),
});

export const POST = createHandler(
  { body: reflectionBody },
  async ({ body, session }) => {
    if (!isTodaySessionFeatureEnabled()) {
      throw new ApiError(404, "Not found");
    }
    const result = await recordTodayReflection({
      userId: session.user.id,
      highlightId: body.highlightId,
      sentence: body.sentence,
    });
    if (!result.ok) {
      throw new ApiError(result.status, result.error);
    }
    return NextResponse.json({ ok: true, highlightId: result.highlightId });
  },
);
