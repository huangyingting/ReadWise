/**
 * Tests for the auth provider registry (REF-064).
 *
 * Regression test for BUG #387 — CLI scripts crash: "GoogleProvider is not a function".
 *
 * Under Node native ESM (the `node --experimental-strip-types` harness used for CLI
 * scripts), CJS default imports like `next-auth/providers/google` resolve to a namespace
 * object `{ default: fn }` rather than the function directly. The fix in
 * `src/lib/auth-providers.ts` applies an interop pattern so both runtimes get the
 * callable function.
 *
 * Also verifies that `getConfiguredProviders()` returns correct metadata for
 * the sign-in UI, and that `src/lib/auth` still exports `authOptions` with
 * the providers array wired up.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

before(() => {
  // Stub the Prisma singleton — auth.ts and auth-bootstrap.ts import it at module level.
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        user: { count: async () => 0, update: async () => ({}) },
      },
    },
  });

  // Stub PrismaAdapter — auth.ts calls PrismaAdapter(prisma) at module level.
  mock.module("@auth/prisma-adapter", {
    namedExports: {
      PrismaAdapter: () => ({}),
    },
  });
});

test("buildProviders returns non-empty array when Google credentials are set", async () => {
  process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
  delete process.env.AZURE_AD_CLIENT_ID;

  const { buildProviders } = await import("@/lib/auth-providers");
  const providers = buildProviders();

  assert.ok(Array.isArray(providers), "providers must be an array");
  assert.ok(
    providers.length >= 1,
    `Expected at least 1 provider but got ${providers.length} — GoogleProvider was likely not called as a function`,
  );

  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

test("buildProviders returns empty array when no credentials are set", async () => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.AZURE_AD_CLIENT_ID;
  delete process.env.AZURE_AD_CLIENT_SECRET;
  delete process.env.AZURE_AD_TENANT_ID;

  const { buildProviders } = await import("@/lib/auth-providers");
  const providers = buildProviders();

  assert.ok(Array.isArray(providers), "providers must be an array");
  assert.equal(providers.length, 0, "Expected 0 providers when no credentials are set");
});

test("getConfiguredProviders returns metadata for configured providers", async () => {
  process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
  delete process.env.AZURE_AD_CLIENT_ID;

  const { getConfiguredProviders } = await import("@/lib/auth-providers");
  const meta = getConfiguredProviders();

  assert.ok(Array.isArray(meta));
  assert.ok(meta.length >= 1);
  assert.ok(typeof meta[0].id === "string");
  assert.ok(typeof meta[0].name === "string");

  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

test("authOptions.providers is non-empty when Google credentials are set", async () => {
  process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
  delete process.env.AZURE_AD_CLIENT_ID;

  const { authOptions } = await import("@/lib/auth");

  assert.ok(Array.isArray(authOptions.providers), "providers must be an array");
  assert.ok(
    authOptions.providers.length >= 1,
    `Expected at least 1 provider but got ${authOptions.providers.length} — GoogleProvider was likely not called as a function`,
  );

  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});
