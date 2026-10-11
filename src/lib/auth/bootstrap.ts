import { runSerializableTransaction } from "@/lib/database/serializable-transaction";
import { AccountAdmissionError } from "@/lib/account-admission/errors";
import { hashPassword } from "@/lib/account-admission/passwords";
import {
  isValidAccountEmail,
  normalizeAccountEmail,
} from "@/lib/account-admission/policy";

export async function bootstrapAdmin(input: {
  email: string;
  password: string;
  name?: string | null;
}) {
  const email = normalizeAccountEmail(input.email);
  if (!isValidAccountEmail(input.email)) {
    throw new AccountAdmissionError(
      400,
      "invalid_email",
      "Enter a valid administrator email address.",
    );
  }
  const passwordHash = await hashPassword(input.password);
  const now = new Date();
  const name = input.name?.trim() || null;

  return runSerializableTransaction(async (tx) => {
    const adminCount = await tx.user.count({ where: { role: "Admin" } });
    if (adminCount > 0) {
      throw new AccountAdmissionError(
        409,
        "admin_exists",
        "ReadWise already has an administrator.",
      );
    }

    const existing = await tx.user.findUnique({
      where: { email },
      select: { id: true, email: true, emailVerified: true },
    });
    if (!existing) {
      return tx.user.create({
        data: {
          email,
          emailVerified: now,
          name,
          role: "Admin",
          passwordCredential: {
            create: {
              passwordHash,
              passwordChangedAt: now,
            },
          },
        },
      });
    }

    const user = await tx.user.update({
      where: { id: existing.id },
      data: {
        role: "Admin",
        emailVerified: existing.emailVerified ?? now,
        ...(name ? { name } : {}),
      },
    });
    await tx.passwordCredential.upsert({
      where: { userId: existing.id },
      create: {
        userId: existing.id,
        passwordHash,
        passwordChangedAt: now,
      },
      update: {
        passwordHash,
        passwordChangedAt: now,
        resetTokenHash: null,
        resetExpiresAt: null,
      },
    });
    return user;
  });
}
