process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { ArticleSourceType, ArticleStatus, ArticleVisibility, TagScope, type Article } from "@prisma/client";

type AnyArgs = Record<string, any>;

let articleRows: AnyArgs[];
let articleFindManyArgs: AnyArgs[];
let articleFindFirstResult: AnyArgs | null;
let articleFindUniqueResult: AnyArgs | null;
let ensuredDifficultyRows: AnyArgs[] | null;
let readingListRows: AnyArgs[];
let readingListFindFirstResult: AnyArgs | null;
let readingListCreates: AnyArgs[];
let readingListUpdates: AnyArgs[];
let readingListDeletes: AnyArgs[];
let readingListItemRows: AnyArgs[];
let readingListItemCreates: AnyArgs[];
let readingListItemDeletes: AnyArgs[];
let readingListItemUpserts: AnyArgs[];
let readingListItemDeleteManyArgs: AnyArgs[];
let tags: AnyArgs[];
let articleTags: Array<{ articleId: string; tagId: string }>;
let articleTagCreates: AnyArgs[];
let articleTagDeleteManyArgs: AnyArgs[];
let articleTagGroupByArgs: AnyArgs[];
let tagCountArgs: AnyArgs[];
let tagFindManyArgs: AnyArgs[];
let articleAiMode: "null" | "cached" | "persist" | "fallback";

function article(id: string, overrides: AnyArgs = {}): Article {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id,
    slug: null,
    title: `Article ${id}`,
    content: "one two three four",
    author: null,
    source: null,
    sourceUrl: null,
    excerpt: null,
    category: null,
    difficulty: null,
    difficultyScore: null,
    lexileApprox: null,
    difficultyVersion: null,
    readingMinutes: null,
    wordCount: 400,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    heroImage: null,
    status: ArticleStatus.PUBLISHED,
    visibility: ArticleVisibility.PUBLIC,
    sourceType: ArticleSourceType.SCRAPED,
    ownerId: null,
    canonicalUrl: null,
    takedownState: "active",
    rightsNote: null,
    reviewState: "unreviewed",
    qualityFlags: [],
    organizationId: null,
    ...overrides,
  };
}

