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

const SERIES_NOT_FOUND = "Not found";

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
  async ({ params, body }) => {
    const result = await updateReadingSeries(params.id, body);
    throwIfFailed(result);
    return NextResponse.json({ ok: true, series: result.series });
  },
);

export const DELETE = createCapabilityHandler(
  CAPABILITIES.articlesManage,
  { params: idParams },
  async ({ params }) => {
    const result = await deleteReadingSeries(params.id);
    throwIfFailed(result);
    return NextResponse.json({ ok: true });
  },
);
