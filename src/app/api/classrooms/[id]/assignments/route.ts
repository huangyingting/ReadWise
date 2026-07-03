import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, optional, string, nonEmptyString } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { assignArticle } from "@/lib/classroom";
import { requireClassroomManageApi } from "@/lib/tenant-api";

const assignBody = object({
  articleId: nonEmptyString(200),
  dueDate: optional(string({ min: 1, max: 40 })),
  instructions: optional(string({ max: 2000 })),
});

async function ensureArticleExists(articleId: string) {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { id: true },
  });
  if (!article) throw new ApiError(404, "Article not found");
}

function parseOptionalDueDate(dueDate: string | undefined): Date | null {
  if (!dueDate) return null;

  const parsed = new Date(dueDate);
  if (Number.isNaN(parsed.getTime())) throw new ApiError(400, "Invalid due date");
  return parsed;
}

/**
 * Assigns an article (public OR org/private) to a classroom (RW-061). Requires
 * the caller to manage the classroom. Validates the article exists and that an
 * optional due date parses to a real date.
 */
export const POST = createHandler(
  { params: idParams, body: assignBody },
  async ({ params, body, session }) => {
    await requireClassroomManageApi(session, params.id);

    await ensureArticleExists(body.articleId);
    const dueDate = parseOptionalDueDate(body.dueDate);

    const assignment = await assignArticle({
      classroomId: params.id,
      articleId: body.articleId,
      dueDate,
      instructions: body.instructions ?? null,
    });
    return NextResponse.json({ assignment }, { status: 201 });
  },
);
