import assert from "node:assert/strict";
import { test } from "node:test";

import { prisma } from "@/lib/prisma";
import {
  authenticatePassword,
  beginPublicRegistration,
  completePublicRegistration,
  createAccountInvitation,
  inspectAccountInvitation,
  requestPasswordReset,
  registerWithInvitation,
  resetPassword,
  revokeAccountInvitation,
  rotateAccountInvitation,
  setPasswordForUser,
} from "@/lib/account-admission";
import { verifyPassword } from "@/lib/account-admission/passwords";
import {
  acknowledgeAccountMail,
  claimAccountMail,
} from "@/lib/account-admission/account-mail-outbox";

import { enabled } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";

registerIntegrationCleanup();

const PASSWORD = "correct horse battery staple";
process.env.ACCOUNT_MAIL_WORKFLOW_ENABLED = "true";
process.env.ACCOUNT_MAIL_WORKER_SECRET = "db-integration-mail-worker";
process.env.APP_URL = "https://readwise.example.test";
process.env.NEXTAUTH_SECRET ??= "db-integration-nextauth-secret";

async function createAdmin(): Promise<string> {
  const adminId = id("admission_admin");
  await prisma.user.create({
    data: {
      id: adminId,
      email: `${adminId}@example.invalid`,
      emailVerified: new Date(),
      role: "Admin",
    },
  });
  return adminId;
}

test("Account Invitation is claimed atomically into one Reader and Password Credential", { skip: !enabled }, async () => {
  const invitedById = await createAdmin();
  const email = `${id("invitee")}@example.invalid`;
  const created = await createAccountInvitation({ email, invitedById });

  const result = await registerWithInvitation({
    token: created.token,
    email,
    name: "Invited Reader",
    password: PASSWORD,
  });

  assert.equal(result.user.email, email);
  assert.equal(result.user.role, "Reader");
  assert.equal(result.session.userId, result.user.id);

  const [credential, invitation] = await Promise.all([
    prisma.passwordCredential.findUniqueOrThrow({ where: { userId: result.user.id } }),
    prisma.accountInvitation.findUniqueOrThrow({ where: { id: created.invitation.id } }),
  ]);
  assert.equal(await verifyPassword(PASSWORD, credential.passwordHash), true);
  assert.equal(invitation.status, "ACCEPTED");
  assert.equal(invitation.acceptedById, result.user.id);
  assert.equal(invitation.activeForEmail, null);
  assert.equal(invitation.tokenHash, null);
  assert.equal(
    await prisma.auditLog.count({
      where: {
        action: "account.invitation.accept",
        targetId: created.invitation.id,
        actorId: result.user.id,
      },
    }),
    1,
  );
});

test("Account Invitation rejects the wrong email without consuming the grant", { skip: !enabled }, async () => {
  const invitedById = await createAdmin();
  const email = `${id("invitee")}@example.invalid`;
  const created = await createAccountInvitation({ email, invitedById });

  await assert.rejects(
    registerWithInvitation({
      token: created.token,
      email: `${id("wrong")}@example.invalid`,
      password: PASSWORD,
    }),
    /invitation does not match/i,
  );

  const invitation = await prisma.accountInvitation.findUniqueOrThrow({
    where: { id: created.invitation.id },
  });
  assert.equal(invitation.status, "PENDING");
  assert.equal(invitation.tokenHash !== null, true);
});

test("concurrent Account Invitation claims create exactly one User", { skip: !enabled }, async () => {
  const invitedById = await createAdmin();
  const email = `${id("race")}@example.invalid`;
  const created = await createAccountInvitation({ email, invitedById });

  const outcomes = await Promise.allSettled([
    registerWithInvitation({ token: created.token, email, password: PASSWORD }),
    registerWithInvitation({ token: created.token, email, password: PASSWORD }),
  ]);

  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
  assert.equal(await prisma.user.count({ where: { email } }), 1);
  assert.equal(
    await prisma.accountInvitation.count({
      where: { id: created.invitation.id, status: "ACCEPTED" },
    }),
    1,
  );
});

test("Account Invitation rotation invalidates the old token and revocation is idempotent", { skip: !enabled }, async () => {
  const invitedById = await createAdmin();
  const email = `${id("lifecycle")}@example.invalid`;
  const created = await createAccountInvitation({ email, invitedById });
  const rotated = await rotateAccountInvitation(created.invitation.id);

  assert.equal(
    (await inspectAccountInvitation(created.token)).status,
    "invalid",
  );
  assert.equal(
    (await inspectAccountInvitation(rotated.token)).status,
    "pending",
  );

  const revoked = await revokeAccountInvitation(created.invitation.id);
  const repeated = await revokeAccountInvitation(created.invitation.id);
  assert.equal(revoked.status, "REVOKED");
  assert.equal(repeated.status, "REVOKED");
  assert.equal(
    (await inspectAccountInvitation(rotated.token)).status,
    "invalid",
  );
});

