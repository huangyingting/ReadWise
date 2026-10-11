import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

import {
  accountAdmissionRetentionDays,
  emailDeliveryConfig,
  inspectAccountAdmissionConfig,
  inspectEmailDeliveryConfig,
} from "@/lib/runtime-config/account-admission";

const directPrivateKey = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

function restoreEnv(
  values: Record<string, string | undefined>,
): void {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test("email delivery is optional and supports authenticated SMTP", () => {
  const previous = {
    SMTP_URL: process.env.SMTP_URL,
    EMAIL_FROM: process.env.EMAIL_FROM,
    ACCOUNT_MAIL_FROM: process.env.ACCOUNT_MAIL_FROM,
    ACCOUNT_MAIL_DKIM_SELECTOR:
      process.env.ACCOUNT_MAIL_DKIM_SELECTOR,
    ACCOUNT_MAIL_DKIM_PRIVATE_KEY_BASE64:
      process.env.ACCOUNT_MAIL_DKIM_PRIVATE_KEY_BASE64,
  };
  try {
    delete process.env.SMTP_URL;
    delete process.env.EMAIL_FROM;
    delete process.env.ACCOUNT_MAIL_FROM;
    delete process.env.ACCOUNT_MAIL_DKIM_SELECTOR;
    delete process.env.ACCOUNT_MAIL_DKIM_PRIVATE_KEY_BASE64;
    assert.equal(emailDeliveryConfig.get(), null);

    process.env.SMTP_URL = "smtps://mailer.example.invalid:465";
    assert.equal(emailDeliveryConfig.get(), null);

    process.env.EMAIL_FROM = "ReadWise <noreply@example.invalid>";
    assert.deepEqual(emailDeliveryConfig.get(), {
      kind: "smtp",
      smtpUrl: "smtps://mailer.example.invalid:465",
      from: "ReadWise <noreply@example.invalid>",
    });
  } finally {
    restoreEnv(previous);
  }
});

test("complete direct DKIM configuration takes precedence over SMTP", () => {
  const previous = {
    SMTP_URL: process.env.SMTP_URL,
    EMAIL_FROM: process.env.EMAIL_FROM,
    ACCOUNT_MAIL_FROM: process.env.ACCOUNT_MAIL_FROM,
    ACCOUNT_MAIL_DKIM_SELECTOR:
      process.env.ACCOUNT_MAIL_DKIM_SELECTOR,
    ACCOUNT_MAIL_DKIM_PRIVATE_KEY_BASE64:
      process.env.ACCOUNT_MAIL_DKIM_PRIVATE_KEY_BASE64,
  };
  try {
    process.env.SMTP_URL = "smtps://mailer.example.invalid:465";
    process.env.EMAIL_FROM = "ReadWise <noreply@example.invalid>";
    process.env.ACCOUNT_MAIL_FROM = "NOREPLY@readwise.example.invalid";
    process.env.ACCOUNT_MAIL_DKIM_SELECTOR = "readwise-test";
    process.env.ACCOUNT_MAIL_DKIM_PRIVATE_KEY_BASE64 =
      Buffer.from(directPrivateKey).toString("base64");

    assert.deepEqual(emailDeliveryConfig.get(), {
      kind: "direct",
      from: "noreply@readwise.example.invalid",
      selector: "readwise-test",
      privateKey: directPrivateKey.trim(),
    });
    assert.equal(inspectEmailDeliveryConfig().status, "configured");
  } finally {
    restoreEnv(previous);
  }
});

test("invalid direct DKIM configuration degrades while SMTP remains usable", () => {
  const previous = {
    SMTP_URL: process.env.SMTP_URL,
    EMAIL_FROM: process.env.EMAIL_FROM,
    ACCOUNT_MAIL_FROM: process.env.ACCOUNT_MAIL_FROM,
    ACCOUNT_MAIL_DKIM_SELECTOR:
      process.env.ACCOUNT_MAIL_DKIM_SELECTOR,
    ACCOUNT_MAIL_DKIM_PRIVATE_KEY_BASE64:
      process.env.ACCOUNT_MAIL_DKIM_PRIVATE_KEY_BASE64,
  };
  try {
    process.env.SMTP_URL = "smtps://mailer.example.invalid:465";
    process.env.EMAIL_FROM = "ReadWise <noreply@example.invalid>";
    process.env.ACCOUNT_MAIL_FROM = "noreply@readwise.example.invalid";
    process.env.ACCOUNT_MAIL_DKIM_SELECTOR = "readwise-test";
    process.env.ACCOUNT_MAIL_DKIM_PRIVATE_KEY_BASE64 = "not-a-private-key";

    assert.equal(emailDeliveryConfig.get()?.kind, "smtp");
    const report = inspectEmailDeliveryConfig();
    assert.equal(report.status, "degraded");
    assert.equal(report.configured, true);
    assert.match(
      report.issues.map((item) => item.message).join(" "),
      /2048-bit RSA private key/i,
    );
  } finally {
    restoreEnv(previous);
  }
});

test("malformed SMTP does not satisfy public registration delivery", () => {
  const previous = {
    ACCOUNT_ADMISSION_MODE: process.env.ACCOUNT_ADMISSION_MODE,
    SMTP_URL: process.env.SMTP_URL,
    EMAIL_FROM: process.env.EMAIL_FROM,
    ACCOUNT_MAIL_FROM: process.env.ACCOUNT_MAIL_FROM,
    ACCOUNT_MAIL_DKIM_SELECTOR:
      process.env.ACCOUNT_MAIL_DKIM_SELECTOR,
    ACCOUNT_MAIL_DKIM_PRIVATE_KEY_BASE64:
      process.env.ACCOUNT_MAIL_DKIM_PRIVATE_KEY_BASE64,
  };
  try {
    process.env.ACCOUNT_ADMISSION_MODE = "public";
    process.env.SMTP_URL = "https://mailer.example.invalid";
    process.env.EMAIL_FROM = "ReadWise <noreply@example.invalid>";
    delete process.env.ACCOUNT_MAIL_FROM;
    delete process.env.ACCOUNT_MAIL_DKIM_SELECTOR;
    delete process.env.ACCOUNT_MAIL_DKIM_PRIVATE_KEY_BASE64;

    assert.equal(emailDeliveryConfig.get(), null);
    assert.equal(inspectEmailDeliveryConfig().status, "degraded");
    assert.equal(inspectAccountAdmissionConfig().configured, false);
  } finally {
    restoreEnv(previous);
  }
});

test("public Account Admission reports missing email delivery as degraded", () => {
  const previous = {
    ACCOUNT_ADMISSION_MODE: process.env.ACCOUNT_ADMISSION_MODE,
    SMTP_URL: process.env.SMTP_URL,
    EMAIL_FROM: process.env.EMAIL_FROM,
    ACCOUNT_MAIL_FROM: process.env.ACCOUNT_MAIL_FROM,
    ACCOUNT_MAIL_DKIM_SELECTOR:
      process.env.ACCOUNT_MAIL_DKIM_SELECTOR,
    ACCOUNT_MAIL_DKIM_PRIVATE_KEY_BASE64:
      process.env.ACCOUNT_MAIL_DKIM_PRIVATE_KEY_BASE64,
  };
  try {
    process.env.ACCOUNT_ADMISSION_MODE = "public";
    delete process.env.SMTP_URL;
    delete process.env.EMAIL_FROM;
    delete process.env.ACCOUNT_MAIL_FROM;
    delete process.env.ACCOUNT_MAIL_DKIM_SELECTOR;
    delete process.env.ACCOUNT_MAIL_DKIM_PRIVATE_KEY_BASE64;

    const report = inspectAccountAdmissionConfig();
    assert.equal(report.status, "degraded");
    assert.equal(report.configured, false);
    assert.match(
      report.issues[0]?.message ?? "",
      /public registration requires either direct DKIM account mail or SMTP delivery/i,
    );
  } finally {
    restoreEnv(previous);
  }
});

test("invalid Account Admission mode fails closed and reports a configuration error", () => {
  const previous = process.env.ACCOUNT_ADMISSION_MODE;
  try {
    process.env.ACCOUNT_ADMISSION_MODE = "test";
    const report = inspectAccountAdmissionConfig();
    assert.equal(report.status, "malformed");
    assert.equal(report.configured, false);
    assert.equal(report.issues[0]?.severity, "error");
  } finally {
    restoreEnv({ ACCOUNT_ADMISSION_MODE: previous });
  }
});

test("Account Admission retention defaults to 90 days and warns on invalid overrides", () => {
  const previous = process.env.ACCOUNT_ADMISSION_RETENTION_DAYS;
  try {
    delete process.env.ACCOUNT_ADMISSION_RETENTION_DAYS;
    assert.equal(accountAdmissionRetentionDays(), 90);

    process.env.ACCOUNT_ADMISSION_RETENTION_DAYS = "45";
    assert.equal(accountAdmissionRetentionDays(), 45);

    process.env.ACCOUNT_ADMISSION_RETENTION_DAYS = "invalid";
    assert.equal(accountAdmissionRetentionDays(), 90);
    const report = inspectAccountAdmissionConfig();
    assert.equal(report.status, "degraded");
    assert.match(
      report.issues.map((item) => item.message).join(" "),
      /positive integer/i,
    );
  } finally {
    restoreEnv({ ACCOUNT_ADMISSION_RETENTION_DAYS: previous });
  }
});
