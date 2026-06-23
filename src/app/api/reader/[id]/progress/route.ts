import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, number } from "@/lib/validation";
import { saveProgress } from "@/lib/progress";
import { articleAccessContext, getReadableArticleById } from "@/lib/article-access";

const bodySchema = object({ percent: number({ min: 0, max: 100 }) });

export const POST = createHandler(
  { params: idParams, body: bodySchema },
  async ({ params, body, session }) => {
    const article = await getReadableArticleById(params.id, articleAccessContext(session.user));
    if (!article) {
      throw new ApiError(404, "Article not found");
    }
    const progress = await saveProgress(session.user.id, article.id, body.percent);
    return NextResponse.json({
      percent: progress.percent,
      completed: progress.completed,
    });
  },
);
