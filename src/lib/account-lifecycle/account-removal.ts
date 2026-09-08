import {
  prepareOwnedArticleMediaAssetRetirement,
  type MediaAssetRetirementOperation,
} from "@/lib/media";
import { prisma } from "@/lib/prisma";
import { runSerializableTransaction } from "@/lib/database/serializable-transaction";
import { recordAuditFromRequest, type AuditRequestInput } from "@/lib/security/audit";
import type { Role } from "@prisma/client";

export type AccountRemovalSuccess = {
  role: Role;
  ownedArticleCount: number;
};

export type AccountRemovalResult =
  | ({ ok: true } & AccountRemovalSuccess)
  | { ok: false; reason: "not-found" | "last-admin" };

type AccountRemovalOptions = {
  audit?: (result: AccountRemovalSuccess) => AuditRequestInput;
  mediaRetirementOperation: Extract<
    MediaAssetRetirementOperation,
    "account-delete" | "member-delete"
  >;
};

class LastAdminError extends Error {}

export async function removeAccount(
  userId: string,
  options: AccountRemovalOptions,
): Promise<AccountRemovalResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (!user) {
    return { ok: false, reason: "not-found" };
  }

  const mediaRetirement = await prepareOwnedArticleMediaAssetRetirement(userId);

  try {
    const removed = await runSerializableTransaction(async (tx) => {
      const currentUser = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true },
      });
      if (!currentUser) return null;

      if (currentUser.role === "Admin") {
        const adminCount = await tx.user.count({ where: { role: "Admin" } });
        if (adminCount <= 1) {
          throw new LastAdminError();
        }
      }

      const administeredOrganizations = await tx.membership.findMany({
        where: { userId, role: "OrgAdmin" },
        select: { orgId: true },
      });
      for (const membership of administeredOrganizations) {
        const adminCount = await tx.membership.count({
          where: { orgId: membership.orgId, role: "OrgAdmin" },
        });
        if (adminCount <= 1) {
          throw new LastAdminError();
        }
      }

      const ownedArticleCount = await tx.article.count({
        where: { ownerId: userId },
      });
      await tx.user.delete({ where: { id: userId } });
      if (options.audit) {
        await recordAuditFromRequest(
          options.audit({ role: currentUser.role, ownedArticleCount }),
          tx,
        );
      }
      return { role: currentUser.role, ownedArticleCount };
    });
    if (!removed) return { ok: false, reason: "not-found" };

    await mediaRetirement.retire(options.mediaRetirementOperation);
    return { ok: true, ...removed };
  } catch (error) {
    if (error instanceof LastAdminError) {
      return { ok: false, reason: "last-admin" };
    }
    throw error;
  }
}