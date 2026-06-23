import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  ArticleStatus,
  ArticleVisibility,
  TagScope,
} from "@prisma/client";

type Tag = {
  id: string;
  name: string;
  slug: string;
  scope: TagScope;
  namespace: string;
  ownerId: string | null;
};

let aiConfigured = false;
let aiReply: string | null = null;
const articles = new Map<
  string,
  {
    id: string;
    title: string;
    content: string;
    visibility: ArticleVisibility;
    ownerId: string | null;
  }
>();
let tags: Tag[] = [];
let articleTags: { articleId: string; tagId: string }[] = [];
let tagFindManyCalls: Array<{ where?: { scope?: TagScope } }> = [];
let articleRows: {
  id: string;
  status: ArticleStatus;
  visibility: ArticleVisibility;
  publishedAt: Date | null;
  createdAt: Date;
}[] = [];
let tagSeq = 0;

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: {
      requireAdminApi: async () => ({
        session: { user: { id: "admin-1", role: "Admin" } },
      }),
      requireSessionApi: async () => ({
        session: { user: { id: "user-1", role: "Reader" } },
      }),
    },
  });
  mock.module("@/lib/ai", {
    namedExports: {
      isAiConfigured: () => aiConfigured,
      aiModelName: () => (aiConfigured ? "gpt-test" : null),
      chatComplete: async () => aiReply,
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findUnique: async (a: { where: { id: string }; select?: Record<string, boolean> }) => {
            const article = articles.get(a.where.id);
            if (!article || !a.select) return article ?? null;
            return Object.fromEntries(
              Object.entries(a.select)
                .filter(([, include]) => include)
                .map(([key]) => [key, (article as unknown as Record<string, unknown>)[key]]),
            );
          },
          findMany: async (a: { where: { id: { in: string[] } } }) =>
            articleRows.filter((r) => a.where.id.in.includes(r.id)),
        },
        tag: {
          findUnique: async (a: { where: { scope_namespace_slug: { scope: TagScope; namespace: string; slug: string } } }) =>
            tags.find((t) =>
              t.scope === a.where.scope_namespace_slug.scope &&
              t.namespace === a.where.scope_namespace_slug.namespace &&
              t.slug === a.where.scope_namespace_slug.slug
            ) ?? null,
          findFirst: async (a: { where: { slug: string; scope: TagScope; articles?: unknown } }) =>
            tags.find((t) =>
              t.slug === a.where.slug &&
              t.scope === a.where.scope &&
              articleTags.some((at) => at.tagId === t.id)
            ) ?? null,
          findMany: async (a: { where?: { scope?: TagScope }; select?: { _count?: unknown } }) => {
            tagFindManyCalls.push(a);
            return tags
              .filter((t) => !a.where?.scope || t.scope === a.where.scope)
              .map((t) => ({
                ...t,
                _count: a.select?._count
                  ? {
                      articles: articleTags.filter((at) => {
                        if (at.tagId !== t.id) return false;
                        const article = articleRows.find((r) => r.id === at.articleId);
                        return (
                          article?.visibility === ArticleVisibility.PUBLIC &&
                          article.status === ArticleStatus.PUBLISHED
                        );
                      }).length,
                    }
                  : undefined,
              }));
          },
          upsert: async (a: {
            where: { scope_namespace_slug: { scope: TagScope; namespace: string; slug: string } };
            create: { name: string; slug: string; scope: TagScope; namespace: string; ownerId: string | null };
          }) => {
            const key = a.where.scope_namespace_slug;
            const existing = tags.find((t) =>
              t.scope === key.scope && t.namespace === key.namespace && t.slug === key.slug
            );
            if (existing) return existing;
            const tag = {
              id: `tag-${++tagSeq}`,
              name: a.create.name,
              slug: a.create.slug,
              scope: a.create.scope,
              namespace: a.create.namespace,
              ownerId: a.create.ownerId,
            };
            tags.push(tag);
            return tag;
          },
        },
        articleTag: {
          findMany: async (a: {
            where: { articleId?: string; tagId?: { in: string[] } };
            select?: { tag?: unknown; tagId?: unknown; articleId?: unknown };
          }) => {
            if (a.select?.tag) {
              return articleTags
                .filter((at) => at.articleId === a.where.articleId)
                .map((at) => ({ tag: tags.find((t) => t.id === at.tagId)! }))
                .sort((x, y) => x.tag.name.localeCompare(y.tag.name));
            }
            if (a.select?.tagId) {
              return articleTags
                .filter((at) => at.articleId === a.where.articleId)
                .map((at) => ({ tagId: at.tagId }));
            }
            const ids = a.where.tagId?.in ?? [];
            return articleTags
              .filter((at) => ids.includes(at.tagId) && at.articleId !== a.where.articleId)
              .map((at) => ({ articleId: at.articleId }));
          },
          upsert: async (a: { create: { articleId: string; tagId: string } }) => {
            articleTags.push(a.create);
            return a.create;
          },
        },
      },
    },
  });
  mock.module("@/lib/cache", {
    namedExports: {
      ARTICLES_CACHE_TAG: "articles",
      TAGS_CACHE_TAG: "tags",
      // Bypass Next's unstable_cache so tests stay DB/Next-runtime free.
      createCachedListing: (fn: (...args: never[]) => unknown) => fn,
    },
  });
});