function publicTag(id: string, name: string, slug = name.toLowerCase()) {
  return {
    id,
    name,
    slug,
    scope: TagScope.PUBLIC,
    namespace: "public",
    ownerId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function matchesTagWhere(tag: AnyArgs, where: AnyArgs = {}) {
  if (where.id && tag.id !== where.id) return false;
  if (where.slug && tag.slug !== where.slug) return false;
  if (where.scope && tag.scope !== where.scope) return false;
  if (where.namespace && tag.namespace !== where.namespace) return false;
  if (where.NOT?.id && tag.id === where.NOT.id) return false;
  if (where.OR) {
    return where.OR.some((clause: AnyArgs) =>
      clause.name?.contains
        ? tag.name.includes(clause.name.contains)
        : clause.slug?.contains
          ? tag.slug.includes(clause.slug.contains)
          : false,
    );
  }
  return true;
}

before(() => {
  const prisma = {
    article: {
      findFirst: async () => articleFindFirstResult,
      findMany: async (args: AnyArgs = {}) => {
        articleFindManyArgs.push(args);
        const ids = args.where?.id?.in as string[] | undefined;
        const rows = ids ? articleRows.filter((row) => ids.includes(row.id)) : articleRows;
        const skip = args.skip ?? 0;
        const take = args.take ?? rows.length;
        return rows.slice(skip, skip + take);
      },
      findUnique: async () => articleFindUniqueResult,
    },
    readingList: {
      create: async (args: AnyArgs) => {
        readingListCreates.push(args);
        return { id: "list-new", name: args.data.name, isDefault: false };
      },
      delete: async (args: AnyArgs) => {
        readingListDeletes.push(args);
        return { id: args.where.id };
      },
      findFirst: async () => readingListFindFirstResult,
      findMany: async (args: AnyArgs = {}) => {
        if (args.select?.id) return readingListRows.map((row) => ({ id: row.id }));
        if (args.include?.items) {
          return readingListRows.map((row) => ({
            ...row,
            items: readingListItemRows
              .filter((item) => item.listId === row.id && item.articleId === args.include.items.where.articleId)
              .map((item) => ({ id: item.id })),
          }));
        }
        if (args.include?._count) {
          return readingListRows.map((row) => ({
            ...row,
            _count: { items: readingListItemRows.filter((item) => item.listId === row.id).length },
          }));
        }
        return readingListRows;
      },
      update: async (args: AnyArgs) => {
        readingListUpdates.push(args);
        return { id: args.where.id, name: args.data.name };
      },
      upsert: async (args: AnyArgs) => ({
        id: "default-list",
        name: args.create.name,
        isDefault: true,
      }),
    },
    readingListItem: {
      create: async (args: AnyArgs) => {
        readingListItemCreates.push(args);
        return { id: "item-new", ...args.data };
      },
      delete: async (args: AnyArgs) => {
        readingListItemDeletes.push(args);
        return { id: args.where.id };
      },
      deleteMany: async (args: AnyArgs) => {
        readingListItemDeleteManyArgs.push(args);
        return { count: 1 };
      },
      findMany: async (args: AnyArgs) =>
        readingListItemRows
          .filter((item) => args.where.listId.in.includes(item.listId) && args.where.articleId.in.includes(item.articleId))
          .map((item) => ({ articleId: item.articleId })),
      findUnique: async (args: AnyArgs) =>
        readingListItemRows.find(
          (item) =>
            item.listId === args.where.listId_articleId.listId &&
            item.articleId === args.where.listId_articleId.articleId,
        ) ?? null,
      upsert: async (args: AnyArgs) => {
        readingListItemUpserts.push(args);
        return { id: "item-upserted" };
      },
    },
    tag: {
      count: async (args: AnyArgs) => {
        tagCountArgs.push(args);
        return tags.filter((tag) => matchesTagWhere(tag, args.where)).length;
      },
      findFirst: async (args: AnyArgs) => tags.find((tag) => matchesTagWhere(tag, args.where)) ?? null,
      findMany: async (args: AnyArgs = {}) => {
        tagFindManyArgs.push(args);
        return tags
          .filter((tag) => matchesTagWhere(tag, args.where))
          .map((tag) => ({
            ...tag,
            _count: { articles: articleTags.filter((link) => link.tagId === tag.id).length },
          }));
      },
      findUnique: async (args: AnyArgs) =>
        tags.find((tag) => {
          const key = args.where.scope_namespace_slug;
          return tag.scope === key.scope && tag.namespace === key.namespace && tag.slug === key.slug;
        }) ?? null,
      upsert: async (args: AnyArgs) => {
        const key = args.where.scope_namespace_slug;
        const existing = tags.find(
          (tag) => tag.scope === key.scope && tag.namespace === key.namespace && tag.slug === key.slug,
        );
        if (existing) return existing;
        const created = { id: `tag-${tags.length + 1}`, createdAt: new Date(), ...args.create };
        tags.push(created);
        return created;
      },
    },
    articleTag: {
      create: async (args: AnyArgs) => {
        articleTagCreates.push(args);
        articleTags.push(args.data);
        return args.data;
      },
      deleteMany: async (args: AnyArgs) => {
        articleTagDeleteManyArgs.push(args);
        const remove = new Set(args.where.tagId?.in ?? []);
        articleTags = articleTags.filter((link) => link.articleId !== args.where.articleId || !remove.has(link.tagId));
        return { count: remove.size };
      },
      findMany: async (args: AnyArgs = {}) => {
        let rows = articleTags;
        if (args.where?.articleId) {
          if (typeof args.where.articleId === "string") rows = rows.filter((link) => link.articleId === args.where.articleId);
          if (args.where.articleId.not) rows = rows.filter((link) => link.articleId !== args.where.articleId.not);
        }
        if (args.where?.tagId) {
          if (typeof args.where.tagId === "string") rows = rows.filter((link) => link.tagId === args.where.tagId);
          if (args.where.tagId.in) rows = rows.filter((link) => args.where.tagId.in.includes(link.tagId));
        }
        if (args.select?.tag) {
          return rows.map((link) => ({ tag: tags.find((tag) => tag.id === link.tagId)! }));
        }
        if (args.select?.tagId) return rows.map((link) => ({ tagId: link.tagId }));
        if (args.select?.articleId) return rows.map((link) => ({ articleId: link.articleId }));
        return rows;
      },
      groupBy: async (args: AnyArgs) => {
        articleTagGroupByArgs.push(args);
        const ids = new Set(args.where.tagId.in as string[]);
        return [...ids].map((tagId) => ({
          tagId,
          _count: { _all: articleTags.filter((link) => link.tagId === tagId).length },
        }));
      },
      upsert: async (args: AnyArgs) => {
        const key = args.where.articleId_tagId;
        if (!articleTags.some((link) => link.articleId === key.articleId && link.tagId === key.tagId)) {
          articleTags.push(args.create);
        }
        return args.create;
      },
    },
  };

  mock.module("@/lib/prisma", { namedExports: { prisma } });
  mock.module("@/lib/api-handler", {
    namedExports: {
      ApiError: class ApiError extends Error {
        readonly status: number;
        constructor(status: number, message: string) {
          super(message);
          this.status = status;
        }
      },
    },
  });
  mock.module("@/lib/cache", {
    namedExports: {
      LISTING_CACHE_TAG: "listing",
      createCachedListing:
        <T extends unknown[], R>(fn: (...args: T) => Promise<R>) =>
        (...args: T) =>
          fn(...args),
    },
  });
  mock.module("@/lib/difficulty", {
    namedExports: {
      ensureArticleDifficulties: async (rows: AnyArgs[]) => {
        ensuredDifficultyRows = rows;
      },
    },
  });
  mock.module("@/lib/ai/cache", {
    namedExports: {
      getOrCreateArticleAi: async (_articleId: string, options: AnyArgs) => {
        if (articleAiMode === "cached") {
          const cached = await options.readCache();
          return cached ? options.toResult(cached) : options.fallback();
        }
        if (articleAiMode === "persist") {
          options.buildMessages({ title: "Article", content: "<p>Science and nature</p>" });
          const parsed = options.parse("Science, Nature");
          if (options.isEmpty(parsed)) return options.fallback();
          const persisted = await options.persist("a1", parsed);
          return options.toResult(persisted);
        }
        if (articleAiMode === "fallback") return options.fallback();
        return null;
      },
    },
  });
  mock.module("@/lib/content-pipeline", {
    namedExports: {
      articleHtmlToReaderText: (html: string) => html,
    },
  });
  mock.module("@/lib/ai/chunking", {
    namedExports: {
      boundedSampleForFeature: (text: string) => text,
    },
  });
  mock.module("@/lib/ai/prompts", {
    namedExports: {
      TARGET_TAGS: 5,
      promptModelParams: () => ({ maxOutputTokens: 100 }),
      renderPrompt: () => [{ role: "user", content: "tags" }],
    },
  });
  mock.module("@/lib/ai/output/validators", {
    namedExports: {
      validateTags: () => ({ items: ["Science", "Nature"] }),
    },
  });
  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS: {},
      auditRequestInfo: () => ({}),
      recordAuditFromRequest: async () => {},
      tryRecordAuditLog: async () => {},
    },
  });
});

