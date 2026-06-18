import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

type Tag = { id: string; name: string; slug: string };

let aiConfigured = false;
let aiReply: string | null = null;
const articles = new Map<string, { id: string; title: string; content: string }>();
let tags: Tag[] = [];
let articleTags: { articleId: string; tagId: string }[] = [];
let articleRows: { id: string; status: string; publishedAt: Date | null; createdAt: Date }[] = [];
let tagSeq = 0;

before(() => {
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
          findUnique: async (a: { where: { id: string } }) =>
            articles.get(a.where.id) ?? null,
          findMany: async (a: { where: { id: { in: string[] } } }) =>
            articleRows.filter((r) => a.where.id.in.includes(r.id)),
        },
        tag: {
          findUnique: async (a: { where: { slug: string } }) =>
            tags.find((t) => t.slug === a.where.slug) ?? null,
          upsert: async (a: { where: { slug: string }; create: { name: string; slug: string } }) => {
            const existing = tags.find((t) => t.slug === a.where.slug);
            if (existing) return existing;
            const tag = { id: `tag-${++tagSeq}`, name: a.create.name, slug: a.create.slug };
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
  articleRows = [];
  tagSeq = 0;
  articles.set("a1", { id: "a1", title: "Title", content: "<p>Body about climate.</p>" });
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

test("listRelatedArticles ranks by shared-tag overlap", async () => {
  tags = [
    { id: "t1", name: "A", slug: "a" },
    { id: "t2", name: "B", slug: "b" },
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
    { id: "rel1", status: "published", publishedAt: now, createdAt: now },
    { id: "rel2", status: "published", publishedAt: now, createdAt: now },
  ];
  const { listRelatedArticles } = await import("@/lib/tags");
  const related = await listRelatedArticles("a1");
  assert.deepEqual(related.map((a) => a.id), ["rel2", "rel1"]);
});

test("listRelatedArticles returns [] when the article has no tags", async () => {
  const { listRelatedArticles } = await import("@/lib/tags");
  assert.deepEqual(await listRelatedArticles("a1"), []);
});
