import { NextResponse } from "next/server";
import type { AssignmentStatus as AssignmentStatusType } from "@prisma/client";
import { AssignmentStatus } from "@prisma/client";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, oneOf, optional, clampedInt } from "@/lib/validation";
import {
  getStudentAssignmentContext,
  recordAssignmentCompletion,
} from "@/lib/classroom";

const STATUSES = [
  AssignmentStatus.ASSIGNED,
  AssignmentStatus.IN_PROGRESS,
  AssignmentStatus.COMPLETED,
] as const;

const completionBody = object({
  status: optional(oneOf<AssignmentStatusType>(STATUSES)),
  quizScore: optional(clampedInt(0, 100)),
});

/**
 * Records the AUTHENTICATED student's own progress on an assignment (RW-061).
 * A student may only report completion for an assignment in a classroom they
 * belong to (404 otherwise) — never on a peer's behalf; the studentId is taken
 * from the session, not the body.
 */
export const POST = createHandler(
  { params: idParams, body: completionBody },
  async ({ params, body, session }) => {
    const context = await getStudentAssignmentContext(params.id, session.user.id);
    if (!context) throw new ApiError(404, "Assignment not found");

    const completion = await recordAssignmentCompletion(params.id, session.user.id, {
      status: body.status,
      quizScore: body.quizScore,
    });
    return NextResponse.json({ ok: true, completion }, { status: 201 });
  },
);
