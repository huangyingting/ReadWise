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
