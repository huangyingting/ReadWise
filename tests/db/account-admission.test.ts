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
import {
  expirePendingInvitations,
  listAccountInvitations,
} from "@/lib/account-admission/invitations";
import { listAuthenticationMethods } from "@/lib/account-admission/credentials";
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

/** Rejects with an AccountAdmissionError carrying `code` (and `status` when given). */
async function rejectsWithCode(
  action: Promise<unknown>,
  code: string,
  status?: number,
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    const failure = error as { code?: string; status?: number };
    assert.equal(failure.code, code);
    if (status !== undefined) assert.equal(failure.status, status);
    return true;
  });
}

async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> {
  const previous = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const PUBLIC_MODE = { ACCOUNT_ADMISSION_MODE: "public" };
const MAIL_DISABLED = { ACCOUNT_MAIL_WORKFLOW_ENABLED: "false" };

async function expireInvitation(invitationId: string): Promise<void> {
  await prisma.accountInvitation.update({
    where: { id: invitationId },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });
}

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

test("Account Invitation creation validates input and refuses duplicate grants", { skip: !enabled }, async () => {
  const invitedById = await createAdmin();
  const email = `${id("dupe")}@example.invalid`;

  await rejectsWithCode(createAccountInvitation({ email: "not an email", invitedById }), "invalid_email", 400);
  await rejectsWithCode(
    createAccountInvitation({ email, invitedById, expiresAt: new Date(Date.now() - 1_000) }),
    "invalid_expiry",
    400,
  );

  await createAccountInvitation({ email, invitedById });
  await rejectsWithCode(createAccountInvitation({ email, invitedById }), "invitation_exists", 409);

  const memberId = id("existing_member");
  await prisma.user.create({ data: { id: memberId, email: `${memberId}@example.invalid` } });
  await rejectsWithCode(
    createAccountInvitation({ email: `${memberId}@example.invalid`, invitedById }),
    "already_member",
    409,
  );
});

test("expired Account Invitations are swept, reported, and cannot transition", { skip: !enabled }, async () => {
  const invitedById = await createAdmin();
  const invite = async (label: string) =>
    createAccountInvitation({ email: `${id(label)}@example.invalid`, invitedById });

  const inspected = await invite("expired_inspect");
  await expireInvitation(inspected.invitation.id);
  const view = await inspectAccountInvitation(inspected.token);
  assert.equal(view.status, "expired");
  assert.match(view.maskedEmail ?? "", /^\w{2}\*+@example\.invalid$/);
  assert.equal((await inspectAccountInvitation(inspected.token)).status, "invalid");

  const revoked = await invite("expired_revoke");
  await expireInvitation(revoked.invitation.id);
  await rejectsWithCode(revokeAccountInvitation(revoked.invitation.id), "invalid_transition", 409);

  const rotated = await invite("expired_rotate");
  await expireInvitation(rotated.invitation.id);
  await rejectsWithCode(rotateAccountInvitation(rotated.invitation.id), "invalid_transition", 409);

  const claimed = await invite("expired_claim");
  await expireInvitation(claimed.invitation.id);
  await rejectsWithCode(
    registerWithInvitation({
      token: claimed.token,
      email: claimed.invitation.email,
      password: PASSWORD,
    }),
    "expired",
    410,
  );

  const swept = await invite("expired_sweep");
  await expireInvitation(swept.invitation.id);
  assert.ok((await expirePendingInvitations()) >= 1);
  const listed = await listAccountInvitations();
  assert.equal(listed.find((row) => row.id === swept.invitation.id)?.status, "EXPIRED");
  assert.equal(listed.find((row) => row.id === swept.invitation.id)?.invitedBy?.id, invitedById);
});

test("Account Invitation transitions reject unknown and already-claimed invitations", { skip: !enabled }, async () => {
  const invitedById = await createAdmin();
  await rejectsWithCode(revokeAccountInvitation(id("missing")), "not_found", 404);
  await rejectsWithCode(rotateAccountInvitation(id("missing")), "not_found", 404);

  const email = `${id("accepted")}@example.invalid`;
  const created = await createAccountInvitation({ email, invitedById });
  await registerWithInvitation({ token: created.token, email, password: PASSWORD });
  await rejectsWithCode(revokeAccountInvitation(created.invitation.id), "invalid_transition", 409);
  await rejectsWithCode(rotateAccountInvitation(created.invitation.id), "invalid_transition", 409);
  await rejectsWithCode(
    registerWithInvitation({ token: created.token, email, password: PASSWORD }),
    "invalid_invitation",
    410,
  );
});

test("Invitation registration enforces mode, email shape, and existing accounts", { skip: !enabled }, async () => {
  const invitedById = await createAdmin();
  const email = `${id("late_member")}@example.invalid`;
  const created = await createAccountInvitation({ email, invitedById });

  await withEnv(PUBLIC_MODE, () =>
    rejectsWithCode(
      registerWithInvitation({ token: created.token, email, password: PASSWORD }),
      "mode_mismatch",
      409,
    ),
  );
  await rejectsWithCode(
    registerWithInvitation({ token: created.token, email: "bad email", password: PASSWORD }),
    "invalid_email",
    400,
  );

  // The account appeared through another path after the invitation was sent.
  await prisma.user.create({ data: { id: id("late_member_user"), email } });
  await rejectsWithCode(
    registerWithInvitation({ token: created.token, email, password: PASSWORD }),
    "already_member",
    409,
  );
});

test("Public Account Admission enforces mode, mail delivery, expiry, and existing accounts", { skip: !enabled }, async () => {
  await rejectsWithCode(
    beginPublicRegistration({ email: `${id("closed")}@example.invalid`, password: PASSWORD }),
    "invitation_required",
    403,
  );
  await rejectsWithCode(completePublicRegistration("any-token"), "registration_closed", 403);

  await withEnv(PUBLIC_MODE, async () => {
    const memberId = id("public_member");
    const memberEmail = `${memberId}@example.invalid`;
    await prisma.user.create({ data: { id: memberId, email: memberEmail } });
    const silent = await beginPublicRegistration({ email: memberEmail, password: PASSWORD });
    assert.equal(silent.token, null);

    await withEnv(MAIL_DISABLED, () =>
      rejectsWithCode(
        beginPublicRegistration({ email: `${id("no_mail")}@example.invalid`, password: PASSWORD }),
        "email_unavailable",
        503,
      ),
    );

    await rejectsWithCode(completePublicRegistration("not-a-real-token"), "invalid_registration", 410);

    const expiredEmail = `${id("public_expired")}@example.invalid`;
    const expired = await beginPublicRegistration({ email: expiredEmail, password: PASSWORD });
    await prisma.pendingRegistration.update({
      where: { normalizedEmail: expiredEmail },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await rejectsWithCode(completePublicRegistration(expired.token!), "expired", 410);

    const racedEmail = `${id("public_raced")}@example.invalid`;
    const raced = await beginPublicRegistration({ email: racedEmail, password: PASSWORD });
    await prisma.user.create({ data: { id: id("public_raced_user"), email: racedEmail } });
    await rejectsWithCode(completePublicRegistration(raced.token!), "invalid_registration", 409);
    assert.equal(await prisma.pendingRegistration.count({ where: { normalizedEmail: racedEmail } }), 0);
  });
});

test("Password Credential recovery handles delivery, expiry, invalid links, and listing", { skip: !enabled }, async () => {
  const invitedById = await createAdmin();
  const email = `${id("recovery")}@example.invalid`;
  const created = await createAccountInvitation({ email, invitedById });
  const registered = await registerWithInvitation({ token: created.token, email, password: PASSWORD });

  assert.equal(await requestPasswordReset(`${id("unknown")}@example.invalid`), null);
  await withEnv(MAIL_DISABLED, () => rejectsWithCode(requestPasswordReset(email), "email_unavailable", 503));

  await rejectsWithCode(resetPassword({ token: "not-a-real-token", password: PASSWORD }), "invalid_reset", 410);

  const reset = await requestPasswordReset(email);
  await prisma.passwordCredential.update({
    where: { userId: registered.user.id },
    data: { resetExpiresAt: new Date(Date.now() - 60_000) },
  });
  await rejectsWithCode(resetPassword({ token: reset!.token, password: PASSWORD }), "expired", 410);

  const changed = await setPasswordForUser({
    userId: registered.user.id,
    currentPassword: PASSWORD,
    password: "a different secure password",
  });
  assert.deepEqual(changed, { userId: registered.user.id, created: false });
  assert.ok(await authenticatePassword({ email, password: "a different secure password" }));

  const emaillessId = id("emailless");
  await prisma.user.create({ data: { id: emaillessId } });
  await rejectsWithCode(setPasswordForUser({ userId: emaillessId, password: PASSWORD }), "email_required", 400);

  await prisma.account.create({
    data: {
      userId: registered.user.id,
      type: "oauth",
      provider: "google",
      providerAccountId: id("google_link"),
    },
  });
  assert.deepEqual(await listAuthenticationMethods(registered.user.id), {
    hasPassword: true,
    providers: ["google"],
  });
  await rejectsWithCode(listAuthenticationMethods(id("missing_user")), "not_found", 404);
});

test("Account email outbox delivers reset and verification mail and fails undecryptable rows", { skip: !enabled }, async () => {
  const invitedById = await createAdmin();
  const email = `${id("outbox_reset")}@example.invalid`;
  const created = await createAccountInvitation({ email, invitedById });
  await registerWithInvitation({ token: created.token, email, password: PASSWORD });
  // Drain the invitation mail queued above so only the cases below remain.
  await claimAccountMail();

  const reset = await requestPasswordReset(email);
  const publicEmail = `${id("outbox_public")}@example.invalid`;
  const pending = await withEnv(PUBLIC_MODE, () =>
    beginPublicRegistration({ email: publicEmail, password: PASSWORD }),
  );
  const corrupt = await prisma.accountEmailOutbox.create({
    data: { payload: "not.a-valid.payload", expiresAt: new Date(Date.now() + 60_000) },
  });

  const claimed = await claimAccountMail();
  const byRecipient = new Map(claimed.map((message) => [message.to, message]));
  assert.match(byRecipient.get(email)?.body ?? "", new RegExp(reset!.token));
  assert.match(byRecipient.get(publicEmail)?.body ?? "", new RegExp(pending.token!));

  const failed = await prisma.accountEmailOutbox.findUniqueOrThrow({ where: { id: corrupt.id } });
  assert.equal(failed.status, "failed");
  assert.equal(failed.payload, "");
});
