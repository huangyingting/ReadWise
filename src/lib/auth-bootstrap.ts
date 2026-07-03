/**
 * First-user Admin bootstrap (REF-064).
 *
 * When the very first user account is created, they are promoted to the Admin
 * role. This is called from the NextAuth `createUser` event in `@/lib/auth`.
 *
 * Extracted here so it can be unit-tested independently of the full NextAuth
 * config and so the bootstrap policy is explicit rather than buried inside the
 * event callback.
 */

import { prisma } from "@/lib/prisma";

const FIRST_USER_COUNT = 1;
const ADMIN_ROLE = "Admin";

/**
 * Promotes `userId` to the Admin role if they are the first user in the
 * database. No-op when subsequent users sign up.
 *
 * @param userId - The id of the newly created user.
 */
export async function bootstrapFirstUser(userId: string): Promise<void> {
  const userCount = await prisma.user.count();
  if (userCount !== FIRST_USER_COUNT) return;

  await promoteUserToAdmin(userId);
}

async function promoteUserToAdmin(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { role: ADMIN_ROLE },
  });
}
