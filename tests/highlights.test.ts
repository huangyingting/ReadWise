/**
 * Tests for M11 — Highlights & Notes data layer.
 * @/lib/prisma and @/lib/api-auth are mocked — no real DB.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";

type RouteHandler = (req: Request, ctx?: unknown) => Promise<Response>;

// ---------------------------------------------------------------------------
// Mutable auth / stub state
// ---------------------------------------------------------------------------
let authState: "ok" | "unauth" = "ok";
const session = { user: { id: "user-1", role: "Reader", name: "T", email: "t@e.com" } };

// Prisma stubs
let stubArticle: unknown = { id: "art-1" };
let stubHighlights: unknown[] = [];
let stubCreated: unknown = null;
let stubFindFirst: unknown = null; // for ownership checks
let stubUpdated: unknown = null;

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: {
      requireSessionApi: async () =>
        authState === "unauth"
          ? { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
          : { session },
      requireAdminApi: async () => ({ session }),
    },
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findUnique: async () => stubArticle,
        },
        highlight: {
          findMany: async () => stubHighlights,
          create: async () => stubCreated,
          findFirst: async () => stubFindFirst,
          update: async () => stubUpdated,
          delete: async () => ({}),
          groupBy: async () => [],
        },
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  stubArticle = { id: "art-1" };
  stubHighlights = [];
  stubCreated = null;
  stubFindFirst = null;
  stubUpdated = null;
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

const validAnchor = {
  quote: "the quick brown fox",
  startOffset: 10,
  endOffset: 29,
  prefix: "Before: ",
  suffix: " jumps",
};

// ---------------------------------------------------------------------------
// lib/highlights — unit tests
// ---------------------------------------------------------------------------

test("validateAnchor rejects empty quote", async () => {
  const { validateAnchor } = await import("@/lib/highlights");
  const r = validateAnchor({ quote: "  ", startOffset: 0, endOffset: 5 });
  assert.equal(r.ok, false);
});

test("validateAnchor rejects startOffset >= endOffset", async () => {
  const { validateAnchor } = await import("@/lib/highlights");
  const r = validateAnchor({ quote: "hello", startOffset: 10, endOffset: 10 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /startOffset/);
});

test("validateAnchor rejects negative startOffset", async () => {
  const { validateAnchor } = await import("@/lib/highlights");
  const r = validateAnchor({ quote: "hello", startOffset: -1, endOffset: 5 });
  assert.equal(r.ok, false);
});

test("validateAnchor rejects invalid color", async () => {
  const { validateAnchor } = await import("@/lib/highlights");
  const r = validateAnchor({ quote: "hello", startOffset: 0, endOffset: 5, color: "purple" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /color/);
});

test("validateAnchor accepts valid anchor without optional fields", async () => {
  const { validateAnchor } = await import("@/lib/highlights");
  const r = validateAnchor({ quote: "hello", startOffset: 0, endOffset: 5 });
  assert.equal(r.ok, true);
});

test("validateAnchor accepts valid anchor with color", async () => {
  const { validateAnchor } = await import("@/lib/highlights");
  const r = validateAnchor({ quote: "hello", startOffset: 0, endOffset: 5, color: "yellow" });
  assert.equal(r.ok, true);
});

test("createHighlight returns 400 for invalid anchor", async () => {
  const { createHighlight } = await import("@/lib/highlights");
  const result = await createHighlight("user-1", "art-1", {
    quote: "",
    startOffset: 0,
    endOffset: 5,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 400);
});

test("createHighlight delegates to prisma.highlight.create on valid input", async () => {
  const expectedRow = {
    id: "h-1",
    ...validAnchor,
    note: null,
    color: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  stubCreated = expectedRow;
  const { createHighlight } = await import("@/lib/highlights");
  const result = await createHighlight("user-1", "art-1", validAnchor);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.highlight.id, "h-1");
});

test("updateHighlight returns 404 when not owner", async () => {
  stubFindFirst = null; // ownership check fails
  const { updateHighlight } = await import("@/lib/highlights");
  const result = await updateHighlight("h-99", "user-1", { note: "My note" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 404);
});

test("updateHighlight returns 400 for invalid color", async () => {
  stubFindFirst = { id: "h-1" };
  const { updateHighlight } = await import("@/lib/highlights");
  const result = await updateHighlight("h-1", "user-1", { color: "rainbow" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 400);
});

test("updateHighlight succeeds for owner with valid note", async () => {
  stubFindFirst = { id: "h-1" };
  stubUpdated = {
    id: "h-1",
    ...validAnchor,
    note: "My note",
    color: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const { updateHighlight } = await import("@/lib/highlights");
  const result = await updateHighlight("h-1", "user-1", { note: "My note" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.highlight.note, "My note");
});

test("deleteHighlight returns 404 when not owner", async () => {
  stubFindFirst = null;
  const { deleteHighlight } = await import("@/lib/highlights");
  const result = await deleteHighlight("h-99", "user-1");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 404);
});

test("deleteHighlight succeeds for owner", async () => {
  stubFindFirst = { id: "h-1" };
  const { deleteHighlight } = await import("@/lib/highlights");
  const result = await deleteHighlight("h-1", "user-1");
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// GET /api/reader/[id]/highlights
// ---------------------------------------------------------------------------

test("GET /api/reader/[id]/highlights returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { GET } = (await import(
    "@/app/api/reader/[id]/highlights/route"
  )) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api"), ctx({ id: "art-1" }));
  assert.equal(res.status, 401);
});

test("GET /api/reader/[id]/highlights returns 404 for missing article", async () => {
  stubArticle = null;
  const { GET } = (await import(
    "@/app/api/reader/[id]/highlights/route"
  )) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api"), ctx({ id: "bad-id" }));
  assert.equal(res.status, 404);
});

test("GET /api/reader/[id]/highlights returns highlights array for the user", async () => {
  stubHighlights = [
    { id: "h-1", quote: "hello", startOffset: 0, endOffset: 5, prefix: "", suffix: "",
      note: null, color: "yellow", createdAt: new Date(), updatedAt: new Date() },
  ];
  const { GET } = (await import(
    "@/app/api/reader/[id]/highlights/route"
  )) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api"), ctx({ id: "art-1" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.highlights.length, 1);
  assert.equal(body.highlights[0].id, "h-1");
});

// ---------------------------------------------------------------------------
// POST /api/reader/[id]/highlights
// ---------------------------------------------------------------------------

test("POST /api/reader/[id]/highlights returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { POST } = (await import(
    "@/app/api/reader/[id]/highlights/route"
  )) as { POST: RouteHandler };
  const res = await POST(jsonReq(validAnchor), ctx({ id: "art-1" }));
  assert.equal(res.status, 401);
});

test("POST /api/reader/[id]/highlights returns 404 for missing article", async () => {
  stubArticle = null;
  const { POST } = (await import(
    "@/app/api/reader/[id]/highlights/route"
  )) as { POST: RouteHandler };
  const res = await POST(jsonReq(validAnchor), ctx({ id: "bad-id" }));
  assert.equal(res.status, 404);
});

test("POST /api/reader/[id]/highlights returns 400 for invalid anchor (startOffset >= endOffset)", async () => {
  stubCreated = { id: "h-1", ...validAnchor, note: null, color: null,
    createdAt: new Date(), updatedAt: new Date() };
  const { POST } = (await import(
    "@/app/api/reader/[id]/highlights/route"
  )) as { POST: RouteHandler };
  const bad = { ...validAnchor, startOffset: 20, endOffset: 10 };
  const res = await POST(jsonReq(bad), ctx({ id: "art-1" }));
  assert.equal(res.status, 400);
});

test("POST /api/reader/[id]/highlights creates highlight with valid anchor", async () => {
  stubCreated = {
    id: "h-new",
    quote: validAnchor.quote,
    startOffset: validAnchor.startOffset,
    endOffset: validAnchor.endOffset,
    prefix: validAnchor.prefix,
    suffix: validAnchor.suffix,
    note: null,
    color: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const { POST } = (await import(
    "@/app/api/reader/[id]/highlights/route"
  )) as { POST: RouteHandler };
  const res = await POST(jsonReq(validAnchor), ctx({ id: "art-1" }));
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.highlight.id, "h-new");
  assert.equal(body.highlight.quote, validAnchor.quote);
});

test("POST /api/reader/[id]/highlights creates highlight with note and color", async () => {
  const payload = { ...validAnchor, note: "interesting!", color: "yellow" };
  stubCreated = {
    id: "h-new2",
    ...payload,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const { POST } = (await import(
    "@/app/api/reader/[id]/highlights/route"
  )) as { POST: RouteHandler };
  const res = await POST(jsonReq(payload), ctx({ id: "art-1" }));
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.highlight.note, "interesting!");
  assert.equal(body.highlight.color, "yellow");
});

// ---------------------------------------------------------------------------
// PATCH /api/highlights/[id]
// ---------------------------------------------------------------------------

test("PATCH /api/highlights/[id] returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { PATCH } = (await import(
    "@/app/api/highlights/[id]/route"
  )) as { PATCH: RouteHandler };
  const res = await PATCH(jsonReq({ note: "hi" }, "PATCH"), ctx({ id: "h-1" }));
  assert.equal(res.status, 401);
});

test("PATCH /api/highlights/[id] returns 404 when not the owner", async () => {
  stubFindFirst = null;
  const { PATCH } = (await import(
    "@/app/api/highlights/[id]/route"
  )) as { PATCH: RouteHandler };
  const res = await PATCH(jsonReq({ note: "hi" }, "PATCH"), ctx({ id: "h-99" }));
  assert.equal(res.status, 404);
});

test("PATCH /api/highlights/[id] updates note for the owner", async () => {
  stubFindFirst = { id: "h-1" };
  stubUpdated = {
    id: "h-1",
    ...validAnchor,
    note: "updated note",
    color: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const { PATCH } = (await import(
    "@/app/api/highlights/[id]/route"
  )) as { PATCH: RouteHandler };
  const res = await PATCH(jsonReq({ note: "updated note" }, "PATCH"), ctx({ id: "h-1" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.highlight.note, "updated note");
});

test("PATCH /api/highlights/[id] returns 400 for invalid color", async () => {
  stubFindFirst = { id: "h-1" };
  const { PATCH } = (await import(
    "@/app/api/highlights/[id]/route"
  )) as { PATCH: RouteHandler };
  const res = await PATCH(jsonReq({ color: "invisible" }, "PATCH"), ctx({ id: "h-1" }));
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// DELETE /api/highlights/[id]
// ---------------------------------------------------------------------------

test("DELETE /api/highlights/[id] returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { DELETE } = (await import(
    "@/app/api/highlights/[id]/route"
  )) as { DELETE: RouteHandler };
  const res = await DELETE(
    new Request("http://test/api", { method: "DELETE" }),
    ctx({ id: "h-1" }),
  );
  assert.equal(res.status, 401);
});

test("DELETE /api/highlights/[id] returns 404 when not the owner", async () => {
  stubFindFirst = null;
  const { DELETE } = (await import(
    "@/app/api/highlights/[id]/route"
  )) as { DELETE: RouteHandler };
  const res = await DELETE(
    new Request("http://test/api", { method: "DELETE" }),
    ctx({ id: "h-99" }),
  );
  assert.equal(res.status, 404);
});

test("DELETE /api/highlights/[id] removes the highlight and returns ok", async () => {
  stubFindFirst = { id: "h-1" };
  const { DELETE } = (await import(
    "@/app/api/highlights/[id]/route"
  )) as { DELETE: RouteHandler };
  const res = await DELETE(
    new Request("http://test/api", { method: "DELETE" }),
    ctx({ id: "h-1" }),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
});
