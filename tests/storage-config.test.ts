/**
 * Tests for media storage config validation (#373):
 * verifies the storage section of validateRuntimeConfig reports the correct
 * status for database/filesystem/azure modes without leaking secrets.
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { validateRuntimeConfig } from "@/lib/runtime-config/runtime";

const STORAGE_ENV_KEYS = [
  "MEDIA_STORAGE",
  "MEDIA_STORAGE_DIR",
  "AZURE_STORAGE_CONNECTION_STRING",
  "AZURE_STORAGE_ACCOUNT",
  "AZURE_STORAGE_KEY",
  "AZURE_STORAGE_CONTAINER",
] as const;

let savedEnv: Partial<Record<(typeof STORAGE_ENV_KEYS)[number], string | undefined>>;

function setRequiredEnv() {
  process.env.DATABASE_URL = "file:./dev.db";
  process.env.NEXTAUTH_SECRET = "12345678901234567890123456789012";
  process.env.NEXTAUTH_URL = "http://localhost:3000";
}

beforeEach(() => {
  savedEnv = {};
  for (const key of STORAGE_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  setRequiredEnv();
});

afterEach(() => {
  for (const key of STORAGE_ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  delete process.env.DATABASE_URL;
  delete process.env.NEXTAUTH_SECRET;
  delete process.env.NEXTAUTH_URL;
});

test("storage reports unconfigured when MEDIA_STORAGE is unset (database mode)", () => {
  const cfg = validateRuntimeConfig();
  assert.equal(cfg.optional.storage.status, "unconfigured");
  assert.equal(cfg.optional.storage.configured, false);
  // degraded storage must NOT prevent overall ready status
  assert.equal(cfg.ready, true);
});

test("storage reports configured for filesystem mode", () => {
  process.env.MEDIA_STORAGE = "filesystem";
  const cfg = validateRuntimeConfig();
  assert.equal(cfg.optional.storage.status, "configured");
  assert.equal(cfg.optional.storage.configured, true);
});

test("storage reports configured for fs alias", () => {
  process.env.MEDIA_STORAGE = "fs";
  const cfg = validateRuntimeConfig();
  assert.equal(cfg.optional.storage.status, "configured");
});

test("storage reports degraded for azure with no credentials", () => {
  process.env.MEDIA_STORAGE = "azure";
  const cfg = validateRuntimeConfig();
  assert.equal(cfg.optional.storage.status, "degraded");
  assert.equal(cfg.optional.storage.configured, false);
  // degraded storage does NOT mark app as not-ready
  assert.equal(cfg.ready, true);
  // must not include secret values in issues
  const issueJson = JSON.stringify(cfg.optional.storage.issues);
  assert.ok(!issueJson.includes("AccountKey"), "No AccountKey secret in issues");
});

test("storage reports configured for azure with connection string", () => {
  process.env.MEDIA_STORAGE = "azure";
  process.env.AZURE_STORAGE_CONNECTION_STRING =
    "DefaultEndpointsProtocol=https;AccountName=x;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net";
  const cfg = validateRuntimeConfig();
  assert.equal(cfg.optional.storage.status, "configured");
  assert.equal(cfg.optional.storage.configured, true);
  // the connection string (which contains the key) must NOT appear in the report
  const reportJson = JSON.stringify(cfg.optional.storage);
  assert.ok(!reportJson.includes("AccountKey="), "Connection string must not appear in report");
});

test("storage reports configured for azure with account+key", () => {
  process.env.MEDIA_STORAGE = "azure";
  process.env.AZURE_STORAGE_ACCOUNT = "myaccount";
  process.env.AZURE_STORAGE_KEY = "supersecretkey==";
  const cfg = validateRuntimeConfig();
  assert.equal(cfg.optional.storage.status, "configured");
  // key must NOT appear in the report
  const reportJson = JSON.stringify(cfg.optional.storage);
  assert.ok(!reportJson.includes("supersecretkey"), "Storage key must not appear in report");
});

test("storage reports degraded for unknown backend kind", () => {
  process.env.MEDIA_STORAGE = "gcs";
  const cfg = validateRuntimeConfig();
  assert.equal(cfg.optional.storage.status, "degraded");
  assert.equal(cfg.optional.storage.configured, false);
  // degraded does not block readiness
  assert.equal(cfg.ready, true);
});

test("readiness probe includes storage in providers section", () => {
  const cfg = validateRuntimeConfig();
  assert.ok("storage" in cfg.optional, "optional should include storage check");
});