beforeEach(() => {
  articleRows = [
    article("a1", { category: "science", difficulty: "A1", difficultyScore: 1 }),
    article("a2", { category: "history", difficulty: "B1", difficultyScore: 2 }),
    article("a3", { category: "science", difficulty: "C1", difficultyScore: 3 }),
    article("a4", { category: "science", difficulty: null, difficultyScore: null }),
  ];
  articleFindManyArgs = [];
  articleFindFirstResult = article("readable");
  articleFindUniqueResult = article("a1");
  ensuredDifficultyRows = null;
  readingListRows = [
    { id: "default-list", userId: "user-1", name: "Saved", isDefault: true, createdAt: new Date("2026-01-01") },
    { id: "later-list", userId: "user-1", name: "Later", isDefault: false, createdAt: new Date("2026-01-02") },
  ];
  readingListFindFirstResult = readingListRows[1];
  readingListCreates = [];
  readingListUpdates = [];
  readingListDeletes = [];
  readingListItemRows = [
    { id: "item-1", listId: "default-list", articleId: "a1" },
    { id: "item-2", listId: "later-list", articleId: "a2" },
  ];
  readingListItemCreates = [];
  readingListItemDeletes = [];
  readingListItemUpserts = [];
  readingListItemDeleteManyArgs = [];
  tags = [publicTag("tag-1", "Science", "science"), publicTag("tag-2", "Nature", "nature")];
  articleTags = [
    { articleId: "a1", tagId: "tag-1" },
    { articleId: "a2", tagId: "tag-1" },
    { articleId: "a2", tagId: "tag-2" },
  ];
  articleTagCreates = [];
  articleTagDeleteManyArgs = [];
  articleTagGroupByArgs = [];
  tagCountArgs = [];
  tagFindManyArgs = [];
  articleAiMode = "null";
});

