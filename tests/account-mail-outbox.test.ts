import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: { prisma: {} },
  });
});

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "test-account-mail-secret";
});

test("account mail payload encryption round-trips without persisting plaintext", async () => {
  const {
    decryptAccountMail,
    encryptAccountMail,
  } = await import("@/lib/account-admission/account-mail-outbox");
  const message = {
    to: "reader@example.test",
    subject: "Reset",
    body: "https://readwise.example.test/reset-password/private-token",
    passwordResetHash: "reset-hash",
  };

  const encrypted = encryptAccountMail(message);

  assert.doesNotMatch(encrypted, /reader@example\.test|private-token/);
  assert.deepEqual(decryptAccountMail(encrypted), message);
});

test("account mail payload encryption rejects tampering and missing link context", async () => {
  const {
    decryptAccountMail,
    encryptAccountMail,
  } = await import("@/lib/account-admission/account-mail-outbox");
  const encrypted = encryptAccountMail({
    to: "reader@example.test",
    subject: "Invitation",
    body: "Private link",
    invitationId: "invitation-1",
    invitationTokenHash: "invitation-hash",
  });
  const [nonce, tag, body] = encrypted.split(".");
  const altered = Buffer.from(body!, "base64url");
  altered[0] ^= 1;

  assert.throws(() =>
    decryptAccountMail(
      `${nonce}.${tag}.${altered.toString("base64url")}`,
    ),
  );
  assert.throws(() =>
    encryptAccountMail({
      to: "reader@example.test",
      subject: "Invalid",
      body: "No link context",
    } as never),
  );
});

test("account mail encryption fails closed on missing key material and invalid messages", async () => {
  const { createCipheriv, createHash, randomBytes } = await import("node:crypto");
  const {
    decryptAccountMail,
    encryptAccountMail,
  } = await import("@/lib/account-admission/account-mail-outbox");
  const message = {
    to: "reader@example.test",
    subject: "Reset",
    body: "Private link",
    passwordResetHash: "reset-hash",
  };

  delete process.env.NEXTAUTH_SECRET;
  assert.throws(() => encryptAccountMail(message), /NEXTAUTH_SECRET is required/);
  process.env.NEXTAUTH_SECRET = "test-account-mail-secret";

  assert.throws(() => encryptAccountMail({ ...message, to: "" }), /Invalid account mail payload/);
  assert.throws(() => decryptAccountMail("only.two"), /Invalid account mail payload/);

  // Authentic ciphertext whose plaintext is not an account mail message.
  const key = createHash("sha256")
    .update("readwise-account-mail:test-account-mail-secret")
    .digest();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ to: "x" }), "utf8"), cipher.final()]);
  const forged = [nonce, cipher.getAuthTag(), encrypted]
    .map((value) => value.toString("base64url"))
    .join(".");
  assert.throws(() => decryptAccountMail(forged), /Invalid account mail payload/);
});

test("account mail is never queued while delivery is unconfigured", async () => {
  const { queueAccountMail } = await import("@/lib/account-admission/account-mail-outbox");
  const previous = process.env.ACCOUNT_MAIL_WORKFLOW_ENABLED;
  delete process.env.ACCOUNT_MAIL_WORKFLOW_ENABLED;
  let created = false;
  try {
    await assert.rejects(
      queueAccountMail(
        { accountEmailOutbox: { create: async () => { created = true; } } } as never,
        { to: "reader@example.test", subject: "Reset", body: "Link", passwordResetHash: "hash" },
        new Date(Date.now() + 60_000),
      ),
      /not configured/,
    );
    assert.equal(created, false);
  } finally {
    if (previous === undefined) delete process.env.ACCOUNT_MAIL_WORKFLOW_ENABLED;
    else process.env.ACCOUNT_MAIL_WORKFLOW_ENABLED = previous;
  }
});
