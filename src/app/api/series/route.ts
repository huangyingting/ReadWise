import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { listPublicSeriesForUser } from "@/lib/engagement/series";

/**
 * GET /api/series
 *
 * Returns the authenticated learner's view of the public, active curated
 * reading series (#813) with their per-series enrollment state attached. The
 * payload carries series METADATA and COUNTS only (slug, title, topic, target
 * level range, article count, enrollment status/position) — never article ids,
 * article text, or any reading history. Always scoped to the authenticated
 * user. Unauthenticated requests are rejected with 401 by the handler wrapper.
 */
export const GET = createHandler({}, async ({ session }) => {
  const series = await listPublicSeriesForUser(session.user.id);
  return NextResponse.json({ series });
});