test("Account email outbox claims only the active rotated link and fences acknowledgement", { skip: !enabled }, async () => {
  const invitedById = await createAdmin();
  const email = `${id("mail_queue")}@example.invalid`;
  const created = await createAccountInvitation({ email, invitedById });
  const rotated = await rotateAccountInvitation(created.invitation.id);

  assert.deepEqual(created.delivery, { queued: true });
  assert.deepEqual(rotated.delivery, { queued: true });
  const queuedRows = await prisma.accountEmailOutbox.findMany({
    where: { invitationId: created.invitation.id },
    orderBy: { createdAt: "asc" },
  });
  assert.equal(queuedRows.length, 2);
  assert.doesNotMatch(queuedRows[0]!.payload, new RegExp(email));
  assert.doesNotMatch(queuedRows[0]!.payload, new RegExp(created.token));

  const batches = await Promise.all([
    claimAccountMail(),
    claimAccountMail(),
  ]);
  const claimed = batches.flat();
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0]!.to, email);
  assert.match(claimed[0]!.body, new RegExp(rotated.token));
  assert.doesNotMatch(claimed[0]!.body, new RegExp(created.token));

  assert.equal(
    await acknowledgeAccountMail(
      claimed[0]!.id,
      "wrong-claim",
      "sent",
    ),
    false,
  );
  assert.equal(
    await acknowledgeAccountMail(
      claimed[0]!.id,
      claimed[0]!.claimToken,
      "sent",
    ),
    true,
  );
  const finalRows = await prisma.accountEmailOutbox.findMany({
    where: { invitationId: created.invitation.id },
    orderBy: { createdAt: "asc" },
  });
  assert.deepEqual(
    finalRows.map((row) => row.status).sort(),
    ["failed", "sent"],
  );
  assert.equal(finalRows.every((row) => row.payload === ""), true);
});

test("Public Account Admission verifies email before creating the User", { skip: !enabled }, async () => {
  const previousMode = process.env.ACCOUNT_ADMISSION_MODE;
  process.env.ACCOUNT_ADMISSION_MODE = "public";
  const email = `${id("public")}@example.invalid`;
  try {
    const pending = await beginPublicRegistration({
      email,
      name: "Public Reader",
      password: PASSWORD,
    });
    assert.ok(pending.token);

    assert.equal(await prisma.user.count({ where: { email } }), 0);

    const completed = await completePublicRegistration(pending.token);
    assert.equal(completed.user.email, email);
    assert.equal(completed.user.emailVerified instanceof Date, true);
    assert.equal(await prisma.pendingRegistration.count({ where: { normalizedEmail: email } }), 0);

    const login = await authenticatePassword({ email, password: PASSWORD });
    assert.equal(login?.user.id, completed.user.id);
  } finally {
    if (previousMode === undefined) delete process.env.ACCOUNT_ADMISSION_MODE;
    else process.env.ACCOUNT_ADMISSION_MODE = previousMode;
  }
});

test("Password Credential reset invalidates sessions and replaces the old password", { skip: !enabled }, async () => {
  const invitedById = await createAdmin();
  const email = `${id("reset")}@example.invalid`;
  const created = await createAccountInvitation({ email, invitedById });
  const registered = await registerWithInvitation({
    token: created.token,
    email,
    password: PASSWORD,
  });

  const reset = await requestPasswordReset(email);
  assert.ok(reset?.token);
  await resetPassword({
    token: reset.token,
    password: "a different secure password",
  });

  assert.equal(
    await prisma.session.count({ where: { userId: registered.user.id } }),
    0,
  );
  assert.equal(await authenticatePassword({ email, password: PASSWORD }), null);
  assert.ok(
    await authenticatePassword({
      email,
      password: "a different secure password",
    }),
  );
});

test("authenticated social-only users can add a Password Credential once", { skip: !enabled }, async () => {
  const userId = id("social_only");
  const email = `${userId}@example.invalid`;
  await prisma.user.create({
    data: {
      id: userId,
      email,
      role: "Reader",
      accounts: {
        create: {
          type: "oauth",
          provider: "google",
          providerAccountId: id("google_subject"),
        },
      },
    },
  });

  await setPasswordForUser({
    userId,
    password: PASSWORD,
  });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  assert.equal(user.emailVerified instanceof Date, true);
  assert.ok(await authenticatePassword({ email, password: PASSWORD }));

  await assert.rejects(
    setPasswordForUser({
      userId,
      currentPassword: "wrong current password",
      password: "a different secure password",
    }),
    /current password/i,
  );
});
