import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import {
  array,
  idParams,
  nonEmptyString,
  number,
  object,
  optional,
  string,
} from "@/lib/validation";
import { articleAccessContext } from "@/lib/article-library";
import { bulkCreateArticleAssignments } from "@/lib/classroom/article-assignments";
import { requireActiveClassroomManageApi } from "@/lib/tenant-api";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";

const bulkBody = object({
  articleIds: array(nonEmptyString(200), { max: 50 }),
  dueDate: optional(string({ min: 1, max: 40 })),
  instructions: optional(string({ max: 2000 })),
  points: optional(number({ min: 0, max: 10000, int: true })),
  studentIds: optional(array(nonEmptyString(200), { max: 200 })),
});

export const POST = createHandler(
  { params: idParams, body: bulkBody },
  async ({ req, params, body, session, requestId }) => {
    if (body.articleIds.length === 0) {
      throw new ApiError(400, "No articles selected");
    }

    const { classroom } = await requireActiveClassroomManageApi(session, params.id);
    const { created, failed } = await bulkCreateArticleAssignments({
      classroomId: classroom.id,
      organizationId: classroom.orgId,
      articleIds: body.articleIds,
      accessContext: articleAccessContext(session.user, classroom.orgId),
      dueDate: body.dueDate,
      instructions: body.instructions ?? null,
      points: body.points ?? null,
      studentIds: body.studentIds,
    });

    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.assignmentCreate,
      targetType: "classroom",
      targetId: classroom.id,
      metadata: {
        classroomId: classroom.id,
        requested: body.articleIds.length,
        created: created.length,
        failed: failed.length,
        targeted: Boolean(body.studentIds && body.studentIds.length > 0),
      },
    });

    return NextResponse.json({ created, failed }, { status: 201 });
  },
);
