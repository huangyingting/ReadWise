import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accountAdmissionRetentionDays,
  accountMailWorkflowConfig,
  inspectAccountAdmissionConfig,
  inspectEmailDeliveryConfig,
} from "@/lib/runtime-config/account-admission";

function restoreEnv(
  values: Record<string, string | undefined>,
): void {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test("GitHub Actions account mail is optional and requires an enabled worker secret", () => {
  const previous = {
    ACCOUNT_MAIL_WORKFLOW_ENABLED:
      process.env.ACCOUNT_MAIL_WORKFLOW_ENABLED,
    ACCOUNT_MAIL_WORKER_SECRET: process.env.ACCOUNT_MAIL_WORKER_SECRET,
  };
  try {
    delete process.env.ACCOUNT_MAIL_WORKFLOW_ENABLED;
    delete process.env.ACCOUNT_MAIL_WORKER_SECRET;
    assert.equal(accountMailWorkflowConfig.get(), null);
    assert.equal(inspectEmailDeliveryConfig().status, "unconfigured");

    process.env.ACCOUNT_MAIL_WORKFLOW_ENABLED = "true";
    assert.equal(accountMailWorkflowConfig.get(), null);
    assert.equal(inspectEmailDeliveryConfig().status, "degraded");

    process.env.ACCOUNT_MAIL_WORKER_SECRET = "worker-secret";
    assert.deepEqual(accountMailWorkflowConfig.get(), {
      secret: "worker-secret",
    });
    assert.equal(inspectEmailDeliveryConfig().status, "configured");
  } finally {
    restoreEnv(previous);
  }
});

test("invalid or inactive account mail workflow configuration degrades explicitly", () => {
  const previous = {
    ACCOUNT_MAIL_WORKFLOW_ENABLED:
      process.env.ACCOUNT_MAIL_WORKFLOW_ENABLED,
    ACCOUNT_MAIL_WORKER_SECRET: process.env.ACCOUNT_MAIL_WORKER_SECRET,
  };
  try {
    process.env.ACCOUNT_MAIL_WORKFLOW_ENABLED = "sometimes";
    process.env.ACCOUNT_MAIL_WORKER_SECRET = "worker-secret";
    assert.equal(accountMailWorkflowConfig.get(), null);
    const invalid = inspectEmailDeliveryConfig();
    assert.equal(invalid.status, "degraded");
    assert.match(
      invalid.issues.map((item) => item.message).join(" "),
      /must be true or false/i,
    );

    process.env.ACCOUNT_MAIL_WORKFLOW_ENABLED = "false";
    const inactive = inspectEmailDeliveryConfig();
    assert.equal(inactive.status, "degraded");
    assert.match(
      inactive.issues.map((item) => item.message).join(" "),
      /not enabled/i,
    );
  } finally {
    restoreEnv(previous);
  }
});

test("public Account Admission requires queued email delivery", () => {
  const previous = {
    ACCOUNT_ADMISSION_MODE: process.env.ACCOUNT_ADMISSION_MODE,
    ACCOUNT_MAIL_WORKFLOW_ENABLED:
      process.env.ACCOUNT_MAIL_WORKFLOW_ENABLED,
    ACCOUNT_MAIL_WORKER_SECRET: process.env.ACCOUNT_MAIL_WORKER_SECRET,
  };
  try {
    process.env.ACCOUNT_ADMISSION_MODE = "public";
    delete process.env.ACCOUNT_MAIL_WORKFLOW_ENABLED;
    delete process.env.ACCOUNT_MAIL_WORKER_SECRET;

    const report = inspectAccountAdmissionConfig();
    assert.equal(report.status, "degraded");
    assert.equal(report.configured, false);
    assert.match(
      report.issues[0]?.message ?? "",
      /GitHub Actions account mail workflow/i,
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
