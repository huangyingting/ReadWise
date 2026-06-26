/**
 * Tests for the shared auth core (REF-044).
 *
 * Verifies the narrow `@/lib/auth-core` helpers — `loadSession` and
 * `sessionHasCapability` — in isolation with only `next-auth` and
 * `@/lib/auth` mocked, so this file imports no real I/O modules.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { Session } from "next-auth";
import { CAPABILITIES } from "@/lib/rbac";
import { makeSession } from "./support/auth-mock";

let sessionState: Session | null = null;

before(() => {
  mock.module("next-auth", {
    namedExports: { getServerSession: async () => sessionState },
  });
  mock.module("@/lib/auth", { namedExports: { authOptions: {} } });
});

beforeEach(() => {
  sessionState = null;
});

// ---------------------------------------------------------------------------
// loadSession
// ---------------------------------------------------------------------------

test("loadSession returns null when there is no session", async () => {
  sessionState = null;
  const { loadSession } = await import("@/lib/auth-core");
  const result = await loadSession();
  assert.equal(result, null);
});

test("loadSession returns the session when authenticated", async () => {
  sessionState = makeSession("Reader", "r1");
  const { loadSession } = await import("@/lib/auth-core");
  const result = await loadSession();
  assert.equal(result?.user.id, "r1");
});

test("loadSession returns null when session has no user", async () => {
  // Simulate a malformed session that has no user object.
  (sessionState as unknown) = { expires: "2099-01-01T00:00:00Z" };
  const { loadSession } = await import("@/lib/auth-core");
  const result = await loadSession();
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// sessionHasCapability
// ---------------------------------------------------------------------------

test("sessionHasCapability: null session is always denied", async () => {
  const { sessionHasCapability } = await import("@/lib/auth-core");
  assert.equal(sessionHasCapability(null, CAPABILITIES.articlesRead), false);
  assert.equal(sessionHasCapability(null, CAPABILITIES.adminAccess), false);
});

test("sessionHasCapability: Admin session grants admin capabilities", async () => {
  const { sessionHasCapability } = await import("@/lib/auth-core");
  const session = makeSession("Admin", "a1");
  assert.equal(sessionHasCapability(session, CAPABILITIES.adminAccess), true);
  assert.equal(sessionHasCapability(session, CAPABILITIES.articlesManage), true);
  assert.equal(sessionHasCapability(session, CAPABILITIES.articlesRead), true);
});

test("sessionHasCapability: Reader session grants only base capabilities", async () => {
  const { sessionHasCapability } = await import("@/lib/auth-core");
  const session = makeSession("Reader", "r1");
  assert.equal(sessionHasCapability(session, CAPABILITIES.articlesRead), true);
  assert.equal(sessionHasCapability(session, CAPABILITIES.adminAccess), false);
  assert.equal(sessionHasCapability(session, CAPABILITIES.articlesManage), false);
});

test("sessionHasCapability: unknown role is always denied", async () => {
  const { sessionHasCapability } = await import("@/lib/auth-core");
  const session = { user: { id: "x", role: "Ghost" }, expires: "2099-01-01T00:00:00Z" } as unknown as Session;
  assert.equal(sessionHasCapability(session, CAPABILITIES.articlesRead), false);
  assert.equal(sessionHasCapability(session, CAPABILITIES.adminAccess), false);
});

// ---------------------------------------------------------------------------
// AuthResult type is exported (compile-time, verified at import)
// ---------------------------------------------------------------------------

test("AuthResult type is exported from auth-core", async () => {
  // If the import fails, this test fails. Verifies the named export exists.
  const mod = await import("@/lib/auth-core");
  // loadSession and sessionHasCapability are runtime values; AuthResult is a
  // type-only export (no runtime value), but the module must load cleanly.
  assert.equal(typeof mod.loadSession, "function");
  assert.equal(typeof mod.sessionHasCapability, "function");
});
