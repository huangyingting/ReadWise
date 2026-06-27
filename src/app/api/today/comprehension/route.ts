import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import {
  object,
  optional,
  string,
  oneOf,
  clampedInt,
  boolean,
  queryString,
} from "@/lib/validation";
import {
  COMPREHENSION_SELF_RATINGS,
  COMPREHENSION_SKILL_TAGS,
  loadTodayComprehensionCheck,
  submitTodayComprehension,
} from "@/lib/engagement/today-session/comprehension";
import { isTodaySessionFeatureEnabled } from "@/lib/runtime-config/feature-flags";

/**
 * Today comprehension self-check & remediation (#807).
 *
 * GET  /api/today/comprehension
 *   Returns the day's optional comprehension MCQ (id + display text + options,
 *   NEVER `correctIndex`) plus the article deep-link anchor and whether the step
 *   is already complete / submitted. Degrades to self-rating only when the
 *   primary article has no cached `QuizQuestion` rows.
 *
 * POST /api/today/comprehension
 *   Submits a low-pressure self-rating (and optional MCQ selection). The
 *   self-rating ALONE advances the Today comprehension step — no full quiz is
 *   required. The MCQ is graded SERVER-SIDE against the cached
 *   `QuizQuestion.correctIndex`; a wrong answer returns a remediation deep-link.
 *   Weakness signals feed the existing mastery paths. The action is always
 *   scoped to the authenticated user — a userId is never read from the body.
 *
 *   Body: { selfRating, questionId?, selectedIndex?, skillTag?, remediationViewed?, timezone? }
 *   Response 200: { updated, status, completionTier, completed, mcqCorrect, remediation }
 *
 * Both verbs 404 when the Today feature flag is off, mirroring the other Today
 * routes. The persisted row + the response carry IDS / ENUMS / BOOLEANS ONLY —
 * never article text, question text, answer/option text, or prompts.
 */
export const GET = createHandler(
  {
    query: (params) => ({
      ok: true as const,
      value: { timezone: queryString(params, "timezone").trim() || null },
    }),
  },
  async ({ query, session }) => {
    if (!isTodaySessionFeatureEnabled()) {
      throw new ApiError(404, "Not found");
    }
    const check = await loadTodayComprehensionCheck({
      userId: session.user.id,
      requestTimezone: query.timezone,
    });
    return NextResponse.json(check);
  },
);

const comprehensionBody = object({
  selfRating: oneOf(COMPREHENSION_SELF_RATINGS),
  questionId: optional(string({ max: 200 })),
  selectedIndex: optional(clampedInt(0, 50)),
  skillTag: optional(oneOf(COMPREHENSION_SKILL_TAGS)),
  remediationViewed: optional(boolean()),
  timezone: optional(string({ max: 100 })),
});

export const POST = createHandler(
  { body: comprehensionBody },
  async ({ body, session }) => {
    if (!isTodaySessionFeatureEnabled()) {
      throw new ApiError(404, "Not found");
    }

    const result = await submitTodayComprehension({
      userId: session.user.id,
      requestTimezone: body.timezone ?? null,
      selfRating: body.selfRating,
      questionId: body.questionId ?? null,
      selectedIndex: body.selectedIndex ?? null,
      skillTag: body.skillTag ?? null,
      remediationViewed: body.remediationViewed ?? false,
    });

    if (!result) {
      // No active Today session, or a no-candidate day with no primary article.
      return NextResponse.json({ updated: false });
    }

    return NextResponse.json(result);
  },
);
