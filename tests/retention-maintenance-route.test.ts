process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { afterEach, before, mock, test } from "node:test";

import type { RetentionOptions } from "@/lib/retention/maintenance";

const workerSecret = "r".repeat(48);
let lastOptions: RetentionOptions | null = null;
let previousSecret: string | undefined;

before(() => {
  mock.module("@/lib/retention/maintenance", {
    namedExports: {
      retentionMaintenanceOptions: (dryRun: boolean): RetentionOptions => ({
        dryRun,
        analyticsDays: 400,
        aiDays: 365,
        auditDays: 730,
        jobsDays: 90,
        admissionDays: 90,
      }),
      runRetentionMaintenance: async (options: RetentionOptions) => {
        lastOptions = options;
        return {
          dryRun: options.dryRun,
          executed: !options.dryRun,
          results: [
            {
              area: "account-admission",
              retentionDays: options.admissionDays,
              matched: 2,
              deleted: options.dryRun ? 0 : 2,
            },
          ],
        };
      },
    },
  });
});

afterEach(() => {
  lastOptions = null;
  if (previousSecret === undefined) {
    delete process.env.RETENTION_WORKER_SECRET;
  } else {
    process.env.RETENTION_WORKER_SECRET = previousSecret;
  }
});

async function postRetention(input?: {
  secret?: string;
  dryRun?: boolean;
}) {
  const { POST } = await import("@/app/api/maintenance/retention/route");
  const url = new URL("http://test/api/maintenance/retention");
  if (input?.dryRun) url.searchParams.set("dryRun", "1");
  const headers = new Headers();
  if (input?.secret) {
    headers.set("authorization", `Bearer ${input.secret}`);
  }
  return POST(new Request(url, { method: "POST", headers }));
}

test("retention endpoint fails closed when the worker secret is absent", async () => {
  previousSecret = process.env.RETENTION_WORKER_SECRET;
  delete process.env.RETENTION_WORKER_SECRET;

  const response = await postRetention();

  assert.equal(response.status, 503);
  assert.equal(lastOptions, null);
});

test("retention endpoint rejects an invalid bearer token", async () => {
  previousSecret = process.env.RETENTION_WORKER_SECRET;
  process.env.RETENTION_WORKER_SECRET = workerSecret;

  const response = await postRetention({ secret: "wrong-secret" });

  assert.equal(response.status, 401);
  assert.equal(lastOptions, null);
});

test("scheduled retention executes policy defaults and returns metadata only", async () => {
  previousSecret = process.env.RETENTION_WORKER_SECRET;
  process.env.RETENTION_WORKER_SECRET = workerSecret;

  const response = await postRetention({ secret: workerSecret });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(lastOptions?.dryRun, false);
  assert.deepEqual(body, {
    dryRun: false,
    executed: true,
    results: [
      {
        area: "account-admission",
        retentionDays: 90,
        matched: 2,
        deleted: 2,
      },
    ],
  });
});

test("manual retention dry-run never executes deletion", async () => {
  previousSecret = process.env.RETENTION_WORKER_SECRET;
  process.env.RETENTION_WORKER_SECRET = workerSecret;

  const response = await postRetention({
    secret: workerSecret,
    dryRun: true,
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(lastOptions?.dryRun, true);
  assert.equal(body.executed, false);
  assert.equal(body.results[0].deleted, 0);
});
