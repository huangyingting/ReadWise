import { NextResponse } from "next/server";
import { createAdminHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, nonEmptyString } from "@/lib/validation";
import { deleteTag, renameTag } from "@/lib/admin-tags";
import { revalidateTagsCache } from "@/lib/cache";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/audit";

const renameBody = object({ name: nonEmptyString(200) });

export const PATCH = createAdminHandler(
  { params: idParams, body: renameBody },
  async ({ req, params, body, session, requestId }) => {
    const result = await renameTag(params.id, body.name);
    if (!result.ok) {
      throw new ApiError(result.status, result.error);
    }
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminTagRename,
      targetType: "tag",
      targetId: params.id,
      metadata: { changed: result.changed },
    });
    revalidateTagsCache();
    return NextResponse.json({ ok: true });
  },
);

export const DELETE = createAdminHandler({ params: idParams }, async ({ req, params, session, requestId }) => {
  const result = await deleteTag(params.id);
  if (!result.ok) {
    throw new ApiError(result.status, result.error);
  }
  await recordAuditFromRequest({
    req,
    session,
    requestId,
    action: AUDIT_ACTIONS.adminTagDelete,
    targetType: "tag",
    targetId: params.id,
    metadata: { articleCount: result.articleCount },
  });
  revalidateTagsCache();
  return NextResponse.json({ ok: true });
});
