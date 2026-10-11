import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accountAdmissionMode,
  isValidAccountEmail,
  normalizeAccountEmail,
  verifiedProviderEmail,
} from "@/lib/account-admission/policy";
import {
  hashPassword,
  passwordPolicyError,
  verifyPassword,
} from "@/lib/account-admission/passwords";

test("Account Admission defaults closed and exposes only invitation-only or public", () => {
  const previous = process.env.ACCOUNT_ADMISSION_MODE;
  try {
    delete process.env.ACCOUNT_ADMISSION_MODE;
    assert.equal(accountAdmissionMode(), "invitation-only");

    process.env.ACCOUNT_ADMISSION_MODE = "public";
    assert.equal(accountAdmissionMode(), "public");

    process.env.ACCOUNT_ADMISSION_MODE = "unexpected";
    assert.equal(accountAdmissionMode(), "invitation-only");
  } finally {
    if (previous === undefined) delete process.env.ACCOUNT_ADMISSION_MODE;
    else process.env.ACCOUNT_ADMISSION_MODE = previous;
  }
});

test("account email normalization changes case and whitespace but not aliases", () => {
  assert.equal(normalizeAccountEmail(" Reader+News@Example.COM "), "reader+news@example.com");
  assert.equal(normalizeAccountEmail("first.last@gmail.com"), "first.last@gmail.com");
  assert.equal(isValidAccountEmail("reader@example.com"), true);
  assert.equal(isValidAccountEmail("reader @example.com"), false);
  assert.equal(isValidAccountEmail("missing-domain@"), false);
});

test("provider email verification is provider-specific and fails closed", () => {
  assert.equal(
    verifiedProviderEmail("google", {
      email: " Reader@Example.com ",
      email_verified: true,
    }),
    "reader@example.com",
  );
  assert.equal(
    verifiedProviderEmail("google", {
      email: "reader@example.com",
      email_verified: false,
    }),
    null,
  );
  assert.equal(
    verifiedProviderEmail("azure-ad", {
      email: " Reader@Example.com ",
      sub: "entra-subject",
    }),
    "reader@example.com",
  );
  assert.equal(verifiedProviderEmail("azure-ad", { email: "", sub: "entra-subject" }), null);
  assert.equal(verifiedProviderEmail("unknown", { email: "reader@example.com" }), null);
});

test("password policy requires a bounded non-trivial password", () => {
  assert.match(passwordPolicyError("short") ?? "", /at least 12/i);
  assert.match(passwordPolicyError("a".repeat(129)) ?? "", /at most 128/i);
  assert.equal(passwordPolicyError("correct horse battery staple"), null);
});

test("Password Credential hashes verify without storing the password", async () => {
  const password = "correct horse battery staple";
  const encoded = await hashPassword(password);

  assert.match(encoded, /^scrypt\$/);
  assert.equal(encoded.includes(password), false);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword("incorrect password", encoded), false);
  assert.equal(await verifyPassword(password, "malformed"), false);
});
