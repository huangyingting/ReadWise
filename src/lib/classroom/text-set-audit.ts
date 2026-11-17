/**
 * Builds request-scoped audit rows for Text Set mutations (#1308). The domain
 * commands decide the action, target, and id/count metadata; this attaches the
 * actor, request id, IP, and user agent.
 */
import type { Session } from "next-auth";
import type { AuditRequestInput } from "@/lib/security/audit";
import type { TextSetAuditEntry } from "./text-sets";

export function textSetAudit(request: { req: Request; session: Session; requestId?: string }) {
  return (entry: TextSetAuditEntry): AuditRequestInput => ({
    req: request.req,
    session: request.session,
    requestId: request.requestId,
    action: entry.action,
    targetType: "text_set",
    targetId: entry.targetId,
    metadata: entry.metadata,
  });
}