test("article listing helpers paginate, rank by level, and list personal imports", async () => {
  const listings = await import("@/lib/article-library/listings");

  assert.equal((await listings.getArticleById("a1"))?.id, "readable");
  assert.equal((await listings.getViewableArticleById("a1", "Reader", "user-1"))?.id, "readable");

  assert.deepEqual(
    listings.filterAndSortByLevel(
      [
        article("hard", { difficulty: "C1", difficultyScore: 3 }),
        article("easy", { difficulty: "A1", difficultyScore: 9 }),
        article("unknown", { difficulty: null }),
        article("easier", { difficulty: "A1", difficultyScore: 1 }),
      ],
      null,
    ).map((row) => row.id),
    ["easier", "easy", "hard", "unknown"],
  );
  assert.deepEqual(
    listings.filterAndSortByLevel(articleRows as never, "B1").map((row) => row.id),
    ["a1", "a2"],
  );
  assert.deepEqual(listings.rankPicks(articleRows as never, "C1", ["history"]).map((row) => row.id), [
    "a2",
    "a1",
    "a3",
  ]);

  let page = await listings.listCategoryPage("science", { offset: -10, limit: 2 });
  assert.equal(page.hasMore, true);
  assert.deepEqual(page.articles.map((row) => row.id), ["a1", "a2"]);
  assert.equal(articleFindManyArgs.at(-1)?.skip, 0);
  assert.equal(articleFindManyArgs.at(-1)?.take, 3);

  page = await listings.listCategoryPage(null, { maxLevel: "B1", offset: 1, limit: 1 });
  assert.equal(page.hasMore, true);
  assert.deepEqual(articleFindManyArgs.at(-1)?.where.difficulty, { in: ["A1", "A2", "B1"] });
  assert.deepEqual(articleFindManyArgs.at(-1)?.orderBy[0], { difficultyScore: "asc" });

  const picks = await listings.listPicksPage("B1", ["history"], { offset: 0, limit: 1 });
  assert.deepEqual(ensuredDifficultyRows?.map((row) => row.id), articleRows.map((row) => row.id));
  assert.deepEqual(picks.articles.map((row) => row.id), ["a2"]);
  assert.equal(picks.hasMore, true);

  await listings.listPublishedArticles(3);
  assert.equal(articleFindManyArgs.at(-1)?.take, 3);
  await listings.listPersonalArticles("user-1", 4);
  assert.equal(articleFindManyArgs.at(-1)?.take, 4);
  const personal = await listings.listPersonalArticlesPage("user-1", { offset: -1, limit: 99 });
  assert.equal(articleFindManyArgs.at(-1)?.take, 51);
  assert.equal(personal.hasMore, false);
});

