import { NextResponse } from "next/server";
import { createCapabilityHandler, ApiError } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { idParams, object, nonEmptyString } from "@/lib/validation";
import { deleteTag, renameTag } from "@/lib/admin/tags";
import { revalidateTagsCache } from "@/lib/cache";
import { AUDIT_ACTIONS } from "@/lib/security/audit";

const renameBody = object({ name: nonEmptyString(200) });
const OK_RESPONSE = { ok: true };

type TagAuditSession = {
  user?: {
    id?: string | null;
    role?: string | null;
  } | null;
} | null;

type TagAuditContext = {
  req: Request;
  session: TagAuditSession;
  requestId: string;
  tagId: string;
};

function assertTagResult(result: Awaited<ReturnType<typeof renameTag>> | Awaited<ReturnType<typeof deleteTag>>) {
  if (!result.ok) {
    throw new ApiError(result.status, result.error);
  }
}

function tagAuditBase({ req, session, requestId, tagId }: TagAuditContext) {
  return {
    req,
    session,
    requestId,
    targetType: "tag",
    targetId: tagId,
  };
}

function okAfterTagMutation() {
  revalidateTagsCache();
  return NextResponse.json(OK_RESPONSE);
}

export const PATCH = createCapabilityHandler(
  CAPABILITIES.tagsManage,
  { params: idParams, body: renameBody },
  async ({ req, params, body, session, requestId }) => {
    const result = await renameTag(params.id, body.name, (auditResult) => ({
      ...tagAuditBase({ req, session, requestId, tagId: params.id }),
      action: AUDIT_ACTIONS.adminTagRename,
      metadata: { changed: auditResult.changed },
    }));
    assertTagResult(result);
    return okAfterTagMutation();
  },
);

export const DELETE = createCapabilityHandler(
  CAPABILITIES.tagsManage,
  { params: idParams },
  async ({ req, params, session, requestId }) => {
    const result = await deleteTag(params.id, (auditResult) => ({
      ...tagAuditBase({ req, session, requestId, tagId: params.id }),
      action: AUDIT_ACTIONS.adminTagDelete,
      metadata: { articleCount: auditResult.articleCount },
    }));
    assertTagResult(result);
    return okAfterTagMutation();
  },
);
