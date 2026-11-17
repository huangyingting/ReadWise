import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { createGuidedAnnotation, getAssignmentAnnotationReview } from "@/lib/classroom/annotations";
import { annotationError, createGuideBody } from "@/lib/classroom/annotations-http";

/**
 * Guided prompts with student replies and shared evidence (#1307), for the
 * classroom's teacher, org admin, or a system admin.
 */
export const GET = createHandler({ params: idParams }, async ({ params, session }) => {
  const result = await getAssignmentAnnotationReview(params.id, session.user);
  if (!result.ok) throw annotationError(result);
  return NextResponse.json(result.review);
});

/** Pins a passage-anchored guided prompt to the assignment. Audited (ids only). */
export const POST = createHandler(
  { params: idParams, body: createGuideBody },
  async ({ req, params, body, session, requestId }) => {
    const result = await createGuidedAnnotation(session.user, params.id, body, ({ action, targetId, metadata }) => ({
      req,
      session,
      requestId,
      action,
      targetType: "assignment_annotation",
      targetId,
      metadata,
    }));
    if (!result.ok) throw annotationError(result);
    return NextResponse.json({ guide: result.guide }, { status: 201 });
  },
);
