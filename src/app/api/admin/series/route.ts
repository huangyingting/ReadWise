import { NextResponse } from "next/server";
import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { throwIfFailed } from "@/lib/result";
import {
  createReadingSeries,
  listSeriesForAdmin,
} from "@/lib/engagement/series";
import { createSeriesBody } from "@/lib/engagement/series-admin-schemas";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";

export const GET = createCapabilityHandler(
  CAPABILITIES.articlesManage,
  {},
  async () => {
    const series = await listSeriesForAdmin();
    return NextResponse.json({ series });
  },
);

export const POST = createCapabilityHandler(
  CAPABILITIES.articlesManage,
  { body: createSeriesBody },
  async ({ req, body, session, requestId }) => {
    const result = await createReadingSeries(body);
    throwIfFailed(result);
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminSeriesCreate,
      targetType: "series",
      targetId: result.series.id,
      metadata: {
        status: result.series.status,
        public: result.series.public,
        articleCount: result.series.articleCount,
      },
    });
    return NextResponse.json({ ok: true, series: result.series }, { status: 201 });
  },
);
