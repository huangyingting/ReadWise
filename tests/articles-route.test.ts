process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

let authState: AuthState = "ok";
let browseCalls: Array<{
  category: string | null;
  options: { offset: number; limit: number; maxLevel: string | null; query: string | null };
}> = [];
let picksCalls: Array<{
  userId: string;
  options: { maxLevel: string | null; topics: string[]; query: string | null; offset: number; limit: number };
}> = [];
let buildResponseCalls: Array<{ userId: string; articles: unknown[]; page: { offset: number; hasMore: boolean } }> = [];
let profile: { englishLevel?: string | null; topics?: string | null } | null = null;

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: fullAuthExports(() => authState),
  });

  mock.module("@/lib/article-library", {
    namedExports: {
      BROWSE_PAGE_SIZE: 12,
      listCategoryPage: async (
        category: string | null,
        options: { offset: number; limit: number; maxLevel: string | null; query: string | null },
      ) => {
        browseCalls.push({ category, options });
        return { articles: [{ id: "browse-1" }], hasMore: true };
      },
      toListingArticle: (article: { id: string }) => ({ ...article, transformed: true }),
      buildArticleListResponse: async (
        userId: string,
        articles: unknown[],
        page: { offset: number; hasMore: boolean },
      ) => {
        buildResponseCalls.push({ userId, articles, page });
        return { articles, progress: {}, hasMore: page.hasMore, offset: page.offset + articles.length };
      },
    },
  });

  mock.module("@/lib/recommendations", {
    namedExports: {
      listScoredPicksPage: async (
        userId: string,
        options: { maxLevel: string | null; topics: string[]; query: string | null; offset: number; limit: number },
      ) => {
        picksCalls.push({ userId, options });
        return { articles: [{ id: "pick-1" }], hasMore: false };
      },
    },
  });

  mock.module("@/features/profile-preferences/repository", {
    namedExports: {
      getProfile: async () => profile,
    },
  });

  mock.module("@/features/profile-preferences/schema", {
    namedExports: {
      parseTopics: (value: string | null | undefined) =>
        typeof value === "string" && value.length > 0 ? value.split(",") : [],
    },
  });

  mock.module("@/lib/categories", {
    namedExports: {
      isValidCategorySlug: (value: string) => ["science", "tech"].includes(value),
    },
  });

  mock.module("@/lib/leveling/cefr-primitives", {
    namedExports: {
      isDifficultyLevel: (value: string | null | undefined) =>
        ["A1", "A2", "B1", "B2", "C1", "C2"].includes(String(value)),
    },
  });

  mock.module("@/lib/browse-query", {
    namedExports: {
      normalizeBrowseQuery: (value: string) => {
        const normalized = value.trim();
        return normalized.length > 0 ? normalized : null;
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  browseCalls = [];
  picksCalls = [];
  buildResponseCalls = [];
  profile = null;
});

async function getArticles(url = "http://test/api/articles"): Promise<Response> {
  const { GET } = (await import("@/app/api/articles/route")) as { GET: RouteHandler };
  return GET(new Request(url));
}

test("articles route returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const response = await getArticles();
  assert.equal(response.status, 401);
});

test("articles route lists browse results with query normalization and clamped limits", async () => {
  const response = await getArticles(
    "http://test/api/articles?category=unknown&level=Z9&q=%20climate%20&offset=5&limit=999",
  );

  assert.equal(response.status, 200);
  assert.equal(browseCalls.length, 1);
  assert.deepEqual(browseCalls[0], {
    category: null,
    options: {
      offset: 5,
      limit: 24,
      maxLevel: null,
      query: "climate",
    },
  });
  assert.equal(picksCalls.length, 0);

  const payload = (await response.json()) as { offset: number; hasMore: boolean; articles: Array<{ transformed: boolean }> };
  assert.equal(payload.offset, 6);
  assert.equal(payload.hasMore, true);
  assert.equal(payload.articles[0]?.transformed, true);
});

test("articles route uses picks view with profile fallback level and topics", async () => {
  profile = { englishLevel: "B2", topics: "science,tech" };

  const response = await getArticles("http://test/api/articles?view=picks&level=&q=space&offset=2&limit=3");

  assert.equal(response.status, 200);
  assert.equal(picksCalls.length, 1);
  assert.deepEqual(picksCalls[0], {
    userId: "user-1",
    options: {
      maxLevel: "B2",
      topics: ["science", "tech"],
      query: "space",
      offset: 2,
      limit: 3,
    },
  });
  assert.equal(buildResponseCalls[0]?.userId, "user-1");
  assert.equal(buildResponseCalls[0]?.page.offset, 2);
  assert.equal(buildResponseCalls[0]?.page.hasMore, false);
});
