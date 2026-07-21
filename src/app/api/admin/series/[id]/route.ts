import { NextResponse } from "next/server";
import { createCapabilityHandler, ApiError } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { throwIfFailed } from "@/lib/result";
import { idParams } from "@/lib/validation";
import {
  deleteReadingSeries,
  getSeriesForAdmin,
  updateReadingSeries,
} from "@/lib/engagement/series";
import { updateSeriesBody } from "@/lib/engagement/series-admin-schemas";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";

const SERIES_NOT_FOUND = "Not found";

function definedBodyFields(body: Record<string, unknown>) {
  return Object.entries(body)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)
    .sort();
}

export const GET = createCapabilityHandler(
  CAPABILITIES.articlesManage,
  { params: idParams },
  async ({ params }) => {
    const series = await getSeriesForAdmin(params.id);
    if (!series) {
      throw new ApiError(404, SERIES_NOT_FOUND);
    }
    return NextResponse.json({ series });
  },
);

export const PATCH = createCapabilityHandler(
  CAPABILITIES.articlesManage,
  { params: idParams, body: updateSeriesBody },
  async ({ req, params, body, session, requestId }) => {
    const result = await updateReadingSeries(params.id, body);
    throwIfFailed(result);
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminSeriesUpdate,
      targetType: "series",
      targetId: params.id,
      metadata: {
        fields: definedBodyFields(body),
        status: result.series.status,
        public: result.series.public,
        articleCount: result.series.articleCount,
      },
    });
    return NextResponse.json({ ok: true, series: result.series });
  },
);

export const DELETE = createCapabilityHandler(
  CAPABILITIES.articlesManage,
  { params: idParams },
  async ({ req, params, session, requestId }) => {
    const result = await deleteReadingSeries(params.id);
    throwIfFailed(result);
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminSeriesDelete,
      targetType: "series",
      targetId: params.id,
      metadata: {},
    });
    return NextResponse.json({ ok: true });
  },
);
