/**
 * Route tests for POST /api/reader/[id]/difficulty-feedback (#124).
 * Mocks auth, prisma, and articles.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";

type RouteHandler = (req: Request, ctx?: unknown) => Promise<Response>;

// ---- mutable state --------------------------------------------------------

let authState: "ok" | "unauth" = "ok";
const session = { user: { id: "user-1", role: "Reader", name: "T", email: "t@e.com" } };

let articleExists = true;
let lastUpsert: unknown = null;
let feedbackRows: { vote: string }[] = [
  { vote: "too_easy" },
  { vote: "just_right" },
  { vote: "just_right" },
];

// ---- mocks ----------------------------------------------------------------

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
        articleDifficultyFeedback: {
          upsert: async (args: unknown) => {
            lastUpsert = args;
          },
          findMany: async () => feedbackRows,
        },
      },
    },
  });

  mock.module("@/lib/articles", {
    namedExports: {
      getViewableArticleById: async () => (articleExists ? { id: "a1" } : null),
    },
  });

  mock.module("@/lib/cache", {
    namedExports: {
      createCachedListing: (fn: unknown) => fn,
      ARTICLES_CACHE_TAG: "articles",
      TAGS_CACHE_TAG: "tags",
    },
  });
});

beforeEach(() => {
  authState = "ok";
  articleExists = true;
  lastUpsert = null;
  feedbackRows = [
    { vote: "too_easy" },
    { vote: "just_right" },
    { vote: "just_right" },
  ];
});

// ---- helpers ---------------------------------------------------------------

async function POST(body: unknown, id = "a1") {
  const { POST: handler } = (await import(
    "@/app/api/reader/[id]/difficulty-feedback/route"
  )) as { POST: RouteHandler };
  return handler(
    new Request("http://localhost/api/reader/a1/difficulty-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

// ---- tests ----------------------------------------------------------------

test("returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await POST({ vote: "just_right" });
  assert.equal(res.status, 401);
});

test("returns 404 when article not found", async () => {
  articleExists = false;
  const res = await POST({ vote: "just_right" });
  assert.equal(res.status, 404);
});

test("returns 400 for invalid vote value", async () => {
  const res = await POST({ vote: "invalid_value" });
  assert.equal(res.status, 400);
});

test("returns 400 when vote is missing", async () => {
  const res = await POST({});
  assert.equal(res.status, 400);
});

test("upserts vote and returns aggregate distribution", async () => {
  const res = await POST({ vote: "just_right" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    vote: string;
    tooEasy: number;
    justRight: number;
    tooHard: number;
    total: number;
  };
  assert.equal(body.vote, "just_right");
  assert.equal(body.tooEasy, 1);
  assert.equal(body.justRight, 2);
  assert.equal(body.tooHard, 0);
  assert.equal(body.total, 3);
  assert.ok(lastUpsert != null, "upsert should have been called");
});

test("upserts with too_easy vote", async () => {
  const res = await POST({ vote: "too_easy" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { vote: string };
  assert.equal(body.vote, "too_easy");
});

test("upserts with too_hard vote", async () => {
  feedbackRows = [{ vote: "too_hard" }];
  const res = await POST({ vote: "too_hard" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { tooHard: number; total: number };
  assert.equal(body.tooHard, 1);
  assert.equal(body.total, 1);
});
