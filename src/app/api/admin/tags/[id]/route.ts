import { NextResponse } from "next/server";
import { createAdminHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, nonEmptyString } from "@/lib/validation";
import { deleteTag, renameTag } from "@/lib/admin-tags";
import { revalidateTagsCache } from "@/lib/cache";

const renameBody = object({ name: nonEmptyString(200) });

export const PATCH = createAdminHandler(
  { params: idParams, body: renameBody },
  async ({ params, body }) => {
    const result = await renameTag(params.id, body.name);
    if (!result.ok) {
      throw new ApiError(result.status, result.error);
    }
    revalidateTagsCache();
    return NextResponse.json({ ok: true });
  },
);

export const DELETE = createAdminHandler({ params: idParams }, async ({ params }) => {
  const result = await deleteTag(params.id);
  if (!result.ok) {
    throw new ApiError(result.status, result.error);
  }
  revalidateTagsCache();
  return NextResponse.json({ ok: true });
});
