/**
 * Default reading-list policy (REF-042).
 *
 * The "Saved" list is the user's default bookmark list. It is created lazily
 * on first use and cannot be deleted.
 */
import { prisma } from "@/lib/prisma";

export const DEFAULT_LIST_NAME = "Saved";

/**
 * Returns the user's default "Saved" list, creating it lazily if it does not
 * yet exist.
 */
export async function getOrCreateDefaultList(
  userId: string,
): Promise<{ id: string; name: string; isDefault: boolean }> {
  return prisma.readingList.upsert({
    where: { userId_name: { userId, name: DEFAULT_LIST_NAME } },
    create: { userId, name: DEFAULT_LIST_NAME, isDefault: true },
    update: {},
  });
}
