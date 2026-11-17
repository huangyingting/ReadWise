import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { listAssignmentSubmissions } from "@/lib/classroom/writing";
import { writeError } from "@/lib/classroom/writing-http";

/**
 * Submitted written responses for an assignment (#1305), for its classroom's
 * teacher, org admin, or a system admin. Drafts are never included.
 */
export const GET = createHandler({ params: idParams }, async ({ params, session }) => {
  const result = await listAssignmentSubmissions(params.id, session.user);
  if (!result.ok) throw writeError(result);
  return NextResponse.json({ assignment: result.assignment, submissions: result.submissions });
});
