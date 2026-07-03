import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { object, array, string } from "@/lib/validation";
import { getProgressSummaries } from "@/lib/engagement/progress";

/** Cap to keep a single batch request bounded. */
const MAX_IDS = 200;
const MAX_ARTICLE_ID_LENGTH = 200;

const bodySchema = object({
  ids: array(string({ min: 1, max: MAX_ARTICLE_ID_LENGTH }), { max: MAX_IDS }),
});

function uniqueBoundedIds(ids: string[]): string[] {
  return Array.from(new Set(ids)).slice(0, MAX_IDS);
}

/**
 * Returns reading progress for a set of article ids in a single request so
 * listings can merge progress without issuing one request per card (no N+1).
 * Body: `{ ids: string[] }` -> `{ progress: Record<id, {percent, completed}> }`.
 */
export const POST = createHandler({ body: bodySchema }, async ({ body, session }) => {
  const ids = uniqueBoundedIds(body.ids);
  const progress = await getProgressSummaries(session.user.id, ids);
  return NextResponse.json({ progress });
});
