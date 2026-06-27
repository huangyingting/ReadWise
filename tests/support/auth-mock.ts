/**
 * API-auth mock helpers (REF-033).
 *
 * Returns `namedExports` objects suitable for `mock.module("@/lib/api-auth", ...)`
 * that honour a mutable `authState` variable supplied by the test file.
 *
 * The named-export shape matches the namespace-import pattern
 * used by `src/lib/api-handler.ts` (`import * as apiAuth from "@/lib/api-auth"`),
 * so partial mocks work correctly with --experimental-test-module-mocks.
 *
 * Usage:
 *   let authState: AuthState = "ok";
 *   before(() => {
 *     mock.module("@/lib/api-auth", {
 *       namedExports: sessionAuthExports(() => authState, readerSession),
 *     });
 *   });
 */

import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { readerSession, adminSession } from "./route";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The three common auth states exercised by route tests. */
export type AuthState = "ok" | "unauth" | "forbidden";

type SessionShape = { user: { id: string; role: string; name: string; email: string | null } };

// ---------------------------------------------------------------------------
// Shared session fixture
// ---------------------------------------------------------------------------

/**
 * Build a minimal next-auth Session for unit tests.
 * Shared between auth-core.test.ts and rbac.test.ts to eliminate verbatim copies.
 */
export function makeSession(role: "Admin" | "Reader", id = "u1"): Session {
  return {
    user: { id, role, name: null, email: null },
    expires: "2099-01-01T00:00:00Z",
  };
}

// ---------------------------------------------------------------------------
// Named-export builders
// ---------------------------------------------------------------------------

/**
 * Build `namedExports` for `mock.module("@/lib/api-auth", ...)` that expose
 * only `requireSessionApi`.
 *
 * @param getState  Getter for the current auth state (avoids stale closure).
 * @param session   Session object returned when state is "ok".
 */
export function sessionAuthExports(
  getState: () => AuthState,
  session: SessionShape = readerSession,
): Record<string, unknown> {
  return {
    requireSessionApi: async () => {
      if (getState() === "unauth") {
        return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
      }
      return { session };
    },
  };
}

/**
 * Build `namedExports` for `mock.module("@/lib/api-auth", ...)` that expose
 * both `requireSessionApi` and `requireCapabilityApi`.
 *
 * - "ok"        → returns `{ session }` from both
 * - "unauth"    → both return a 401 error
 * - "forbidden" → `requireCapabilityApi` returns a 403 error; `requireSessionApi`
 *                 still returns `{ session }`. The 403 result includes the
 *                 authenticated reader session, matching the real implementation
 *                 so denied-access audit logs can include actor metadata.
 *
 * @param getState    Getter for the current auth state.
 * @param session     Session returned on authenticated reads (default: readerSession).
 * @param adminSess   Session returned from requireCapabilityApi on "ok" (default: adminSession).
 */
export function fullAuthExports(
  getState: () => AuthState,
  session: SessionShape = readerSession,
  adminSess: SessionShape = adminSession,
): Record<string, unknown> {
  return {
    requireSessionApi: async () => {
      if (getState() === "unauth") {
        return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
      }
      return { session };
    },
    requireCapabilityApi: async () => {
      if (getState() === "unauth") {
        return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
      }
      if (getState() === "forbidden") {
        return {
          session,
          error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
        };
      }
      return { session: adminSess };
    },
  };
}
