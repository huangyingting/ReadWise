import { NextResponse } from "next/server";
import { createAdminHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, nonEmptyString } from "@/lib/validation";
import { mergeTags } from "@/lib/admin-tags";
import { revalidateTagsCache } from "@/lib/cache";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/audit";

const mergeBody = object({ targetId: nonEmptyString(200) });

export const POST = createAdminHandler(
  { params: idParams, body: mergeBody },
  async ({ req, params, body, session, requestId }) => {
    const result = await mergeTags(params.id, body.targetId);
    if (!result.ok) {
      throw new ApiError(result.status, result.error);
    }
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminTagMerge,
      targetType: "tag",
      targetId: body.targetId,
      metadata: {
        sourceTagId: params.id,
        moved: result.moved,
      },
    });
    revalidateTagsCache();
    return NextResponse.json({ ok: true, moved: result.moved });
  },
);
