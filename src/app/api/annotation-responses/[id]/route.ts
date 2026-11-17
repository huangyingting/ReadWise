import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { deleteAnnotationResponse } from "@/lib/classroom/annotations";
import { annotationError } from "@/lib/classroom/annotations-http";

/** Withdraws one of the learner's own annotation responses (#1307). */
export const DELETE = createHandler({ params: idParams }, async ({ params, session }) => {
  const result = await deleteAnnotationResponse(session.user, params.id);
  if (!result.ok) throw annotationError(result);
  return NextResponse.json({ ok: true });
});