test("collection schemas, read models, membership, and commands enforce ownership", async () => {
  const schemas = await import("@/lib/article-library/collections/schemas");
  const readModels = await import("@/lib/article-library/collections/read-models");
  const membership = await import("@/lib/article-library/collections/membership");
  const commands = await import("@/lib/article-library/collections/commands");

  assert.equal(schemas.parseMembershipQuery(new URLSearchParams()).ok, false);
  assert.deepEqual(schemas.parseMembershipQuery(new URLSearchParams("articleId=a1")), {
    ok: true,
    value: { articleId: "a1" },
  });

  assert.deepEqual(await readModels.getUserLists("user-1"), [
    { id: "default-list", name: "Saved", isDefault: true, count: 1 },
    { id: "later-list", name: "Later", isDefault: false, count: 1 },
  ]);
  readingListFindFirstResult = {
    ...readingListRows[1],
    items: [{ article: article("a2", { publishedAt: "2026-01-01T00:00:00.000Z" }) }],
  };
  const list = await readModels.getListWithArticles("later-list", "user-1");
  assert.equal(list?.articles[0].id, "a2");
  readingListFindFirstResult = null;
  assert.equal(await readModels.getListWithArticles("missing", "user-1"), null);
  assert.deepEqual([...(await readModels.getBookmarkedArticleIds("user-1", []))], []);
  readingListRows = [];
  assert.deepEqual([...(await readModels.getBookmarkedArticleIds("user-1", ["a1"]))], []);
  readingListRows = [{ id: "default-list", userId: "user-1", name: "Saved", isDefault: true }];
  assert.deepEqual([...(await readModels.getBookmarkedArticleIds("user-1", ["a1"]))], ["a1"]);

  readingListRows = [
    { id: "default-list", userId: "user-1", name: "Saved", isDefault: true, createdAt: new Date("2026-01-01") },
    { id: "later-list", userId: "user-1", name: "Later", isDefault: false, createdAt: new Date("2026-01-02") },
  ];
  assert.deepEqual(await membership.getArticleListMembership("user-1", "a1"), [
    { id: "default-list", name: "Saved", isDefault: true, hasArticle: true },
    { id: "later-list", name: "Later", isDefault: false, hasArticle: false },
  ]);
  articleFindFirstResult = null;
  assert.equal(await membership.getArticleListMembership("user-1", "a1"), null);
  articleFindFirstResult = article("readable");

  assert.deepEqual(await commands.createList("user-1", "Favorites"), {
    id: "list-new",
    name: "Favorites",
    isDefault: false,
  });
  readingListFindFirstResult = null;
  assert.equal((await commands.renameList("missing", "user-1", "Renamed")).ok, false);
  readingListFindFirstResult = readingListRows[1];
  assert.equal((await commands.renameList("later-list", "user-1", "Renamed")).ok, true);
  assert.equal(readingListUpdates[0].data.name, "Renamed");

  readingListFindFirstResult = readingListRows[0];
  let deleteResult = await commands.deleteList("default-list", "user-1");
  assert.equal(deleteResult.ok, false);
  if (!deleteResult.ok) assert.equal(deleteResult.status, 409);
  readingListFindFirstResult = readingListRows[1];
  assert.equal((await commands.deleteList("later-list", "user-1")).ok, true);
  assert.equal(readingListDeletes[0].where.id, "later-list");

  readingListFindFirstResult = null;
  assert.equal((await commands.addToList("missing", "user-1", "a1")).ok, false);
  readingListFindFirstResult = readingListRows[1];
  articleFindFirstResult = null;
  assert.equal((await commands.addToList("later-list", "user-1", "a1")).ok, false);
  articleFindFirstResult = article("readable");
  assert.equal((await commands.addToList("later-list", "user-1", "a1")).ok, true);
  assert.equal(readingListItemUpserts[0].create.articleId, "a1");
  assert.equal((await commands.removeFromList("later-list", "user-1", "a1")).ok, true);
  assert.deepEqual(readingListItemDeleteManyArgs[0].where, { listId: "later-list", articleId: "a1" });

  readingListItemRows = [{ id: "existing-item", listId: "default-list", articleId: "a1" }];
  let toggle = await commands.toggleBookmark("user-1", "a1");
  assert.equal(toggle.ok, true);
  if (toggle.ok) assert.equal(toggle.bookmarked, false);
  assert.equal(readingListItemDeletes[0].where.id, "existing-item");
  readingListItemRows = [];
  toggle = await commands.toggleBookmark("user-1", "a1");
  assert.equal(toggle.ok, true);
  if (toggle.ok) assert.equal(toggle.bookmarked, true);
  assert.equal(readingListItemCreates[0].data.listId, "default-list");
});

