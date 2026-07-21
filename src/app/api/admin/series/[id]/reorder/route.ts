import { NextResponse } from "next/server";
import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { throwIfFailed } from "@/lib/result";
import { idParams } from "@/lib/validation";
import { reorderReadingSeriesItems } from "@/lib/engagement/series";
import { reorderSeriesBody } from "@/lib/engagement/series-admin-schemas";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";

export const POST = createCapabilityHandler(
  CAPABILITIES.articlesManage,
  { params: idParams, body: reorderSeriesBody },
  async ({ req, params, body, session, requestId }) => {
    const result = await reorderReadingSeriesItems(params.id, body.articleIds);
    throwIfFailed(result);
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminSeriesReorder,
      targetType: "series",
      targetId: params.id,
      metadata: { articleCount: result.series.articleCount },
    });
    return NextResponse.json({ ok: true, series: result.series });
  },
);
