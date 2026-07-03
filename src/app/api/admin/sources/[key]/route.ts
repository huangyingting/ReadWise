import { NextResponse } from "next/server";
import { createCapabilityHandler, ApiError } from "@/lib/api-handler";
import { object, nonEmptyString, boolean } from "@/lib/validation";
import { CAPABILITIES } from "@/lib/rbac";
import { setContentSourceEnabled, summarizeSourceHealth } from "@/lib/scraper/sources";
import { AUDIT_ACTIONS, recordAuditFromRequest, type AuditRequestInput } from "@/lib/security/audit";

const keyParams = object({ key: nonEmptyString(200) });
const toggleBody = object({ enabled: boolean() });
const SOURCE_TARGET_TYPE = "content_source";

type ContentSource = NonNullable<Awaited<ReturnType<typeof setContentSourceEnabled>>>;

type SourceToggleAuditInput = {
  req: AuditRequestInput["req"];
  session: AuditRequestInput["session"];
  requestId: string;
  source: ContentSource;
};

function sourceWithHealth(source: ContentSource) {
  return { ...source, health: summarizeSourceHealth(source) };
}

async function recordSourceToggleAudit({
  req,
  session,
  requestId,
  source,
}: SourceToggleAuditInput): Promise<void> {
  await recordAuditFromRequest({
    req,
    session,
    requestId,
    action: AUDIT_ACTIONS.adminSourceToggle,
    targetType: SOURCE_TARGET_TYPE,
    targetId: source.providerKey,
    metadata: { enabled: source.enabled },
  });
}

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
    await recordSourceToggleAudit({ req, session, requestId, source });
    return NextResponse.json({
      ok: true,
      source: sourceWithHealth(source),
    });
  },
);
