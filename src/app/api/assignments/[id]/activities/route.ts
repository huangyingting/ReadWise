import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { getAssignmentActivities } from "@/lib/classroom/activities";
import { activityError } from "@/lib/classroom/activities-http";

/** The assignment's poll and checks with aggregate results (#1304), for classroom managers. */
export const GET = createHandler({ params: idParams }, async ({ params, session }) => {
  const result = await getAssignmentActivities(session.user, params.id);
  if (!result.ok) throw activityError(result);
  return NextResponse.json(result.activities);
});
