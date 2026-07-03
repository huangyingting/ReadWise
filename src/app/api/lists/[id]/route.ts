import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { throwIfFailed } from "@/lib/result";
import { idParams, object, nonEmptyString } from "@/lib/validation";
import { renameList, deleteList } from "@/lib/article-library";

const renameBodySchema = object({ name: nonEmptyString(200) });

async function renameOwnedList(listId: string, userId: string, name: string) {
  const result = await renameList(listId, userId, name);
  throwIfFailed(result);
  return result.list;
}

async function deleteOwnedList(listId: string, userId: string) {
  const result = await deleteList(listId, userId);
  throwIfFailed(result);
}

/** PATCH /api/lists/[id] — renames a list (ownership-checked). */
export const PATCH = createHandler(
  { params: idParams, body: renameBodySchema },
  async ({ params, body, session }) => {
    const list = await renameOwnedList(params.id, session.user.id, body.name);
    return NextResponse.json({ list });
  },
);

/** DELETE /api/lists/[id] — deletes a list (ownership-checked; 409 for default). */
export const DELETE = createHandler(
  { params: idParams },
  async ({ params, session }) => {
    await deleteOwnedList(params.id, session.user.id);
    return NextResponse.json({ ok: true });
  },
);
