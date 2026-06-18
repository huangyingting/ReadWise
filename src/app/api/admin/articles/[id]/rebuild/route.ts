import { NextResponse } from "next/server";
import { createAdminHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { rebuildArticleAi } from "@/lib/admin-articles";

export const POST = createAdminHandler({ params: idParams }, async ({ params }) => {
  const result = await rebuildArticleAi(params.id);
  if (!result) {
    throw new ApiError(404, "Not found");
  }
  return NextResponse.json({ ok: true, ...result });
});
