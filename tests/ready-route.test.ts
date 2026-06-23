process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";

const ENV_KEYS = [
  "DATABASE_URL",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_DEPLOYMENT",
  "AZURE_OPENAI_API_VERSION",
] as const;

let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
let dbFails = false;
let migrationFails = false;
let migrationPending = 0;

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: {
      requireSessionApi: async () => ({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      }),
      requireAdminApi: async () => ({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      }),
    },
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        $queryRaw: async () => {
          if (dbFails) throw new Error("db down");
          return [{ ok: 1 }];
        },
        $queryRawUnsafe: async () => {
          if (migrationFails) throw new Error("migration table missing");
          return [{ pending: migrationPending }];
        },
      },
    },
  });
});

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.DATABASE_URL = "file:./dev.db";
  process.env.NEXTAUTH_SECRET = "12345678901234567890123456789012";
  process.env.NEXTAUTH_URL = "http://localhost:3000";
  dbFails = false;
  migrationFails = false;
  migrationPending = 0;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

async function getReadyResponse() {
  const { GET } = await import("@/app/api/ready/route");
  return GET(new Request("http://test/api/ready"));
}

test("GET /api/ready returns ready when DB, migrations, and required config are healthy", async () => {
  process.env.AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com";

  const res = await getReadyResponse();
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.status, "ready");
  assert.equal(body.checks.db, "ok");
  assert.equal(body.checks.migrations, "ok");
  assert.equal(body.checks.config, "ok");
  assert.equal(body.checks.providers.ai, "degraded");
});

test("GET /api/ready returns unavailable when DB connectivity fails", async () => {
  dbFails = true;

  const res = await getReadyResponse();
  const body = await res.json();

  assert.equal(res.status, 503);
  assert.equal(body.status, "unavailable");
  assert.equal(body.checks.db, "error");
  assert.equal(body.checks.migrations, "error");
});

test("GET /api/ready returns unavailable when migration health fails", async () => {
  migrationFails = true;

  const res = await getReadyResponse();
  const body = await res.json();

  assert.equal(res.status, 503);
  assert.equal(body.checks.db, "ok");
  assert.equal(body.checks.migrations, "error");
});

test("GET /api/ready returns unavailable when migrations are unfinished", async () => {
  migrationPending = 1;

  const res = await getReadyResponse();
  const body = await res.json();

  assert.equal(res.status, 503);
  assert.equal(body.checks.migrations, "error");
  assert.equal(body.migrations.pending, 1);
});

test("GET /api/ready returns unavailable when required config is invalid", async () => {
  process.env.NEXTAUTH_SECRET = "short";

  const res = await getReadyResponse();
  const body = await res.json();

  assert.equal(res.status, 503);
  assert.equal(body.checks.config, "error");
  assert.ok(body.config.errors.some((err: { code: string }) => err.code === "weak_secret"));
});
