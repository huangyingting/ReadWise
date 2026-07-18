import {
  prepareOwnedArticleMediaAssetRetirement,
  type MediaAssetRetirementOperation,
} from "@/lib/media";
import { prisma } from "@/lib/prisma";
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

  let ownedArticleCount = 0;
  try {
    await prisma.$transaction(async (tx) => {
      if (user.role === "Admin") {
        const adminCount = await tx.user.count({ where: { role: "Admin" } });
        if (adminCount <= 1) {
          throw new LastAdminError();
        }
      }

      ownedArticleCount = await tx.article.count({ where: { ownerId: userId } });
      await tx.user.delete({ where: { id: userId } });
      if (options.audit) {
        await recordAuditFromRequest(
          options.audit({ role: user.role, ownedArticleCount }),
          tx,
        );
      }
    });
  } catch (error) {
    if (error instanceof LastAdminError) {
      return { ok: false, reason: "last-admin" };
    }
    throw error;
  }

  await mediaRetirement.retire(options.mediaRetirementOperation);

  return { ok: true, role: user.role, ownedArticleCount };
}