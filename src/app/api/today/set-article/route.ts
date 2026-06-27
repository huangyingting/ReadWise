import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { object, nonEmptyString, optional, string } from "@/lib/validation";
import {
  setTodayPrimaryArticle,
  SetTodayArticleError,
  loadTodayViewModel,
} from "@/lib/engagement/today-session";
import { isTodaySessionFeatureEnabled } from "@/lib/runtime-config/feature-flags";

/**
 * POST /api/today/set-article
 *
 * Lets the authenticated learner override the generated Today primary with a
 * readable article they choose (v1.1, #805). The article must be readable by the
 * learner via the Article Library policy and `PUBLISHED`; an inaccessible/missing
 * id returns 404 (IDOR-safe — existence is never leaked) and a readable-but-not-
 * ready (processing/failed) article returns 409 with clear messaging. On success
 * the day's primary is swapped to `source = "user_selected"`, the replaced
 * generated id is retained as a backup anchor, and `ReadingProgress` is never
 * touched. The action is always scoped to the authenticated user — the body can
 * never select another user's session — and returns the refreshed Today view
 * model. 404s when the feature is disabled, mirroring the other Today routes.
 *
 * Body: { articleId: string, timezone?: string }
 * Response 200: TodayViewModel — anchors/ids/statuses/safe display only.
 */
const setArticleBody = object({
  articleId: nonEmptyString(200),
  timezone: optional(string({ max: 100 })),
});

export const POST = createHandler(
  { body: setArticleBody },
  async ({ body, session }) => {
    if (!isTodaySessionFeatureEnabled()) {
      throw new ApiError(404, "Not found");
    }

    try {
      await setTodayPrimaryArticle({
        user: { id: session.user.id, role: session.user.role },
        articleId: body.articleId,
        requestTimezone: body.timezone ?? null,
      });
    } catch (err) {
      if (err instanceof SetTodayArticleError) {
        // not_found → 404 (IDOR-safe); not_ready (processing/failed) → 409.
        throw new ApiError(err.code === "not_found" ? 404 : 409, err.message);
      }
      throw err;
    }

    const view = await loadTodayViewModel({
      user: { id: session.user.id, role: session.user.role },
      requestTimezone: body.timezone ?? null,
    });

    return NextResponse.json(view);
  },
);
