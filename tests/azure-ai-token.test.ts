/**
 * Cached Azure AI Services access tokens: credential construction per
 * identity, reuse across calls, rebuild on identity change, and no caching
 * of a failed construction. The Entra credential layer is mocked.
 */
import assert from "node:assert/strict";
import { afterEach, before, beforeEach, mock, test } from "node:test";

const created: Array<Record<string, unknown>> = [];
let failNextCreate = false;

before(() => {
  mock.module("@/lib/azure/entra-auth", {
    namedExports: {
      createEntraTokenProvider: async (options: Record<string, unknown>) => {
        if (failNextCreate) {
          failNextCreate = false;
          throw new Error("credential setup failed");
        }
        created.push(options);
        const label = `${options.mode}:${String(options.clientId ?? "")}`;
        return async () => `token-for-${label}`;
      },
    },
  });
});

const KEYS = ["AZURE_AI_TENANT_ID", "AZURE_AI_CLIENT_ID", "AZURE_AI_CLIENT_SECRET", "AZURE_AI_USE_MANAGED_IDENTITY"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  created.length = 0;
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test("throws when no identity is configured", async () => {
  const { getAiServicesAccessToken } = await import("@/lib/azure/ai-token");
  await assert.rejects(getAiServicesAccessToken, /identity is not configured/);
});

test("reuses one credential per identity and rebuilds when it changes", async () => {
  const { getAiServicesAccessToken } = await import("@/lib/azure/ai-token");
  process.env.AZURE_AI_TENANT_ID = "tenant-1";
  process.env.AZURE_AI_CLIENT_ID = "client-1";
  process.env.AZURE_AI_CLIENT_SECRET = "s3cret";

  assert.equal(await getAiServicesAccessToken(), "token-for-secret:client-1");
  assert.equal(await getAiServicesAccessToken(), "token-for-secret:client-1");
  assert.equal(created.length, 1);

  delete process.env.AZURE_AI_CLIENT_SECRET;
  delete process.env.AZURE_AI_CLIENT_ID;
  process.env.AZURE_AI_USE_MANAGED_IDENTITY = "true";
  assert.equal(await getAiServicesAccessToken(), "token-for-managed-identity:");
  process.env.AZURE_AI_CLIENT_ID = "mi-1";
  assert.equal(await getAiServicesAccessToken(), "token-for-managed-identity:mi-1");
  assert.equal(created.length, 3);
});

test("does not cache a failed credential construction", async () => {
  const { getAiServicesAccessToken } = await import("@/lib/azure/ai-token");
  process.env.AZURE_AI_TENANT_ID = "tenant-2";
  process.env.AZURE_AI_CLIENT_ID = "client-2";
  process.env.AZURE_AI_CLIENT_SECRET = "s3cret";
  failNextCreate = true;
  await assert.rejects(getAiServicesAccessToken, /credential setup failed/);
  assert.equal(await getAiServicesAccessToken(), "token-for-secret:client-2");
});
