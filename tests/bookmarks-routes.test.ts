/**
 * Route tests for the M10 bookmarks & reading lists API endpoints.
 * @/lib/bookmarks and @/lib/api-auth are mocked — no real DB or network.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

// ---------------------------------------------------------------------------
// Mutable auth + stub state
// ---------------------------------------------------------------------------
let authState: AuthState = "ok";

let stubGetUserLists: unknown = [{ id: "list-1", name: "Saved", isDefault: true, count: 3 }];
let stubCreateList: unknown = { id: "list-2", name: "My List", isDefault: false };
let stubRenameList: unknown = { ok: true, list: { id: "list-1", name: "Renamed" } };
let stubDeleteList: unknown = { ok: true };
let stubAddToList: unknown = { ok: true };
let stubRemoveFromList: unknown = { ok: true };
let stubToggleBookmark: unknown = { ok: true, bookmarked: true };

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: fullAuthExports(() => authState),
  });

  mock.module("@/lib/article-library", {
    namedExports: {
      getUserLists: async () => stubGetUserLists,
      createList: async () => stubCreateList,
      renameList: async () => stubRenameList,
      deleteList: async () => stubDeleteList,
      addToList: async () => stubAddToList,
      removeFromList: async () => stubRemoveFromList,
      toggleBookmark: async () => stubToggleBookmark,
      getOrCreateDefaultList: async () => ({ id: "list-1", name: "Saved", isDefault: true }),
      getListWithArticles: async () => null,
      getBookmarkedArticleIds: async () => new Set<string>(),
    },
  });
});

beforeEach(() => {
  authState = "ok";
  stubGetUserLists = [{ id: "list-1", name: "Saved", isDefault: true, count: 3 }];
  stubCreateList = { id: "list-2", name: "My List", isDefault: false };
  stubRenameList = { ok: true, list: { id: "list-1", name: "Renamed" } };
  stubDeleteList = { ok: true };
  stubAddToList = { ok: true };
  stubRemoveFromList = { ok: true };
  stubToggleBookmark = { ok: true, bookmarked: true };
});

function jsonReq(body: unknown, method = "POST"): Request {
  return new Request("http://test/api/route", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx(params: Record<string, string>) {
  return { params: Promise.resolve(params) };
}

// ---------------------------------------------------------------------------
// GET /api/lists
// ---------------------------------------------------------------------------

test("GET /api/lists returns lists for authenticated user", async () => {
  const { GET } = (await import("@/app/api/lists/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/lists"), undefined);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.lists.length, 1);
  assert.equal(body.lists[0].name, "Saved");
});

test("GET /api/lists returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { GET } = (await import("@/app/api/lists/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/lists"), undefined);
  assert.equal(res.status, 401);
});

// ---------------------------------------------------------------------------
// POST /api/lists
// ---------------------------------------------------------------------------

test("POST /api/lists creates a new list and returns 201", async () => {
  const { POST } = (await import("@/app/api/lists/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({ name: "My List" }), undefined);
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.list.name, "My List");
});

test("POST /api/lists returns 400 when name is missing", async () => {
  const { POST } = (await import("@/app/api/lists/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({}), undefined);
  assert.equal(res.status, 400);
});

test("POST /api/lists returns 400 when name is empty string", async () => {
  const { POST } = (await import("@/app/api/lists/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({ name: "" }), undefined);
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// PATCH /api/lists/[id]
// ---------------------------------------------------------------------------

test("PATCH /api/lists/[id] renames the list and returns the updated name", async () => {
  const { PATCH } = (await import("@/app/api/lists/[id]/route")) as { PATCH: RouteHandler };
  const res = await PATCH(jsonReq({ name: "Renamed" }, "PATCH"), ctx({ id: "list-1" }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).list.name, "Renamed");
});

test("PATCH /api/lists/[id] returns 404 when list not found or not owned", async () => {
  stubRenameList = { ok: false, error: "List not found", status: 404 };
  const { PATCH } = (await import("@/app/api/lists/[id]/route")) as { PATCH: RouteHandler };
  const res = await PATCH(jsonReq({ name: "New" }, "PATCH"), ctx({ id: "other-list" }));
  assert.equal(res.status, 404);
});

test("PATCH /api/lists/[id] returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { PATCH } = (await import("@/app/api/lists/[id]/route")) as { PATCH: RouteHandler };
  const res = await PATCH(jsonReq({ name: "X" }, "PATCH"), ctx({ id: "list-1" }));
  assert.equal(res.status, 401);
});

// ---------------------------------------------------------------------------
// DELETE /api/lists/[id]
// ---------------------------------------------------------------------------

test("DELETE /api/lists/[id] deletes a non-default list and returns ok", async () => {
  const { DELETE } = (await import("@/app/api/lists/[id]/route")) as { DELETE: RouteHandler };
  const res = await DELETE(new Request("http://test/x", { method: "DELETE" }), ctx({ id: "list-2" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test("DELETE /api/lists/[id] returns 409 when trying to delete the default list", async () => {
  stubDeleteList = { ok: false, error: "Cannot delete the default list", status: 409 };
  const { DELETE } = (await import("@/app/api/lists/[id]/route")) as { DELETE: RouteHandler };
  const res = await DELETE(new Request("http://test/x", { method: "DELETE" }), ctx({ id: "list-1" }));
  assert.equal(res.status, 409);
});

test("DELETE /api/lists/[id] returns 404 when list not found", async () => {
  stubDeleteList = { ok: false, error: "List not found", status: 404 };
  const { DELETE } = (await import("@/app/api/lists/[id]/route")) as { DELETE: RouteHandler };
  const res = await DELETE(new Request("http://test/x", { method: "DELETE" }), ctx({ id: "gone" }));
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// POST /api/lists/[id]/items
// ---------------------------------------------------------------------------

test("POST /api/lists/[id]/items adds an article to the list", async () => {
  const { POST } = (await import("@/app/api/lists/[id]/items/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({ articleId: "a1" }), ctx({ id: "list-1" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test("POST /api/lists/[id]/items returns 404 when list not found", async () => {
  stubAddToList = { ok: false, error: "List not found", status: 404 };
  const { POST } = (await import("@/app/api/lists/[id]/items/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({ articleId: "a1" }), ctx({ id: "bad-list" }));
  assert.equal(res.status, 404);
});

test("POST /api/lists/[id]/items returns 404 when article not found", async () => {
  stubAddToList = { ok: false, error: "Article not found", status: 404 };
  const { POST } = (await import("@/app/api/lists/[id]/items/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({ articleId: "missing" }), ctx({ id: "list-1" }));
  assert.equal(res.status, 404);
});

test("POST /api/lists/[id]/items returns 400 when articleId is missing", async () => {
  const { POST } = (await import("@/app/api/lists/[id]/items/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({}), ctx({ id: "list-1" }));
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// DELETE /api/lists/[id]/items/[articleId]
// ---------------------------------------------------------------------------

test("DELETE /api/lists/[id]/items/[articleId] removes an article from the list", async () => {
  const { DELETE } = (await import("@/app/api/lists/[id]/items/[articleId]/route")) as { DELETE: RouteHandler };
  const res = await DELETE(
    new Request("http://test/x", { method: "DELETE" }),
    ctx({ id: "list-1", articleId: "a1" }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test("DELETE /api/lists/[id]/items/[articleId] returns 404 when list not owned", async () => {
  stubRemoveFromList = { ok: false, error: "List not found", status: 404 };
  const { DELETE } = (await import("@/app/api/lists/[id]/items/[articleId]/route")) as { DELETE: RouteHandler };
  const res = await DELETE(
    new Request("http://test/x", { method: "DELETE" }),
    ctx({ id: "other-list", articleId: "a1" }),
  );
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// POST /api/bookmarks/toggle
// ---------------------------------------------------------------------------

test("POST /api/bookmarks/toggle returns bookmarked:true when adding", async () => {
  stubToggleBookmark = { ok: true, bookmarked: true };
  const { POST } = (await import("@/app/api/bookmarks/toggle/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({ articleId: "a1" }), undefined);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { bookmarked: true });
});

test("POST /api/bookmarks/toggle returns bookmarked:false when removing", async () => {
  stubToggleBookmark = { ok: true, bookmarked: false };
  const { POST } = (await import("@/app/api/bookmarks/toggle/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({ articleId: "a1" }), undefined);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { bookmarked: false });
});

test("POST /api/bookmarks/toggle returns 404 when article does not exist", async () => {
  stubToggleBookmark = { ok: false, error: "Article not found", status: 404 };
  const { POST } = (await import("@/app/api/bookmarks/toggle/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({ articleId: "missing" }), undefined);
  assert.equal(res.status, 404);
});

test("POST /api/bookmarks/toggle returns 400 when articleId is missing", async () => {
  const { POST } = (await import("@/app/api/bookmarks/toggle/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({}), undefined);
  assert.equal(res.status, 400);
});

test("POST /api/bookmarks/toggle returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { POST } = (await import("@/app/api/bookmarks/toggle/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq({ articleId: "a1" }), undefined);
  assert.equal(res.status, 401);
});
