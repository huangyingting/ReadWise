import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { saveProgress } from "@/lib/engagement/progress";
import { requireReadableArticle } from "@/lib/reader/route-guard";
import { updateArticleMastery } from "@/lib/learning/article-mastery";
import { recordSkillEvidence } from "@/lib/learning/skill-mastery";
import { bestEffortMastery } from "@/lib/learning/primitives";
import { recordEvent, ANALYTICS_EVENT_TYPES } from "@/lib/analytics/events";
import { progressBody } from "@/lib/reader/schemas";
import { revalidateUserCache } from "@/lib/cache";
import { syncTodayReadingFromProgress } from "@/lib/engagement/today-session/completion";

type ProgressWrite = {
  percent: number;
  completed: boolean;
};

function progressResponse(progress: ProgressWrite) {
  return NextResponse.json({
    percent: progress.percent,
    completed: progress.completed,
  });
}

async function recordProgressMastery(userId: string, articleId: string, percent: number) {
  await Promise.all([
    bestEffortMastery("progress.article_mastery", () =>
      updateArticleMastery(userId, articleId),
    ),
    bestEffortMastery("progress.reading_skill", () =>
      recordSkillEvidence(userId, "reading", percent / 100, 0.5),
    ),
  ]);
}

async function syncTodayReadingProgress(
  userId: string,
  articleId: string,
  progress: ProgressWrite,
) {
  await bestEffortMastery("progress.today_reading", () =>
    syncTodayReadingFromProgress({
      userId,
      articleId,
      percent: progress.percent,
      completed: progress.completed,
    }),
  );
}

export const POST = createHandler(
  { params: idParams, body: progressBody },
  async ({ params, body, session }) => {
    const { article } = await requireReadableArticle(params.id, session.user);
    const progress = await saveProgress(session.user.id, article.id, body.percent);
    // Best-effort mastery side-effects — never break the progress write.
    await recordProgressMastery(session.user.id, article.id, progress.percent);
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
      // Completed articles are hard-excluded from the personalised feed — bust
      // the user's feed cache so the next request reflects the completion.
      revalidateUserCache(session.user.id);
    }
    // Best-effort: advance the learner's active Today session reading step when
    // the primary article reaches the completion threshold. Never breaks the
    // progress write and never mutates ReadingProgress.
    await syncTodayReadingProgress(session.user.id, article.id, progress);
    return progressResponse(progress);
  },
);
