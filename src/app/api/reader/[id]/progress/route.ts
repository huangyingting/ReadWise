import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, number } from "@/lib/validation";
import { saveProgress } from "@/lib/progress";
import { articleAccessContext, getReadableArticleById } from "@/lib/article-access";
import { updateArticleMastery } from "@/lib/article-mastery";
import { recordSkillEvidence } from "@/lib/skill-mastery";
import { bestEffortMastery } from "@/lib/mastery";
import { recordEvent, ANALYTICS_EVENT_TYPES } from "@/lib/analytics/events";

const bodySchema = object({ percent: number({ min: 0, max: 100 }) });

export const POST = createHandler(
  { params: idParams, body: bodySchema },
  async ({ params, body, session }) => {
    const article = await getReadableArticleById(params.id, articleAccessContext(session.user));
    if (!article) {
      throw new ApiError(404, "Article not found");
    }
    const progress = await saveProgress(session.user.id, article.id, body.percent);
    // Best-effort mastery side-effects — never break the progress write.
    await Promise.all([
      bestEffortMastery("progress.article_mastery", () =>
        updateArticleMastery(session.user.id, article.id),
      ),
      bestEffortMastery("progress.reading_skill", () =>
        recordSkillEvidence(session.user.id, "reading", progress.percent / 100, 0.5),
      ),
    ]);
    // Product analytics (RW-051): emit progress_complete when the article first
    // reaches completion. saveProgress is forward-only + sticky, so this fires
    // around the completion transition. Metadata only.
    if (progress.completed) {
      await recordEvent({
        type: ANALYTICS_EVENT_TYPES.progressComplete,
        userId: session.user.id,
        articleId: article.id,
        properties: { percent: progress.percent, category: article.category },
      });
    }
    return NextResponse.json({
      percent: progress.percent,
      completed: progress.completed,
    });
  },
);
