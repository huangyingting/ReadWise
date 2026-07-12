import { NextResponse } from "next/server";
import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { throwIfFailed } from "@/lib/result";
import { idParams } from "@/lib/validation";
import { reorderReadingSeriesItems } from "@/lib/engagement/series";
import { reorderSeriesBody } from "@/lib/engagement/series-admin-schemas";

export const POST = createCapabilityHandler(
  CAPABILITIES.articlesManage,
  { params: idParams, body: reorderSeriesBody },
  async ({ params, body }) => {
    const result = await reorderReadingSeriesItems(params.id, body.articleIds);
    throwIfFailed(result);
    return NextResponse.json({ ok: true, series: result.series });
  },
);
