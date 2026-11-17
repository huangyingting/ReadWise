import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { answerCheck } from "@/lib/classroom/activities";
import { activityError, answerBody } from "@/lib/classroom/activities-http";

/** Grades a student's first answer to a Check for Understanding (#1304). */
export const POST = createHandler({ params: idParams, body: answerBody }, async ({ params, body, session }) => {
  const result = await answerCheck(session.user, params.id, body.selectedIndex);
  if (!result.ok) throw activityError(result);
  return NextResponse.json({ result: result.result });
});
