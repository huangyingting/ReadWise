/**
 * Self-service account commands (REF-052 — Issue #489).
 *
 * exportUserData — returns a complete JSON bundle of everything the user owns.
 *   OAuth access/refresh/id tokens are intentionally EXCLUDED from the export;
 *   only the provider name is included so the user can see which services are
 *   linked without exposing token material.
 *
 * deleteOwnAccount — deletes the User row (cascades all related data) after
 *   checking the last-admin guard so the system is never left adminless.
 */

import { removeAccount } from "@/lib/account-lifecycle/account-removal";
import { USER_EXPORT_SELECT } from "@/lib/account-lifecycle/personal-data-policy";
import { prisma } from "@/lib/prisma";
import { recordAuditFromRequest, type AuditRequestInput } from "@/lib/security/audit";
import type { Prisma } from "@prisma/client";

// ── Types ──────────────────────────────────────────────────────────────────

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

// ── Export ─────────────────────────────────────────────────────────────────

type AccountClient = Pick<Prisma.TransactionClient, "user" | "auditLog">;

async function readUserExport(userId: string, client: AccountClient = prisma) {
  return client.user.findUnique({
    where: { id: userId },
    select: USER_EXPORT_SELECT,
  });
}

export async function exportUserData(
  userId: string,
  audit?: AuditRequestInput,
) {
  if (!audit) {
    return readUserExport(userId);
  }

  return prisma.$transaction(async (tx) => {
    const user = await readUserExport(userId, tx);
    await recordAuditFromRequest(audit, tx);
    return user;
  });
}

// ── Deletion ───────────────────────────────────────────────────────────────

export async function deleteOwnAccount(
  userId: string,
  audit?: AuditRequestInput,
): Promise<DeleteAccountResult> {
  const result = await removeAccount(userId, {
    audit: audit ? () => audit : undefined,
    mediaRetirementOperation: "account-delete",
  });

  if (!result.ok && result.reason === "not-found") {
    return { ok: false, error: "Account not found", status: 404 };
  }
  if (!result.ok) {
    return {
      ok: false,
      error:
        "You are the last admin — transfer the Admin role to another user before deleting your account.",
      status: 409,
    };
  }

  return { ok: true };
}
