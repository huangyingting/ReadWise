import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, number, object, optional, string, nonEmptyString } from "@/lib/validation";
import { articleAccessContext } from "@/lib/article-library";
import { createArticleAssignment } from "@/lib/classroom/article-assignments";
import { requireActiveClassroomManageApi } from "@/lib/tenant-api";

const assignBody = object({
  articleId: nonEmptyString(200),
  dueDate: optional(string({ min: 1, max: 40 })),
  instructions: optional(string({ max: 2000 })),
  title: optional(string({ max: 200 })),
  points: optional(number({ min: 0, max: 10000, int: true })),
});

/**
 * Assigns an article (public OR org/private) to a classroom (RW-061). Requires
 * the caller to manage the classroom. Validates the article exists and that an
 * optional due date parses to a real date.
 */
export const POST = createHandler(
  { params: idParams, body: assignBody },
  async ({ params, body, session }) => {
    const { classroom } = await requireActiveClassroomManageApi(session, params.id);
    const result = await createArticleAssignment({
      classroomId: classroom.id,
      organizationId: classroom.orgId,
      articleId: body.articleId,
      accessContext: articleAccessContext(session.user, classroom.orgId),
      dueDate: body.dueDate,
      instructions: body.instructions ?? null,
      title: body.title ?? null,
      points: body.points ?? null,
    });
    if (!result.ok) {
      throw new ApiError(
        result.status,
        result.reason === "invalid_due_date"
          ? "Invalid due date"
          : result.reason === "article_not_found" || result.status === 404
          ? "Article not found"
          : "Article organization scope is invalid",
      );
    }
    return NextResponse.json({ assignment: result.assignment }, { status: 201 });
  },
);
