import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  inspectRetentionWorkerConfig,
  retentionWorkerConfig,
} from "@/lib/runtime-config/maintenance";

const previousSecret = process.env.RETENTION_WORKER_SECRET;

afterEach(() => {
  if (previousSecret === undefined) delete process.env.RETENTION_WORKER_SECRET;
  else process.env.RETENTION_WORKER_SECRET = previousSecret;
});

test("retention worker config is unconfigured without a secret", () => {
  delete process.env.RETENTION_WORKER_SECRET;

  assert.equal(retentionWorkerConfig.get(), null);
  assert.deepEqual(inspectRetentionWorkerConfig(), {
    status: "unconfigured",
    configured: false,
    required: false,
    env: ["RETENTION_WORKER_SECRET"],
    missing: [],
    issues: [],
  });
});

test("retention worker config degrades when the secret is too short", () => {
  process.env.RETENTION_WORKER_SECRET = "s".repeat(31);

  assert.equal(retentionWorkerConfig.get(), null);
  const report = inspectRetentionWorkerConfig();
  assert.equal(report.status, "degraded");
  assert.equal(report.configured, false);
  assert.deepEqual(
    report.issues.map((entry) => entry.code),
    ["retention_worker_secret_too_short"],
  );
});

test("retention worker config is configured with a long enough secret", () => {
  const secret = "s".repeat(32);
  process.env.RETENTION_WORKER_SECRET = secret;

  assert.deepEqual(retentionWorkerConfig.get(), { secret });
  assert.deepEqual(inspectRetentionWorkerConfig(), {
    status: "configured",
    configured: true,
    required: false,
    env: ["RETENTION_WORKER_SECRET"],
    missing: [],
    issues: [],
  });
});