test("tag read models and admin tag listing filter public scoped data", async () => {
  const tagsModule = await import("@/lib/article-library/collections/tags");
  const adminTags = await import("@/lib/article-library/admin-tags");

  assert.deepEqual((await tagsModule.getArticleTags("a2")).map((tag) => tag.slug), ["science", "nature"]);
  articleAiMode = "cached";
  assert.deepEqual(await tagsModule.getOrCreateArticleTags("a2"), {
    articleId: "a2",
    tags: [
      { id: "tag-1", name: "Science", slug: "science", scope: TagScope.PUBLIC },
      { id: "tag-2", name: "Nature", slug: "nature", scope: TagScope.PUBLIC },
    ],
    fallback: false,
  });
  articleAiMode = "fallback";
  assert.deepEqual(await tagsModule.getOrCreateArticleTags("new"), {
    articleId: "new",
    tags: [],
    fallback: true,
  });
  articleAiMode = "persist";
  articleTags = [];
  const generated = await tagsModule.getOrCreateArticleTags("a1");
  assert.equal(generated?.fallback, false);
  assert.deepEqual(generated?.tags.map((tag) => tag.slug).sort(), ["nature", "science"]);

  articleTags = [{ articleId: "a1", tagId: "tag-1" }];
  articleFindUniqueResult = null;
  assert.equal(await tagsModule.setArticleTags("missing", ["Science"]), null);

  articleFindUniqueResult = article("a1", { visibility: ArticleVisibility.PUBLIC, ownerId: null });
  const set = await tagsModule.setArticleTags("a1", [" Science ", "science", "", "New Topic"]);
  assert.ok(set?.some((tag) => tag.slug === "new-topic"));
  assert.equal(articleTagDeleteManyArgs.length, 0);
  assert.ok(articleTagCreates.some((entry) => entry.data.articleId === "a1"));
  await tagsModule.setArticleTags("a1", ["New Topic"]);
  assert.equal(articleTagDeleteManyArgs.length, 1);

  assert.equal((await tagsModule.getTagBySlug("science"))?.name, "Science");
  assert.equal(await tagsModule.getTagBySlug("unknown"), null);
  await tagsModule.listArticlesByTag("science", 3);
  assert.equal(articleFindManyArgs.at(-1)?.take, 3);

  articleTags = [];
  assert.deepEqual(await tagsModule.listRelatedArticles("a1"), []);
  articleTags = [
    { articleId: "a1", tagId: "tag-1" },
    { articleId: "a1", tagId: "tag-2" },
    { articleId: "a2", tagId: "tag-1" },
    { articleId: "a3", tagId: "tag-1" },
    { articleId: "a3", tagId: "tag-2" },
  ];
  const related = await tagsModule.listRelatedArticles("a1", 1);
  assert.equal(related.length, 1);
  assert.equal(related[0].id, "a3");
  assert.equal((await tagsModule.listTagsWithCounts()).every((tag) => tag.articleCount > 0), true);

  let listed = await adminTags.listAdminTags({ query: " Sci ", page: -3, pageSize: 1 });
  assert.equal(listed.query, "Sci");
  assert.equal(listed.page, 1);
  assert.equal(listed.pageSize, 1);
  assert.equal(listed.totalPages >= 1, true);
  assert.equal(tagCountArgs[0].where.OR.length, 2);
  assert.equal(articleTagGroupByArgs.length > 0, true);

  tags = [];
  listed = await adminTags.listAdminTags();
  assert.deepEqual(listed.tags, []);
  assert.equal(listed.totalPages, 1);
});

