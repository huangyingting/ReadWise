import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import {
  array,
  idParams,
  nonEmptyString,
  number,
  object,
  oneOf,
  optional,
  string,
} from "@/lib/validation";
import { articleAccessContext } from "@/lib/article-library";
import { createArticleAssignment } from "@/lib/classroom/article-assignments";
import { requireActiveClassroomManageApi } from "@/lib/tenant-api";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";

const assignBody = object({
  articleId: nonEmptyString(200),
  dueDate: optional(string({ min: 1, max: 40 })),
  instructions: optional(string({ max: 2000 })),
  title: optional(string({ max: 200 })),
  points: optional(number({ min: 0, max: 10000, int: true })),
  studentIds: optional(array(nonEmptyString(200), { max: 200 })),
  publishState: optional(oneOf(["DRAFT", "SCHEDULED", "PUBLISHED"] as const)),
  publishAt: optional(string({ max: 40 })),
});

/**
 * Assigns an article (public OR org/private) to a classroom (RW-061). Requires
 * the caller to manage the classroom. Validates the article exists and that an
 * optional due date parses to a real date.
 */
export const POST = createHandler(
  { params: idParams, body: assignBody },
  async ({ req, params, body, session, requestId }) => {
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
      studentIds: body.studentIds,
      publishState: body.publishState,
      publishAt: body.publishAt,
    });
    if (!result.ok) {
      throw new ApiError(
        result.status,
        result.reason === "invalid_due_date"
          ? "Invalid due date"
          : result.reason === "invalid_publish_at"
          ? "Invalid publish time"
          : result.reason === "invalid_target_students"
          ? "Select at least one enrolled student to target"
          : result.reason === "article_not_found" || result.status === 404
          ? "Article not found"
          : "Article organization scope is invalid",
      );
    }
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.assignmentCreate,
      targetType: "classroom",
      targetId: classroom.id,
      metadata: {
        classroomId: classroom.id,
        assignmentId: result.assignment.id,
        articleId: body.articleId,
        targeted: body.studentIds?.length ?? 0,
        publishState: body.publishState ?? "PUBLISHED",
        scheduled: body.publishState === "SCHEDULED",
      },
    });
    return NextResponse.json({ assignment: result.assignment }, { status: 201 });
  },
);
