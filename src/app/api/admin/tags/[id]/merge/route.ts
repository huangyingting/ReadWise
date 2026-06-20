import { NextResponse } from "next/server";
import { createAdminHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, nonEmptyString } from "@/lib/validation";
import { mergeTags } from "@/lib/admin-tags";
import { revalidateTagsCache } from "@/lib/cache";

const mergeBody = object({ targetId: nonEmptyString(200) });

export const POST = createAdminHandler(
  { params: idParams, body: mergeBody },
  async ({ params, body }) => {
    const result = await mergeTags(params.id, body.targetId);
    if (!result.ok) {
      throw new ApiError(result.status, result.error);
    }
    revalidateTagsCache();
    return NextResponse.json({ ok: true, moved: result.moved });
  },
);
