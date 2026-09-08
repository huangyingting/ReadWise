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

import { removeAccount } from "@/lib/account-lifecycle/account-removal";
import { runSerializableTransaction } from "@/lib/database/serializable-transaction";
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
  try {
    const result = await runSerializableTransaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id },
        select: { id: true, role: true },
      });
      if (!user) return null;

      if (user.role === role) {
        const unchanged = updateRoleSuccess(role, user.role, false);
        if (audit) {
          await recordAuditFromRequest(audit(unchanged), tx);
        }
        return unchanged;
      }

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
      return updateRoleSuccess(role, user.role, true);
    });
    return result ?? notFound();
  } catch (e) {
    const guardConflict = adminGuardConflict(e);
    if (guardConflict) return guardConflict;
    throw e;
  }
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
  const result = await removeAccount(id, {
    audit: audit
      ? (removedAccount) =>
          audit(
            deleteMemberSuccess(
              removedAccount.role,
              removedAccount.ownedArticleCount,
            ),
          )
      : undefined,
    mediaRetirementOperation: "member-delete",
  });

  if (!result.ok && result.reason === "not-found") {
    return notFound();
  }
  if (!result.ok) {
    return conflict(LAST_ADMIN_DELETE_MESSAGE);
  }

  return deleteMemberSuccess(result.role, result.ownedArticleCount);
}