beforeEach(() => {
  aiConfigured = false;
  aiReply = null;
  articles.clear();
  tags = [];
  articleTags = [];
  tagFindManyCalls = [];
  articleRows = [];
  tagSeq = 0;
  articles.set("a1", {
    id: "a1",
    title: "Title",
    content: "<p>Body about climate.</p>",
    visibility: ArticleVisibility.PUBLIC,
    ownerId: null,
  });
});

test("slugifyTag normalizes names to url slugs", async () => {
  const { slugifyTag } = await import("@/lib/tags");
  assert.equal(slugifyTag("Climate Change"), "climate-change");
  assert.equal(slugifyTag("Café & Crème"), "cafe-and-creme");
  assert.equal(slugifyTag("  Multiple   Spaces  "), "multiple-spaces");
});

test("parseTagsJson dedups by slug and tolerates fences", async () => {
  const { parseTagsJson } = await import("@/lib/tags");
  const result = parseTagsJson('```json ["Tech", "tech", "AI", ""] ```');
  assert.deepEqual(result, ["Tech", "AI"]);
  assert.deepEqual(parseTagsJson("garbage"), []);
});

test("getOrCreateArticleTags returns null for a missing article", async () => {
  const { getOrCreateArticleTags } = await import("@/lib/tags");
  assert.equal(await getOrCreateArticleTags("missing"), null);
});

test("getOrCreateArticleTags falls back without persisting when AI unconfigured", async () => {
  const { getOrCreateArticleTags } = await import("@/lib/tags");
  const result = await getOrCreateArticleTags("a1");
  assert.equal(result?.fallback, true);
  assert.equal(result?.tags.length, 0);
  assert.equal(articleTags.length, 0);
});

test("getOrCreateArticleTags extracts, creates tags and links them", async () => {
  aiConfigured = true;
  aiReply = '["Climate Change", "Science"]';
  const { getOrCreateArticleTags } = await import("@/lib/tags");
  const result = await getOrCreateArticleTags("a1");
  assert.equal(result?.fallback, false);
  assert.equal(result?.tags.length, 2);
  assert.deepEqual(result?.tags.map((t) => t.slug).sort(), ["climate-change", "science"]);
  assert.equal(articleTags.length, 2);
});

