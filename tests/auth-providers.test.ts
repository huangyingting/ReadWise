/**
 * Regression test for BUG #387 — CLI scripts crash: "GoogleProvider is not a function".
 *
 * Under Node native ESM (the `node --experimental-strip-types` harness used for CLI
 * scripts), CJS default imports like `next-auth/providers/google` resolve to a namespace
 * object `{ default: fn }` rather than the function directly. The fix in `src/lib/auth.ts`
 * applies an interop pattern so both runtimes get the callable function.
 *
 * This test runs under the same native-ESM harness and verifies that:
 *  1. `authOptions.providers` is a non-empty array when credentials are present.
 *  2. No TypeError is thrown during module evaluation (providers are callable).
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

before(() => {
  // Stub the Prisma singleton — auth.ts imports it at module level.
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

test("authOptions.providers is non-empty when Google credentials are set", async () => {
  // Supply dummy credentials so the conditional blocks in buildProviders() activate.
  process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
  delete process.env.AZURE_AD_CLIENT_ID;

  // Dynamic import AFTER mocks are set up and creds are in env.
  const { authOptions } = await import("@/lib/auth");

  assert.ok(Array.isArray(authOptions.providers), "providers must be an array");
  assert.ok(
    authOptions.providers.length >= 1,
    `Expected at least 1 provider but got ${authOptions.providers.length} — GoogleProvider was likely not called as a function`,
  );

  // Clean up env.
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});
