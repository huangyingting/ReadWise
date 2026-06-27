import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { deleteCoachMemory } from "@/lib/learning/coach-memory";

/**
 * DELETE /api/coach-memory — user-facing "clear learning memory" (#810).
 *
 * Hard-deletes every `LearnerCoachMemory` row for the authenticated user and
 * returns 204. Does NOT touch `SkillMastery` (the source of truth), so the
 * learner's underlying mastery data is preserved and memory simply rebuilds
 * from future activity.
 */
export const DELETE = createHandler({}, async ({ session }) => {
  await deleteCoachMemory(session.user.id);
  return new NextResponse(null, { status: 204 });
});
