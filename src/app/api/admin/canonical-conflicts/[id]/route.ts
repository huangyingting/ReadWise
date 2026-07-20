import { NextResponse } from "next/server";

import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { idParams } from "@/lib/validation";
import { getCanonicalConflict } from "@/lib/scraper/incremental/canonical-conflict-query";

/**
 * Returns the sanitized detail of ONE canonical conflict (#1104, AC1): the
 * conflict identity, its contested public Article ids (the operator selects the
 * survivor from these), and per-Article + aggregate dependent-data COUNTS. Gated
 * on `sources.manage`. Not status-restricted, so a resolved conflict can be
 * inspected. Never returns a URL, body, secret, or article content.
 */
export const GET = createCapabilityHandler(
  CAPABILITIES.sourcesManage,
  { params: idParams },
  async ({ params }) => {
    const detail = await getCanonicalConflict(params.id);
    if (!detail) {
      return NextResponse.json({ error: "Canonical conflict not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  },
);
