import { NextResponse } from "next/server";
import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { throwIfFailed } from "@/lib/result";
import {
  createReadingSeries,
  listSeriesForAdmin,
} from "@/lib/engagement/series";
import { createSeriesBody } from "@/lib/engagement/series-admin-schemas";

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
  async ({ body }) => {
    const result = await createReadingSeries(body);
    throwIfFailed(result);
    return NextResponse.json({ ok: true, series: result.series }, { status: 201 });
  },
);
