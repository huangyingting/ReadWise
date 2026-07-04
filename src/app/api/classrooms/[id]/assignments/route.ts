import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, optional, string, nonEmptyString } from "@/lib/validation";
import { assignArticle } from "@/lib/classroom";
import { requireClassroomManageApi } from "@/lib/tenant-api";
import { getOrganizationAssignableArticle } from "@/lib/article-library";

const assignBody = object({
  articleId: nonEmptyString(200),
  dueDate: optional(string({ min: 1, max: 40 })),
  instructions: optional(string({ max: 2000 })),
});

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
    const { classroom } = await requireClassroomManageApi(session, params.id);

    const article = await getOrganizationAssignableArticle(body.articleId, classroom.orgId);
    if (!article.ok) {
      throw new ApiError(
        article.status,
        article.reason === "article_not_found" || article.status === 404
          ? "Article not found"
          : "Article organization scope is invalid",
      );
    }
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
