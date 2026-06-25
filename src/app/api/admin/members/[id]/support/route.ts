import { NextResponse } from "next/server";
import { createCapabilityHandler, ApiError } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { idParams, object, oneOf } from "@/lib/validation";
import { AUDIT_ACTIONS } from "@/lib/audit";
import {
  revokeMemberSessions,
  exportMemberData,
  triggerMemberRepair,
  resendSignInHelp,
} from "@/lib/account-lifecycle";

const SUPPORT_ACTIONS = ["revoke_sessions", "export", "repair", "resend_help"] as const;
type SupportAction = (typeof SUPPORT_ACTIONS)[number];

const supportBody = object({
  action: oneOf<SupportAction>(SUPPORT_ACTIONS),
});

/**
 * Support actions for a single member (RW-053). Gated on the `support.assist`
 * capability and dispatched by `action`. Every action is recorded in the audit
 * log. No raw secrets (session tokens / OAuth credentials) are ever returned.
 */
export const POST = createCapabilityHandler(
  CAPABILITIES.supportAssist,
  { params: idParams, body: supportBody },
  async ({ req, params, body, session, requestId }) => {
    const targetId = params.id;

    switch (body.action) {
      case "revoke_sessions": {
        const result = await revokeMemberSessions(targetId, ({ revoked }) => ({
          req,
          session,
          requestId,
          action: AUDIT_ACTIONS.adminMemberRevokeSessions,
          targetType: "user",
          targetId,
          metadata: { revoked },
        }));
        if (!result.ok) throw new ApiError(result.status, result.error);
        return NextResponse.json({ ok: true, revoked: result.revoked });
      }

      case "export": {
        const result = await exportMemberData(targetId, {
          req,
          session,
          requestId,
          action: AUDIT_ACTIONS.adminMemberExport,
          targetType: "user",
          targetId,
          metadata: { exported: true },
        });
        if (!result.ok) throw new ApiError(result.status, result.error);
        return NextResponse.json({ ok: true, data: result.data });
      }

      case "repair": {
        const result = await triggerMemberRepair(
          targetId,
          session.user.id,
          ({ result: backfill, articleCount }) => ({
            req,
            session,
            requestId,
            action: AUDIT_ACTIONS.adminMemberRepair,
            targetType: "user",
            targetId,
            metadata: {
              articleCount,
              enqueued: backfill.enqueued,
              skippedExisting: backfill.skippedExisting,
            },
          }),
        );
        if (!result.ok) throw new ApiError(result.status, result.error);
        return NextResponse.json({
          ok: true,
          articleCount: result.articleCount,
          enqueued: result.result?.enqueued ?? 0,
        });
      }

      case "resend_help": {
        const result = await resendSignInHelp(targetId, ({ delivered }) => ({
          req,
          session,
          requestId,
          action: AUDIT_ACTIONS.adminMemberResendHelp,
          targetType: "user",
          targetId,
          metadata: { delivered },
        }));
        if (!result.ok) throw new ApiError(result.status, result.error);
        return NextResponse.json({
          ok: true,
          delivered: result.delivered,
          reason: result.reason,
        });
      }

      default:
        throw new ApiError(400, "Unknown support action");
    }
  },
);
