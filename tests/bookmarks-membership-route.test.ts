/**
 * Route tests for GET /api/bookmarks/membership.
 *
 * Validates:
 * - Auth required (401 when unauthenticated)
 * - Requires articleId query param (validation error otherwise)
 * - Returns list membership on success
 * - Returns 404 when article not found
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { getReq, readJson, type RouteHandler } from "./support/route";
import { type AuthState, sessionAuthExports } from "./support/auth-mock";

let authState: AuthState = "ok";
let membershipResult: unknown[] | null = [
  { id: "list-1", name: "Favorites", isDefault: true, hasArticle: true },
  { id: "list-2", name: "Read Later", isDefault: false, hasArticle: false },
];

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: sessionAuthExports(() => authState),
  });

  mock.module("@/lib/article-library", {
    namedExports: {
      getArticleListMembership: async () => membershipResult,
    },
  });

  mock.module("@/lib/article-library/collections/schemas", {
    namedExports: {
      parseMembershipQuery: (params: URLSearchParams) => {
        const articleId = params.get("articleId");
        if (!articleId) return { ok: false, error: "articleId is required" };
        return { ok: true, value: { articleId } };
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  membershipResult = [
    { id: "list-1", name: "Favorites", isDefault: true, hasArticle: true },
    { id: "list-2", name: "Read Later", isDefault: false, hasArticle: false },
  ];
});

let GET: RouteHandler;
before(async () => {
  const mod = await import("@/app/api/bookmarks/membership/route");
  GET = mod.GET as unknown as RouteHandler;
});

test("GET /api/bookmarks/membership returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await GET(getReq("http://test/api/bookmarks/membership?articleId=a1"));
  assert.equal(res.status, 401);
});

test("GET /api/bookmarks/membership returns validation error without articleId", async () => {
  const res = await GET(getReq("http://test/api/bookmarks/membership"));
  assert.equal(res.status, 400);
});

test("GET /api/bookmarks/membership returns lists for valid request", async () => {
  const res = await GET(getReq("http://test/api/bookmarks/membership?articleId=a1"));
  assert.equal(res.status, 200);
  const body = await readJson<{ lists: unknown[] }>(res);
  assert.ok(Array.isArray(body.lists));
  assert.equal(body.lists.length, 2);
});

test("GET /api/bookmarks/membership returns 404 when article not found", async () => {
  membershipResult = null;
  const res = await GET(getReq("http://test/api/bookmarks/membership?articleId=missing"));
  assert.equal(res.status, 404);
});
