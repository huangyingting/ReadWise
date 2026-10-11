import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError, createPublicHandler } from "@/lib/api-handler";
import {
  retentionMaintenanceOptions,
  runRetentionMaintenance,
} from "@/lib/retention/maintenance";
import { retentionWorkerConfig } from "@/lib/runtime-config/maintenance";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE_HEADERS = {
  "cache-control": "no-store",
};

function hasValidBearerToken(request: Request, secret: string): boolean {
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return (
    received.length === expected.length &&
    timingSafeEqual(received, expected)
  );
}

/** @api-auth bearer */
export const POST = createPublicHandler({}, async ({ req }) => {
  const config = retentionWorkerConfig.get();
  if (!config) {
    throw new ApiError(503, "Retention maintenance is not configured.");
  }
  if (!hasValidBearerToken(req, config.secret)) {
    throw new ApiError(401, "Unauthorized");
  }

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const result = await runRetentionMaintenance(
    retentionMaintenanceOptions(dryRun),
  );
  return NextResponse.json(result, { headers: NO_STORE_HEADERS });
});
