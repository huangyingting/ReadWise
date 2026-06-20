import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { object, nonEmptyString } from "@/lib/validation";
import { getUserLists, createList } from "@/lib/bookmarks";

const createBodySchema = object({ name: nonEmptyString(200) });

/** GET /api/lists — returns all lists for the authenticated user. */
export const GET = createHandler({}, async ({ session }) => {
  const lists = await getUserLists(session.user.id);
  return NextResponse.json({ lists });
});

/** POST /api/lists — creates a new named list. */
export const POST = createHandler({ body: createBodySchema }, async ({ body, session }) => {
  const list = await createList(session.user.id, body.name);
  return NextResponse.json({ list }, { status: 201 });
});