test("article policy helpers centralize readable, editable, and import predicates", async () => {
  const policy = await import("@/lib/article-library/policy");

  const publicArticle = article("public");
  const privateArticle = article("private", {
    visibility: ArticleVisibility.PRIVATE,
    ownerId: "user-1",
  });
  const draftArticle = article("draft", { status: ArticleStatus.DRAFT });
  const readerContext = policy.articleAccessContext({ id: "user-1", role: "Reader" });
  const adminContext = policy.articleAccessContext({ id: "admin-1", role: "Admin" });

  assert.deepEqual(readerContext, { userId: "user-1", role: "Reader" });
  assert.equal(policy.isPublicListableArticle(publicArticle), true);
  assert.equal(policy.isPublicListableArticle(draftArticle), false);
  assert.equal(policy.canReadArticle(privateArticle, readerContext), true);
  assert.equal(policy.canReadArticle(privateArticle, { userId: "other", role: "Reader" }), false);
  assert.equal(policy.canReadArticle(draftArticle, adminContext), true);
  assert.equal(policy.canEditArticle(privateArticle, readerContext), true);
  assert.equal(policy.canEditArticle(publicArticle, readerContext), false);
  assert.equal(policy.canEditArticle(publicArticle, adminContext), true);
  assert.equal(policy.canAdminViewArticles(readerContext), false);
  assert.equal(policy.canAdminViewArticles(adminContext), true);
  assert.equal(policy.canAiProcessArticle(publicArticle, null), true);

  assert.deepEqual(policy.publicListableArticleWhere({ id: "a1" }), {
    id: "a1",
    visibility: ArticleVisibility.PUBLIC,
    status: ArticleStatus.PUBLISHED,
    ownerId: null,
  });
  assert.deepEqual(policy.ownedArticleWhere("user-1", { id: "a1" }), {
    id: "a1",
    visibility: ArticleVisibility.PRIVATE,
    ownerId: "user-1",
  });
  assert.deepEqual(policy.publicLibraryArticleWhere({ id: "a1" }), {
    id: "a1",
    visibility: ArticleVisibility.PUBLIC,
    ownerId: null,
  });
  assert.ok("AND" in policy.readableArticleWhere(readerContext, { OR: [{ id: "a1" }] }));
  assert.deepEqual(policy.editableArticleWhere(null), { id: "__readwise_article_access_denied__" });
  assert.deepEqual(policy.adminVisibleArticleWhere(adminContext, { id: "a1" }), { id: "a1" });
  assert.deepEqual(policy.adminVisibleArticleWhere(readerContext), { id: "__readwise_article_access_denied__" });
  assert.deepEqual(policy.aiProcessableArticleWhere(readerContext, { id: "a1" }), policy.readableArticleWhere(readerContext, { id: "a1" }));

  articleFindFirstResult = article("found");
  assert.equal((await policy.getPublicListableArticleById("found"))?.id, "found");
  assert.equal((await policy.getPublicListableArticleById("found", { select: { id: true } }))?.id, "found");
  assert.equal((await policy.getReadableArticleById("found", readerContext))?.id, "found");
  assert.equal((await policy.getEditableArticleById("found", readerContext))?.id, "found");
  assert.equal((await policy.getAdminVisibleArticleById("found", adminContext))?.id, "found");
  assert.equal((await policy.getAiProcessableArticleById("found", readerContext))?.id, "found");

  articleFindUniqueResult = { title: "AI", content: "<p>body</p>" };
  assert.deepEqual(await policy.loadAiProcessableArticleText("a1", adminContext), {
    title: "AI",
    content: "<p>body</p>",
  });
  assert.equal((await policy.loadAiProcessableArticleText("a1", readerContext))?.title, "Article found");
  assert.equal((await policy.findOwnedArticleBySourceUrl("https://example.test/private", "user-1"))?.id, "found");
  assert.equal((await policy.findPublicLibraryArticleBySourceUrl("https://example.test/public"))?.id, "found");

  assert.deepEqual([...(await policy.findExistingPublicLibrarySourceUrls([]))], []);
  articleRows = [
    article("source-1", { sourceUrl: "https://example.test/one" }),
    article("source-2", { sourceUrl: null }),
  ];
  assert.deepEqual(
    [...(await policy.findExistingPublicLibrarySourceUrls(["https://example.test/one", "https://example.test/one"]))],
    ["https://example.test/one"],
  );
  assert.deepEqual(policy.privateImportedArticleCreateFields("user-1"), {
    visibility: ArticleVisibility.PRIVATE,
    sourceType: "IMPORTED",
    ownerId: "user-1",
  });
});
