import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { submitAnnotationResponse } from "@/lib/classroom/annotations";
import { annotationError, responseBody } from "@/lib/classroom/annotations-http";

/**
 * A learner's reply to a guided prompt and/or an evidence highlight for one
 * of their assignments (#1307). Visible to the learner and the classroom's
 * managers only; never audited or logged.
 */
export const POST = createHandler({ params: idParams, body: responseBody }, async ({ params, body, session }) => {
  const result = await submitAnnotationResponse(session.user, params.id, body);
  if (!result.ok) throw annotationError(result);
  return NextResponse.json({ response: result.response }, { status: 201 });
});
