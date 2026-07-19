import { NextResponse } from "next/server";

import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { idParams } from "@/lib/validation";
import { getReviewCandidate } from "@/lib/scraper/incremental/candidate-review-query";

/**
 * Returns the sanitized detail DTO (candidate provenance + conflict history) for
 * ONE review candidate (#1100). Gated on `sources.manage`; the `id` param is
 * validated (never trusted raw). No URL/body/secret/article content is exposed.
 * Returns 404 when the candidate does not exist.
 */
export const GET = createCapabilityHandler(
  CAPABILITIES.sourcesManage,
  { params: idParams },
  async ({ params }) => {
    const candidate = await getReviewCandidate(params.id);
    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }
    return NextResponse.json({ candidate });
  },
);
