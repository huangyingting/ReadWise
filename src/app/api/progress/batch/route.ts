import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { object, array, string } from "@/lib/validation";
import { getProgressSummaries } from "@/lib/engagement/progress";

/** Cap to keep a single batch request bounded. */
const MAX_IDS = 200;

const bodySchema = object({
  ids: array(string({ min: 1, max: 200 }), { max: MAX_IDS }),
});

/**
 * Returns reading progress for a set of article ids in a single request so
 * listings can merge progress without issuing one request per card (no N+1).
 * Body: `{ ids: string[] }` -> `{ progress: Record<id, {percent, completed}> }`.
 */
export const POST = createHandler({ body: bodySchema }, async ({ body, session }) => {
  const ids = Array.from(new Set(body.ids)).slice(0, MAX_IDS);
  const progress = await getProgressSummaries(session.user.id, ids);
  return NextResponse.json({ progress });
});
