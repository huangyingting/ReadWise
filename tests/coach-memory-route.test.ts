/**
 * Tests for DELETE /api/coach-memory (#810).
 *
 * Verifies the user-scoped hard-delete contract: authenticated users get a 204
 * and the delete is scoped to their own id; unauthenticated requests get 401.
 * The SkillMastery-untouched guarantee is covered in coach-memory.test.ts.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler, withParams, deleteReq } from "./support/route";
import { type AuthState, sessionAuthExports } from "./support/auth-mock";

let authState: AuthState = "ok";
let deletedFor: string | null = null;

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: sessionAuthExports(() => authState),
  });
  mock.module("@/lib/learning/coach-memory", {
    namedExports: {
      deleteCoachMemory: async (userId: string) => {
        deletedFor = userId;
        return 3;
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  deletedFor = null;
});

test("DELETE /api/coach-memory hard-deletes the caller's rows and returns 204", async () => {
  const { DELETE } = (await import("@/app/api/coach-memory/route")) as {
    DELETE: RouteHandler;
  };
  const res = await DELETE(deleteReq("http://test/api/coach-memory"), withParams({}));
  assert.equal(res.status, 204);
  // Scoped to the authenticated reader (readerSession.user.id).
  assert.equal(deletedFor, "user-1");
});

test("DELETE /api/coach-memory returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { DELETE } = (await import("@/app/api/coach-memory/route")) as {
    DELETE: RouteHandler;
  };
  const res = await DELETE(deleteReq("http://test/api/coach-memory"), withParams({}));
  assert.equal(res.status, 401);
  assert.equal(deletedFor, null, "no deletion when unauthenticated");
});
