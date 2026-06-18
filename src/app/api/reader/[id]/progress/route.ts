import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, number } from "@/lib/validation";
import { saveProgress } from "@/lib/progress";

const bodySchema = object({ percent: number() });

export const POST = createHandler(
  { params: idParams, body: bodySchema },
  async ({ params, body, session }) => {
    const article = await prisma.article.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
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
