process.env.LOG_LEVEL = "error"; // silence request.start/complete logs
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";

type RouteHandler = (req: Request, ctx?: unknown) => Promise<Response>;

// ---- mutable auth state --------------------------------------------------
let authState: "ok" | "unauth" = "ok";
const session = { user: { id: "user-1", role: "Reader", name: "T", email: "t@e.com" } };

// ---- mutable lib return values -------------------------------------------
let searchResult: { articles: unknown[]; hasMore: boolean } = {
  articles: [],
  hasMore: false,
};
let progressSummaries: Record<string, { percent: number; completed: boolean }> = {};

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

  mock.module("@/lib/search/query", {
    namedExports: {
      SEARCH_PAGE_SIZE: 20,
      SEARCH_MAX_LIMIT: 50,
    },
  });
  mock.module("@/lib/search/providers", {
    namedExports: {
      searchReadableArticles: async () => searchResult,
    },
  });

  mock.module("@/lib/article-library", {
    namedExports: {
      toListingArticle: (a: unknown) => a,
    },
  });

  mock.module("@/lib/progress", {
    namedExports: {
      getProgressSummaries: async () => progressSummaries,
    },
  });
});

beforeEach(() => {
  authState = "ok";
  searchResult = { articles: [], hasMore: false };
  progressSummaries = {};
});

// ---- helpers -------------------------------------------------------------
function searchReq(q: string, extra = "") {
  return new Request(`http://test/api/search?q=${encodeURIComponent(q)}${extra}`);
}

// ---- blank / empty query -------------------------------------------------
test("GET search returns empty results for a blank query", async () => {
  const { GET } = (await import("@/app/api/search/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/search?q="), undefined);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.articles, []);
  assert.equal(body.hasMore, false);
  assert.equal(body.offset, 0);
});

test("GET search returns empty results when q is absent", async () => {
  const { GET } = (await import("@/app/api/search/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/search"), undefined);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.articles, []);
  assert.equal(body.hasMore, false);
});

// ---- matching query -------------------------------------------------------
test("GET search returns articles and progress for a matching query", async () => {
  searchResult = {
    articles: [{ id: "a1", title: "Climate Change" }],
    hasMore: false,
  };
  progressSummaries = { a1: { percent: 40, completed: false } };

  const { GET } = (await import("@/app/api/search/route")) as { GET: RouteHandler };
  const res = await GET(searchReq("climate"), undefined);
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.articles.length, 1);
  assert.equal((body.articles[0] as { id: string }).id, "a1");
  assert.deepEqual(body.progress, { a1: { percent: 40, completed: false } });
  assert.equal(body.hasMore, false);
  assert.equal(body.offset, 1);
});

// ---- hasMore pagination ---------------------------------------------------
test("GET search reflects hasMore and advances offset", async () => {
  searchResult = {
    articles: [{ id: "a1" }, { id: "a2" }],
    hasMore: true,
  };

  const { GET } = (await import("@/app/api/search/route")) as { GET: RouteHandler };
  const res = await GET(searchReq("news"), undefined);
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.hasMore, true);
  assert.equal(body.articles.length, 2);
  assert.equal(body.offset, 2); // 0 initial offset + 2 articles returned
});

test("GET search advances offset when a non-zero offset is provided", async () => {
  searchResult = { articles: [{ id: "a3" }], hasMore: false };

  const { GET } = (await import("@/app/api/search/route")) as { GET: RouteHandler };
  const res = await GET(searchReq("news", "&offset=2"), undefined);
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.offset, 3); // 2 + 1 article
});

test("GET search never returns an empty page with hasMore true", async () => {
  searchResult = { articles: [], hasMore: true };

  const { GET } = (await import("@/app/api/search/route")) as { GET: RouteHandler };
  const res = await GET(searchReq("news", "&offset=500"), undefined);
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.deepEqual(body.articles, []);
  assert.equal(body.hasMore, false);
  assert.equal(body.offset, 500);
});

// ---- auth -----------------------------------------------------------------
test("GET search returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { GET } = (await import("@/app/api/search/route")) as { GET: RouteHandler };
  const res = await GET(searchReq("test"), undefined);
  assert.equal(res.status, 401);
});

test("GET search includes x-request-id response header", async () => {
  const { GET } = (await import("@/app/api/search/route")) as { GET: RouteHandler };
  const res = await GET(searchReq("hello"), undefined);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("x-request-id")?.length ?? 0 > 0, "missing x-request-id header");
});
