import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { throwIfFailed } from "@/lib/result";
import { idParams, object, nonEmptyString } from "@/lib/validation";
import { renameList, deleteList } from "@/lib/bookmarks";

const renameBodySchema = object({ name: nonEmptyString(200) });

/** PATCH /api/lists/[id] — renames a list (ownership-checked). */
export const PATCH = createHandler(
  { params: idParams, body: renameBodySchema },
  async ({ params, body, session }) => {
    const result = await renameList(params.id, session.user.id, body.name);
    throwIfFailed(result);
    return NextResponse.json({ list: result.list });
  },
);

/** DELETE /api/lists/[id] — deletes a list (ownership-checked; 409 for default). */
export const DELETE = createHandler(
  { params: idParams },
  async ({ params, session }) => {
    const result = await deleteList(params.id, session.user.id);
    throwIfFailed(result);
    return NextResponse.json({ ok: true });
  },
);
