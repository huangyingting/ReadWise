import assert from "node:assert/strict";
import { test } from "node:test";

import { ArticleStatus, ArticleVisibility } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { enabled, isPostgres } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";

registerIntegrationCleanup();

type SearchArticleSeed = {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly ownerId?: string;
  readonly visibility?: ArticleVisibility;
};

async function createPublishedArticle(data: SearchArticleSeed): Promise<void> {
  await prisma.article.create({
    data: {
      status: ArticleStatus.PUBLISHED,
      publishedAt: new Date(),
      ...data,
    },
  });
}

function resultContainsArticle(results: { articles: Array<{ id: string }> }, articleId: string): boolean {
  return results.articles.some((article) => article.id === articleId);
}

test("PostgreSQL full-text article search is case-insensitive and privacy-filtered", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const articleId = id("fts_article");
  const ownerId = id("fts_owner");
  const privateArticleId = id("fts_private_article");
  const privateToken = id("fts_private_token");
  await prisma.user.create({ data: { id: ownerId, name: "DB Integration FTS Owner", role: "Reader" } });
  await createPublishedArticle({
    id: articleId,
    title: "Galactic Lanterns",
    content: "Astronomers study bright lantern-like stars.",
  });
  await createPublishedArticle({
    id: privateArticleId,
    title: "Private Search Article",
    content: `This private article contains ${privateToken}.`,
    ownerId,
    visibility: ArticleVisibility.PRIVATE,
  });

  const { searchReadableArticles } = await import("@/lib/search/providers");
  const results = await searchReadableArticles("galactic", { limit: 5 });
  const rawFts = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Article"
    WHERE "id" = ${articleId}
      AND to_tsvector('english', coalesce("title", '') || ' ' || coalesce("excerpt", '') || ' ' || coalesce("content", ''))
          @@ plainto_tsquery('english', 'ASTRONOMERS')
  `;

  assert.equal(resultContainsArticle(results, articleId), true);
  assert.deepEqual(rawFts, [{ id: articleId }]);

  const anonymousPrivateResults = await searchReadableArticles(privateToken, { limit: 5 });
  assert.equal(resultContainsArticle(anonymousPrivateResults, privateArticleId), false);

  const ownerPrivateResults = await searchReadableArticles(privateToken, { limit: 5 }, ownerId);
  assert.equal(resultContainsArticle(ownerPrivateResults, privateArticleId), true);
});
