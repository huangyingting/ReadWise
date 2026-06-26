import { NextResponse } from "next/server";
import { createCapabilityHandler, ApiError } from "@/lib/api-handler";
import { object, nonEmptyString, boolean } from "@/lib/validation";
import { CAPABILITIES } from "@/lib/rbac";
import { setContentSourceEnabled, summarizeSourceHealth } from "@/lib/scraper/sources";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";

const keyParams = object({ key: nonEmptyString(200) });
const toggleBody = object({ enabled: boolean() });

/**
 * Enables/disables a content source (RW-046). The scraper consults this flag
 * before crawling a provider. Audited. Gated on `sources.manage`.
 */
export const PATCH = createCapabilityHandler(
  CAPABILITIES.sourcesManage,
  { params: keyParams, body: toggleBody },
  async ({ req, params, body, session, requestId }) => {
    const source = await setContentSourceEnabled(params.key, body.enabled);
    if (!source) {
      throw new ApiError(404, "Content source not found");
    }
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminSourceToggle,
      targetType: "content_source",
      targetId: source.providerKey,
      metadata: { enabled: source.enabled },
    });
    return NextResponse.json({
      ok: true,
      source: { ...source, health: summarizeSourceHealth(source) },
    });
  },
);
