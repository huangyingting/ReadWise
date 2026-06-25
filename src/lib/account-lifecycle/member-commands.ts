/**
 * Admin member mutation commands (REF-052 — Issue #489).
 *
 * Provides audited role-update and deletion commands for individual members.
 * Separated from the member list read model ({@link ./member-list}) and from
 * the operator support commands ({@link ./support-commands}).
 *
 * Both commands guard against removing the last admin via a sentinel that is
 * evaluated INSIDE the transaction for strict atomicity.
 */

import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";
import { recordAuditFromRequest, type AuditRequestInput } from "@/lib/security/audit";

type AuditFactory<T> = (result: T) => AuditRequestInput;

export type UpdateMemberRoleResult =
  | { ok: true; role: Role; previousRole: Role; changed: boolean }
  | { ok: false; error: string; status: number };
type UpdateMemberRoleSuccess = Extract<UpdateMemberRoleResult, { ok: true }>;

export type DeleteMemberResult =
  | { ok: true; role: Role; ownedArticleCount: number }
  | { ok: false; error: string; status: number };
type DeleteMemberSuccess = Extract<DeleteMemberResult, { ok: true }>;

// Sentinel thrown inside a transaction to signal a guard condition.
class AdminGuardError extends Error {
  readonly guardError: string;
  readonly guardStatus: number;
  constructor(error: string, status: number) {
    super(error);
    this.guardError = error;
    this.guardStatus = status;
  }
}

/**
 * Updates a member's role. Guards against demoting the last remaining admin so
 * the platform can never be left without an administrator. Returns a structured
 * error (with an HTTP status) on failure.
 */
export async function updateMemberRole(
  id: string,
  role: Role,
  audit?: AuditFactory<UpdateMemberRoleSuccess>,
): Promise<UpdateMemberRoleResult> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true },
  });
  if (!user) {
    return { ok: false, error: "Not found", status: 404 };
  }

  // No role change — skip the DB write entirely.
  if (user.role === role) {
    const result = { ok: true, role, previousRole: user.role, changed: false } as const;
    if (audit) {
      await recordAuditFromRequest(audit(result));
    }
    return result;
  }

  // Re-count admins inside the transaction so two concurrent demotions of the
  // last admin can never both pass the guard and leave the system adminless.
  try {
    await prisma.$transaction(async (tx) => {
      if (user.role === "Admin" && role !== "Admin") {
        const admins = await tx.user.count({ where: { role: "Admin" } });
        if (admins <= 1) {
          throw new AdminGuardError("Cannot demote the last remaining admin", 409);
        }
      }
      await tx.user.update({ where: { id }, data: { role } });
      if (audit) {
        await recordAuditFromRequest(
          audit({ ok: true, role, previousRole: user.role, changed: true }),
          tx,
        );
      }
    });
  } catch (e) {
    if (e instanceof AdminGuardError) {
      return { ok: false, error: e.guardError, status: e.guardStatus };
    }
    throw e;
  }
  return { ok: true, role, previousRole: user.role, changed: true };
}

/**
 * Removes a member. Related auth rows (accounts, sessions), profile, reading
 * progress and saved words are removed by the schema's cascade rules. Guards
 * against removing the last remaining admin. Returns a structured error on
 * failure.
 */
export async function deleteMember(
  id: string,
  audit?: AuditFactory<DeleteMemberSuccess>,
): Promise<DeleteMemberResult> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true },
  });
  if (!user) {
    return { ok: false, error: "Not found", status: 404 };
  }

  // Article.owner now uses onDelete: Cascade, so deleting the user also deletes
  // their private imports at the database layer. Private content cannot survive
  // as ownerless public rows.
  //
  // The last-admin guard is re-evaluated INSIDE the transaction so two
  // concurrent admin deletions can never both pass the guard and leave the
  // system without an admin.
  //
  // Cascade deletes on the user: accounts, sessions, profile, reading progress,
  // saved words, etc. — all onDelete: Cascade.
  let ownedArticleCount = 0;
  try {
    await prisma.$transaction(async (tx) => {
      if (user.role === "Admin") {
        const admins = await tx.user.count({ where: { role: "Admin" } });
        if (admins <= 1) {
          throw new AdminGuardError("Cannot remove the last remaining admin", 409);
        }
      }
      ownedArticleCount = await tx.article.count({ where: { ownerId: id } });
      await tx.user.delete({ where: { id } });
      if (audit) {
        await recordAuditFromRequest(
          audit({ ok: true, role: user.role, ownedArticleCount }),
          tx,
        );
      }
    });
  } catch (e) {
    if (e instanceof AdminGuardError) {
      return { ok: false, error: e.guardError, status: e.guardStatus };
    }
    throw e;
  }
  return { ok: true, role: user.role, ownedArticleCount };
}
