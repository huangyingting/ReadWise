import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { votePoll } from "@/lib/classroom/activities";
import { activityError, voteBody } from "@/lib/classroom/activities-http";

/** Records a student's pre-reading poll vote and returns the distribution (#1304). */
export const POST = createHandler({ params: idParams, body: voteBody }, async ({ params, body, session }) => {
  const result = await votePoll(session.user, params.id, body.optionIndex);
  if (!result.ok) throw activityError(result);
  return NextResponse.json({ myVote: result.myVote, distribution: result.distribution });
});
