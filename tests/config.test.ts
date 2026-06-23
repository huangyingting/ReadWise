import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { pushConfig, validateRuntimeConfig } from "@/lib/config";

const ENV_KEYS = [
  "DATABASE_URL",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "AZURE_AD_CLIENT_ID",
  "AZURE_AD_CLIENT_SECRET",
  "AZURE_AD_TENANT_ID",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_DEPLOYMENT",
  "AZURE_OPENAI_API_VERSION",
  "AZURE_SPEECH_KEY",
  "AZURE_SPEECH_REGION",
  "AZURE_SPEECH_OUTPUT_FORMAT",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
  "AI_REQUEST_TIMEOUT_MS",
  "AI_MAX_RETRIES",
  "SPEECH_TIMEOUT_MS",
  "RATE_LIMIT_AI_REQUESTS",
  "RATE_LIMIT_LOOKUP_REQUESTS",
  "RATE_LIMIT_PUBLIC_REQUESTS",
  "RATE_LIMIT_WINDOW_MS",
  "LOG_LEVEL",
] as const;

let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
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

function setRequiredEnv() {
  process.env.DATABASE_URL = "file:./dev.db";
  process.env.NEXTAUTH_SECRET = "12345678901234567890123456789012";
  process.env.NEXTAUTH_URL = "http://localhost:3000";
}

test("validateRuntimeConfig reports missing critical env vars as not ready", () => {
  const report = validateRuntimeConfig();
  assert.equal(report.ready, false);
  assert.equal(report.status, "unavailable");
  assert.equal(report.required.database.status, "missing");
  assert.equal(report.required.auth.status, "missing");
  assert.ok(report.errors.some((err) => err.env.includes("DATABASE_URL")));
  assert.ok(report.errors.some((err) => err.env.includes("NEXTAUTH_SECRET")));
});

test("validateRuntimeConfig is ready with required env and absent optional providers", () => {
  setRequiredEnv();

  const report = validateRuntimeConfig();

  assert.equal(report.ready, true);
  assert.equal(report.required.database.status, "ok");
  assert.equal(report.required.auth.status, "ok");
  assert.equal(report.optional.ai.status, "unconfigured");
  assert.equal(report.optional.speech.status, "unconfigured");
  assert.equal(report.optional.push.status, "unconfigured");
  assert.equal(report.errors.length, 0);
});

test("validateRuntimeConfig accepts PostgreSQL DATABASE_URL protocols", () => {
  for (const databaseUrl of ["postgresql://db.example/readwise", "postgres://db.example/readwise"]) {
    setRequiredEnv();
    process.env.DATABASE_URL = databaseUrl;

    const report = validateRuntimeConfig();

    assert.equal(report.ready, true);
    assert.equal(report.required.database.status, "ok");
    assert.equal(report.errors.some((err) => err.code === "invalid_database_url"), false);
  }
});

test("partial optional providers degrade without blocking readiness", () => {
  setRequiredEnv();
  process.env.AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com";
  process.env.VAPID_PUBLIC_KEY = "public-key";
  process.env.VAPID_SUBJECT = "mailto:admin@example.com";

  const report = validateRuntimeConfig();

  assert.equal(report.ready, true);
  assert.equal(report.optional.ai.status, "degraded");
  assert.equal(report.optional.push.status, "degraded");
  assert.ok(report.warnings.some((warn) => warn.code === "partial_optional_provider"));
});

test("malformed VAPID subject degrades and disables push config", () => {
  setRequiredEnv();
  process.env.VAPID_PUBLIC_KEY = "public-key";
  process.env.VAPID_PRIVATE_KEY = "private-key";
  process.env.VAPID_SUBJECT = "not-a-contact";

  const report = validateRuntimeConfig();

  assert.equal(report.ready, true);
  assert.equal(report.optional.push.status, "degraded");
  assert.equal(pushConfig.get(), null);
  assert.equal(pushConfig.isConfigured(), false);
  assert.ok(report.warnings.some((warn) => warn.code === "invalid_vapid_subject"));
});

test("malformed required values block readiness", () => {
  process.env.DATABASE_URL = "mysql://db.example/readwise";
  process.env.NEXTAUTH_SECRET = "replace-with-a-random-secret";
  process.env.NEXTAUTH_URL = "not-a-url";

  const report = validateRuntimeConfig();

  assert.equal(report.ready, false);
  assert.equal(report.required.database.status, "malformed");
  assert.equal(report.required.auth.status, "malformed");
  assert.ok(report.errors.some((err) => err.code === "invalid_database_url"));
  assert.ok(report.errors.some((err) => err.code === "placeholder_secret"));
  assert.ok(report.errors.some((err) => err.code === "weak_secret"));
  assert.ok(report.errors.some((err) => err.code === "invalid_url"));
});

test("malformed optional and tuning values warn but do not block readiness", () => {
  setRequiredEnv();
  process.env.AZURE_OPENAI_ENDPOINT = "ftp://example.invalid";
  process.env.AZURE_OPENAI_API_KEY = "key";
  process.env.AZURE_OPENAI_DEPLOYMENT = "deployment";
  process.env.AZURE_OPENAI_API_VERSION = "bad-version";
  process.env.AZURE_SPEECH_KEY = "speech-key";
  process.env.AZURE_SPEECH_REGION = "eastus";
  process.env.AZURE_SPEECH_OUTPUT_FORMAT = "wav";
  process.env.LOG_LEVEL = "verbose";
  process.env.RATE_LIMIT_WINDOW_MS = "-1";

  const report = validateRuntimeConfig();

  assert.equal(report.ready, true);
  assert.equal(report.optional.ai.status, "degraded");
  assert.equal(report.optional.speech.status, "degraded");
  assert.equal(report.tuning.status, "degraded");
  assert.ok(report.warnings.some((warn) => warn.code === "invalid_api_version"));
  assert.ok(report.warnings.some((warn) => warn.code === "unsupported_speech_format"));
  assert.ok(report.warnings.some((warn) => warn.code === "invalid_log_level"));
  assert.ok(report.warnings.some((warn) => warn.code === "invalid_positive_integer"));
});
