import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accountAdmissionRetentionDays,
  emailDeliveryConfig,
  inspectAccountAdmissionConfig,
} from "@/lib/runtime-config/account-admission";

function restoreEnv(
  values: Record<string, string | undefined>,
): void {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test("email delivery is optional and requires both SMTP_URL and EMAIL_FROM", () => {
  const previous = {
    SMTP_URL: process.env.SMTP_URL,
    EMAIL_FROM: process.env.EMAIL_FROM,
  };
  try {
    delete process.env.SMTP_URL;
    delete process.env.EMAIL_FROM;
    assert.equal(emailDeliveryConfig.get(), null);

    process.env.SMTP_URL = "smtps://mailer.example.invalid:465";
    assert.equal(emailDeliveryConfig.get(), null);

    process.env.EMAIL_FROM = "ReadWise <noreply@example.invalid>";
    assert.deepEqual(emailDeliveryConfig.get(), {
      smtpUrl: "smtps://mailer.example.invalid:465",
      from: "ReadWise <noreply@example.invalid>",
    });
  } finally {
    restoreEnv(previous);
  }
});

test("public Account Admission reports missing email delivery as degraded", () => {
  const previous = {
    ACCOUNT_ADMISSION_MODE: process.env.ACCOUNT_ADMISSION_MODE,
    SMTP_URL: process.env.SMTP_URL,
    EMAIL_FROM: process.env.EMAIL_FROM,
  };
  try {
    process.env.ACCOUNT_ADMISSION_MODE = "public";
    delete process.env.SMTP_URL;
    delete process.env.EMAIL_FROM;

    const report = inspectAccountAdmissionConfig();
    assert.equal(report.status, "degraded");
    assert.equal(report.configured, false);
    assert.match(report.issues[0]?.message ?? "", /public registration requires email delivery/i);
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
