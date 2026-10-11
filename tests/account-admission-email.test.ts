import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

let queuedMessages: Array<{
  message: Record<string, unknown>;
  expiresAt: Date;
}> = [];

before(() => {
  mock.module("@/lib/account-admission/account-mail-outbox", {
    namedExports: {
      queueAccountMail: async (
        _tx: unknown,
        message: Record<string, unknown>,
        expiresAt: Date,
      ) => {
        queuedMessages.push({ message, expiresAt });
        return { id: "mail-1" };
      },
    },
  });
});

beforeEach(() => {
  queuedMessages = [];
  process.env.ACCOUNT_MAIL_WORKFLOW_ENABLED = "true";
  process.env.ACCOUNT_MAIL_WORKER_SECRET = "worker-secret";
  process.env.APP_URL = "https://readwise.example.test";
  process.env.NEXTAUTH_URL = "http://readwise:3000";
});

test("invitation email queueing degrades explicitly when the workflow is absent", async () => {
  delete process.env.ACCOUNT_MAIL_WORKFLOW_ENABLED;
  delete process.env.ACCOUNT_MAIL_WORKER_SECRET;
  const { queueAccountInvitationEmail } = await import(
    "@/lib/account-admission/email"
  );
  const result = await queueAccountInvitationEmail({} as never, {
    email: "reader@example.test",
    token: "invite-token",
    expiresAt: new Date("2026-10-20T00:00:00.000Z"),
    invitationId: "invitation-1",
    invitationTokenHash: "invite-hash",
  });

  assert.deepEqual(result, {
    queued: false,
    reason: "email_not_configured",
  });
  assert.equal(queuedMessages.length, 0);
});

test("verification and reset emails queue single-purpose secret links", async () => {
  const {
    queuePasswordResetEmail,
    queueRegistrationVerificationEmail,
  } = await import("@/lib/account-admission/email");
  const expiresAt = new Date("2026-10-20T00:00:00.000Z");

  assert.deepEqual(
    await queueRegistrationVerificationEmail({} as never, {
      email: "reader@example.test",
      token: "verify-token",
      expiresAt,
      registrationHash: "registration-hash",
    }),
    { queued: true },
  );
  assert.deepEqual(
    await queuePasswordResetEmail({} as never, {
      email: "reader@example.test",
      token: "reset-token",
      expiresAt,
      passwordResetHash: "reset-hash",
    }),
    { queued: true },
  );

  assert.equal(queuedMessages.length, 2);
  assert.doesNotMatch(
    String(queuedMessages[0]?.message.body),
    /readwise:3000/,
  );
  assert.doesNotMatch(
    String(queuedMessages[1]?.message.body),
    /readwise:3000/,
  );
  assert.match(
    String(queuedMessages[0]?.message.body),
    /verify-email\/verify-token/,
  );
  assert.match(
    String(queuedMessages[1]?.message.body),
    /reset-password\/reset-token/,
  );
  assert.doesNotMatch(
    String(queuedMessages[0]?.message.body),
    /reset-token/,
  );
  assert.doesNotMatch(
    String(queuedMessages[1]?.message.body),
    /verify-token/,
  );
  assert.equal(
    queuedMessages[0]?.message.registrationHash,
    "registration-hash",
  );
  assert.equal(
    queuedMessages[1]?.message.passwordResetHash,
    "reset-hash",
  );
});
