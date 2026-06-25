/**
 * Tests for the first-user Admin bootstrap (REF-064).
 *
 * Verifies that the first user account is promoted to Admin, and that
 * subsequent users are not promoted.
 */
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

let fakeUserCount = 0;
let lastUpdateArgs: { where?: unknown; data?: unknown } | null = null;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        user: {
          count: async () => fakeUserCount,
          update: async (args: { where?: unknown; data?: unknown }) => {
            lastUpdateArgs = args;
            return {};
          },
        },
      },
    },
  });
});

beforeEach(() => {
  lastUpdateArgs = null;
});

test("bootstrapFirstUser promotes the first user to Admin", async () => {
  fakeUserCount = 1;
  const { bootstrapFirstUser } = await import("@/lib/auth-bootstrap");
  await bootstrapFirstUser("user-001");
  assert.deepEqual(lastUpdateArgs, {
    where: { id: "user-001" },
    data: { role: "Admin" },
  });
});

test("bootstrapFirstUser does not promote subsequent users", async () => {
  fakeUserCount = 2;
  const { bootstrapFirstUser } = await import("@/lib/auth-bootstrap");
  await bootstrapFirstUser("user-002");
  assert.equal(lastUpdateArgs, null, "update should not be called for non-first users");
});

test("bootstrapFirstUser does not promote when count is zero", async () => {
  fakeUserCount = 0;
  const { bootstrapFirstUser } = await import("@/lib/auth-bootstrap");
  await bootstrapFirstUser("user-003");
  assert.equal(lastUpdateArgs, null, "update should not be called when user count is 0");
});
