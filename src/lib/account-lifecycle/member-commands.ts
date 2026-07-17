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

import { prepareOwnedArticleMediaAssetRetirement } from "@/lib/media";
import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";
import { recordAuditFromRequest, type AuditRequestInput } from "@/lib/security/audit";
import { type DomainResult, type DomainOk, ok, notFound, conflict } from "@/lib/result";

type AuditFactory<T> = (result: T) => AuditRequestInput;

export type UpdateMemberRoleResult = DomainResult<{ role: Role; previousRole: Role; changed: boolean }>;
type UpdateMemberRoleSuccess = DomainOk<{ role: Role; previousRole: Role; changed: boolean }>;

export type DeleteMemberResult = DomainResult<{ role: Role; ownedArticleCount: number }>;
type DeleteMemberSuccess = DomainOk<{ role: Role; ownedArticleCount: number }>;

const LAST_ADMIN_DEMOTE_MESSAGE = "Cannot demote the last remaining admin";
const LAST_ADMIN_DELETE_MESSAGE = "Cannot remove the last remaining admin";

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

function updateRoleSuccess(
  role: Role,
  previousRole: Role,
  changed: boolean,
): UpdateMemberRoleSuccess {
  return ok({ role, previousRole, changed });
}

function deleteMemberSuccess(
  role: Role,
  ownedArticleCount: number,
): DeleteMemberSuccess {
  return ok({ role, ownedArticleCount });
}

function adminGuardConflict(error: unknown) {
  if (error instanceof AdminGuardError) {
    return conflict(error.guardError);
  }
  return null;
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
    return notFound();
  }

  // No role change — skip the DB write entirely.
  if (user.role === role) {
    const result = updateRoleSuccess(role, user.role, false);
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
          throw new AdminGuardError(LAST_ADMIN_DEMOTE_MESSAGE, 409);
        }
      }
      await tx.user.update({ where: { id }, data: { role } });
      if (audit) {
        await recordAuditFromRequest(
          audit(updateRoleSuccess(role, user.role, true)),
          tx,
        );
      }
    });
  } catch (e) {
    const guardConflict = adminGuardConflict(e);
    if (guardConflict) return guardConflict;
    throw e;
  }
  return updateRoleSuccess(role, user.role, true);
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
    return notFound();
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
  //
  // 711-D: Collect object-storage keys for private-article MediaAssets BEFORE
  // the cascade so bytes can be purged from object storage after the DB delete.
  const mediaRetirement = await prepareOwnedArticleMediaAssetRetirement(id);

  let ownedArticleCount = 0;
  try {
    await prisma.$transaction(async (tx) => {
      if (user.role === "Admin") {
        const admins = await tx.user.count({ where: { role: "Admin" } });
        if (admins <= 1) {
          throw new AdminGuardError(LAST_ADMIN_DELETE_MESSAGE, 409);
        }
      }
      ownedArticleCount = await tx.article.count({ where: { ownerId: id } });
      await tx.user.delete({ where: { id } });
      if (audit) {
        await recordAuditFromRequest(
          audit(deleteMemberSuccess(user.role, ownedArticleCount)),
          tx,
        );
      }
    });
  } catch (e) {
    const guardConflict = adminGuardConflict(e);
    if (guardConflict) return guardConflict;
    throw e;
  }

  // Best-effort object-storage purge — do not fail the deletion if storage is
  // down or unconfigured.
  await mediaRetirement.retire("member-delete");

  return deleteMemberSuccess(user.role, ownedArticleCount);
}
