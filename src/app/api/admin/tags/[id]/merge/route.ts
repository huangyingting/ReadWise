import { NextResponse } from "next/server";
import { createCapabilityHandler, ApiError } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { idParams, object, nonEmptyString } from "@/lib/validation";
import { mergeTags } from "@/lib/admin/tags";
import { revalidateTagsCache } from "@/lib/cache";
import { AUDIT_ACTIONS } from "@/lib/security/audit";

const mergeBody = object({ targetId: nonEmptyString(200) });
const TAG_TARGET_TYPE = "tag";

type MergeTagsAuditResult = { moved: number };

function buildMergeAuditInput(
  req: Request,
  session: { user: { id: string } },
  requestId: string,
  sourceTagId: string,
  targetTagId: string,
) {
  return (auditResult: MergeTagsAuditResult) => ({
    req,
    session,
    requestId,
    action: AUDIT_ACTIONS.adminTagMerge,
    targetType: TAG_TARGET_TYPE,
    targetId: targetTagId,
    metadata: {
      sourceTagId,
      moved: auditResult.moved,
    },
  });
}

export const POST = createCapabilityHandler(
  CAPABILITIES.tagsManage,
  { params: idParams, body: mergeBody },
  async ({ req, params, body, session, requestId }) => {
    const result = await mergeTags(
      params.id,
      body.targetId,
      buildMergeAuditInput(req, session, requestId, params.id, body.targetId),
    );
    if (!result.ok) {
      throw new ApiError(result.status, result.error);
    }
    revalidateTagsCache();
    return NextResponse.json({ ok: true, moved: result.moved });
  },
);
