import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { object, nonEmptyString, nullable, number, optional, string } from "@/lib/validation";
import {
  getAssignmentClassroom,
  getStudentAssignmentContext,
  reviewAssignmentCompletion,
} from "@/lib/classroom";
import { requireActiveClassroomManageApi } from "@/lib/tenant-api";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";

const reviewParams = object({
  id: nonEmptyString(200),
  studentId: nonEmptyString(200),
});

const reviewBody = object({
  feedback: optional(string({ max: 2000 })),
  pointsAwarded: nullable(number({ min: 0, max: 100000, int: true })),
});

/**
 * Teacher leaves written feedback on a student's assignment completion (GAP-2).
 * Manage-gated: the caller must manage the assignment's classroom. The target
 * student must be enrolled in that classroom (404 otherwise). Stamps reviewedAt
 * + reviewedBy (session user id). An empty/absent feedback clears the note
 * while still recording the review (acknowledgement).
 */
export const PATCH = createHandler(
  { params: reviewParams, body: reviewBody },
  async ({ req, params, body, session, requestId }) => {
    const assignment = await getAssignmentClassroom(params.id);
    if (!assignment) throw new ApiError(404, "Assignment not found");
    await requireActiveClassroomManageApi(session, assignment.classroomId);
    if (body.pointsAwarded != null && assignment.points != null && body.pointsAwarded > assignment.points) {
      throw new ApiError(400, "Awarded score exceeds assignment points");
    }

    const studentContext = await getStudentAssignmentContext(params.id, params.studentId);
    if (!studentContext) throw new ApiError(404, "Student is not enrolled in this assignment");

    const completion = await reviewAssignmentCompletion(params.id, params.studentId, {
      feedback: body.feedback ?? null,
      pointsAwarded: body.pointsAwarded,
      reviewedBy: session.user.id,
    });

    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.assignmentReview,
      targetType: "assignment",
      targetId: params.id,
      metadata: {
        assignmentId: params.id,
        classroomId: assignment.classroomId,
        studentId: params.studentId,
        hasFeedback: Boolean(body.feedback && body.feedback.trim()),
        scoreAction: body.pointsAwarded === undefined
          ? "unchanged"
          : body.pointsAwarded === null
            ? "cleared"
            : "set",
      },
    });

    return NextResponse.json({ completion });
  },
);
