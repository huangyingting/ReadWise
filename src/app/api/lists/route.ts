import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { object, nonEmptyString } from "@/lib/validation";
import { getUserLists, createList } from "@/lib/article-library";

const createBodySchema = object({ name: nonEmptyString(200) });

function listsResponse(lists: Awaited<ReturnType<typeof getUserLists>>) {
  return NextResponse.json({ lists });
}

function createdListResponse(list: Awaited<ReturnType<typeof createList>>) {
  return NextResponse.json({ list }, { status: 201 });
}

/** GET /api/lists — returns all lists for the authenticated user. */
export const GET = createHandler({}, async ({ session }) => {
  const lists = await getUserLists(session.user.id);
  return listsResponse(lists);
});

/** POST /api/lists — creates a new named list. */
export const POST = createHandler({ body: createBodySchema }, async ({ body, session }) => {
  const list = await createList(session.user.id, body.name);
  return createdListResponse(list);
});
