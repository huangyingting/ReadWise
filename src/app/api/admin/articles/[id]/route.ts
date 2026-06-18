import { NextResponse } from "next/server";
import { createAdminHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { deleteArticle } from "@/lib/admin-articles";
import { revalidateTagsCache } from "@/lib/cache";

export const DELETE = createAdminHandler({ params: idParams }, async ({ params }) => {
  const ok = await deleteArticle(params.id);
  if (!ok) {
    throw new ApiError(404, "Not found");
  }
  revalidateTagsCache();
  return NextResponse.json({ ok: true });
});
