import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { saveProgress } from "@/lib/engagement";
import { requireReadableArticle } from "@/lib/reader/route-guard";
import { updateArticleMastery } from "@/lib/learning/article-mastery";
import { recordSkillEvidence } from "@/lib/learning/skill-mastery";
import { bestEffortMastery } from "@/lib/learning/primitives";
import { recordEvent, ANALYTICS_EVENT_TYPES } from "@/lib/analytics/events";
import { progressBody } from "@/lib/reader/schemas";

export const POST = createHandler(
  { params: idParams, body: progressBody },
  async ({ params, body, session }) => {
    const { article } = await requireReadableArticle(params.id, session.user);
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