test("getOrCreateArticleTags scopes private article tags to the owner namespace", async () => {
  articles.set("private-a1", {
    id: "private-a1",
    title: "Private",
    content: "<p>Personal climate notes.</p>",
    visibility: ArticleVisibility.PRIVATE,
    ownerId: "user-1",
  });
  aiConfigured = true;
  aiReply = '["Climate Change"]';
  const { getOrCreateArticleTags } = await import("@/lib/tags");

  const result = await getOrCreateArticleTags("private-a1");

  assert.equal(result?.fallback, false);
  assert.equal(result?.tags[0].scope, TagScope.PRIVATE);
  assert.equal(tags[0].namespace, "user:user-1");
  assert.equal(tags[0].ownerId, "user-1");
});

test("listTagsWithCounts excludes private-only tags from public listings", async () => {
  tags = [
    { id: "public-tag", name: "Shared", slug: "shared", scope: TagScope.PUBLIC, namespace: "public", ownerId: null },
    { id: "private-tag", name: "Private", slug: "private", scope: TagScope.PRIVATE, namespace: "user:user-1", ownerId: "user-1" },
  ];
  articleTags = [
    { articleId: "public-a1", tagId: "public-tag" },
    { articleId: "private-a1", tagId: "private-tag" },
  ];
  const now = new Date("2026-01-01");
  articleRows = [
    { id: "public-a1", status: ArticleStatus.PUBLISHED, visibility: ArticleVisibility.PUBLIC, publishedAt: now, createdAt: now },
    { id: "private-a1", status: ArticleStatus.PUBLISHED, visibility: ArticleVisibility.PRIVATE, publishedAt: now, createdAt: now },
  ];
  const { listTagsWithCounts } = await import("@/lib/tags");

  const listed = await listTagsWithCounts();

  assert.deepEqual(listed.map((t) => t.slug), ["shared"]);
});

test("admin merge target API excludes private tags", async () => {
  tags = [
    {
      id: "public-tag",
      name: "Shared",
      slug: "shared",
      scope: TagScope.PUBLIC,
      namespace: "public",
      ownerId: null,
    },
    {
      id: "private-tag",
      name: "Private Import",
      slug: "private-import",
      scope: TagScope.PRIVATE,
      namespace: "user:user-1",
      ownerId: "user-1",
    },
  ];
  const { GET } = await import("@/app/api/admin/tags/route");

  const res = await GET(new Request("http://test/api/admin/tags"));
  const body = (await res.json()) as Array<{ name: string }>;

  assert.equal(res.status, 200);
  assert.deepEqual(body.map((t) => t.name), ["Shared"]);
  assert.equal(tagFindManyCalls.at(-1)?.where?.scope, TagScope.PUBLIC);
});

test("listRelatedArticles ranks by shared-tag overlap", async () => {
  tags = [
    { id: "t1", name: "A", slug: "a", scope: TagScope.PUBLIC, namespace: "public", ownerId: null },
    { id: "t2", name: "B", slug: "b", scope: TagScope.PUBLIC, namespace: "public", ownerId: null },
  ];
  articleTags = [
    { articleId: "a1", tagId: "t1" },
    { articleId: "a1", tagId: "t2" },
    { articleId: "rel2", tagId: "t1" },
    { articleId: "rel2", tagId: "t2" },
    { articleId: "rel1", tagId: "t1" },
  ];
  const now = new Date("2026-01-01");
  articleRows = [
    { id: "rel1", status: ArticleStatus.PUBLISHED, visibility: ArticleVisibility.PUBLIC, publishedAt: now, createdAt: now },
    { id: "rel2", status: ArticleStatus.PUBLISHED, visibility: ArticleVisibility.PUBLIC, publishedAt: now, createdAt: now },
  ];
  const { listRelatedArticles } = await import("@/lib/tags");
  const related = await listRelatedArticles("a1");
  assert.deepEqual(related.map((a) => a.id), ["rel2", "rel1"]);
});

test("listRelatedArticles returns [] when the article has no tags", async () => {
  const { listRelatedArticles } = await import("@/lib/tags");
  assert.deepEqual(await listRelatedArticles("a1"), []);
});
