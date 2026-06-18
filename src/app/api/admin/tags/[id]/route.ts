import { NextResponse } from "next/server";
import { createAdminHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { deleteTag } from "@/lib/admin-tags";

export const DELETE = createAdminHandler({ params: idParams }, async ({ params }) => {
  const result = await deleteTag(params.id);
  if (!result.ok) {
    throw new ApiError(result.status, result.error);
  }
  return NextResponse.json({ ok: true });
});
