/**
 * Admin member support commands (REF-052 — Issue #489).
 *
 * Explicit, audited operator actions for a single member:
 *   - {@link revokeMemberSessions}: sign the member out everywhere.
 *   - {@link exportMemberData}: assemble a JSON export of their own data.
 *   - {@link triggerMemberRepair}: re-enqueue missing enrichment for their
 *     imported articles (reuses {@link runBackfill}).
 *   - {@link resendSignInHelp}: a documented stub until transactional email
 *     is configured (never leaks tokens/secrets).
 *
 * Separated from the member detail read model ({@link ./member-detail}) so
 * mutations can evolve independently of the read model.
 *
 * Every command is audited via the supplied audit factory. No raw secrets
 * (session tokens, OAuth credentials) are ever returned to the caller.
 */

import { prisma } from "@/lib/prisma";
import {
  recordAuditFromRequest,
  type AuditRequestInput,
} from "@/lib/security/audit";
import { exportUserData } from "./account-commands";
import {
  runBackfill,
  BACKFILL_FEATURES,
  type BackfillResult,
} from "@/lib/processing/backfill";

type AuditFactory<T> = (result: T) => AuditRequestInput;

export type SupportActionResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: string; status: number };

type RevokeClient = Pick<typeof prisma, "user" | "session">;

/**
 * Revokes (deletes) every `Session` row for the member, signing them out of all
 * devices. With the database session strategy this is real server-side
 * revocation, not just a cookie clear. Audited via the supplied factory.
 */
export async function revokeMemberSessions(
  userId: string,
  audit?: AuditFactory<{ revoked: number }>,
  client: RevokeClient = prisma,
): Promise<SupportActionResult<{ revoked: number }>> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) return { ok: false, error: "Not found", status: 404 };

  const result = await client.session.deleteMany({ where: { userId } });
  if (audit) {
    await recordAuditFromRequest(audit({ revoked: result.count }));
  }
  return { ok: true, revoked: result.count };
}

/**
 * Assembles a JSON export of the member's OWN data (profile, progress, saved
 * words, highlights, etc.) for a support / data-subject-access request. Reuses
 * {@link exportUserData} so the export shape stays consistent with the
 * self-service account export. The export is audited.
 */
export async function exportMemberData(
  userId: string,
  audit?: AuditRequestInput,
): Promise<SupportActionResult<{ data: unknown }>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) return { ok: false, error: "Not found", status: 404 };

  const data = await exportUserData(userId, audit);
  if (!data) return { ok: false, error: "Not found", status: 404 };
  return { ok: true, data };
}

/**
 * Triggers a data-repair / rebuild for the member's IMPORTED articles by
 * re-enqueuing any missing enrichment (difficulty/tags/vocab/quiz/…) via
 * {@link runBackfill} in "missing" mode (nothing is destructively cleared;
 * user study data is never touched). No-op (ok, 0 enqueued) when the member has
 * no imported articles. Audited via the supplied factory.
 */
export async function triggerMemberRepair(
  userId: string,
  operatorId: string | null,
  audit?: AuditFactory<{ result: BackfillResult; articleCount: number }>,
): Promise<SupportActionResult<{ result: BackfillResult | null; articleCount: number }>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) return { ok: false, error: "Not found", status: 404 };

  const owned = await prisma.article.findMany({
    where: { ownerId: userId },
    select: { id: true },
  });
  const articleIds = owned.map((a) => a.id);
  if (articleIds.length === 0) {
    if (audit) {
      await recordAuditFromRequest(
        audit({
          result: {
            dryRun: false,
            mode: "missing",
            features: [...BACKFILL_FEATURES],
            reason: `support repair for user ${userId}`,
            scanned: 0,
            matched: 0,
            cap: 0,
            enqueued: 0,
            skippedExisting: 0,
            cleared: 0,
            jobIds: [],
            plan: [],
          },
          articleCount: 0,
        }),
      );
    }
    return { ok: true, result: null, articleCount: 0 };
  }

  const result = await runBackfill({
    features: [...BACKFILL_FEATURES],
    mode: "missing",
    reason: `support repair for user ${userId}`,
    operatorId,
    filter: { articleIds },
  });
  if (audit) {
    await recordAuditFromRequest(
      audit({ result, articleCount: articleIds.length }),
    );
  }
  return { ok: true, result, articleCount: articleIds.length };
}

/**
 * Resend sign-in help. Transactional email is not configured in this
 * deployment, so this is a documented stub: it records the support intent in
 * the audit log (so the action is traceable) and reports that email delivery is
 * unavailable. It NEVER exposes a magic link, token, or any secret. Wire real
 * delivery here when an email provider is configured.
 */
export async function resendSignInHelp(
  userId: string,
  audit?: AuditFactory<{ delivered: boolean }>,
): Promise<SupportActionResult<{ delivered: boolean; reason: string }>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user) return { ok: false, error: "Not found", status: 404 };
  if (!user.email) {
    return { ok: false, error: "Member has no email address on file", status: 400 };
  }

  // No email provider configured — record the intent and report unavailability.
  if (audit) {
    await recordAuditFromRequest(audit({ delivered: false }));
  }
  return {
    ok: true,
    delivered: false,
    reason: "email_not_configured",
  };
}
