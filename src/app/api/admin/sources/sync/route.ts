import { NextResponse } from "next/server";
import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { syncContentSources } from "@/lib/scraper/sources";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";

/**
 * Syncs `ContentSource` rows from the code provider registry (RW-046):
 * inserts missing providers, refreshes display metadata. Audited. Gated on
 * `sources.manage`.
 */
export const POST = createCapabilityHandler(
  CAPABILITIES.sourcesManage,
  {},
  async ({ req, session, requestId }) => {
    const result = await syncContentSources();
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminSourceSync,
      targetType: "content_source",
      metadata: { created: result.created, updated: result.updated, total: result.total },
    });
    return NextResponse.json({ ok: true, ...result });
  },
);
