import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";

import { ArticleStatus, ArticleVisibility } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { enabled, isPostgres } from "./support/db-config";
import { cleanIntegrationRows, id } from "./support/db-helpers";

afterEach(async () => {
  if (enabled) await cleanIntegrationRows();
});

after(async () => {
  await prisma.$disconnect();
});

test("PostgreSQL full-text article search is case-insensitive and privacy-filtered", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const articleId = id("fts_article");
  const ownerId = id("fts_owner");
  const privateArticleId = id("fts_private_article");
  const privateToken = id("fts_private_token");
  await prisma.user.create({ data: { id: ownerId, name: "DB Integration FTS Owner", role: "Reader" } });
  await prisma.article.create({
    data: {
      id: articleId,
      title: "Galactic Lanterns",
      content: "Astronomers study bright lantern-like stars.",
      status: ArticleStatus.PUBLISHED,
      publishedAt: new Date(),
    },
  });
  await prisma.article.create({
    data: {
      id: privateArticleId,
      title: "Private Search Article",
      content: `This private article contains ${privateToken}.`,
      ownerId,
      visibility: ArticleVisibility.PRIVATE,
      status: ArticleStatus.PUBLISHED,
      publishedAt: new Date(),
    },
  });

  const { searchReadableArticles } = await import("@/lib/article-search");
  const results = await searchReadableArticles("galactic", { limit: 5 });
  const rawFts = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Article"
    WHERE "id" = ${articleId}
      AND to_tsvector('english', coalesce("title", '') || ' ' || coalesce("excerpt", '') || ' ' || coalesce("content", ''))
          @@ plainto_tsquery('english', 'ASTRONOMERS')
  `;

  assert.ok(results.articles.some((article) => article.id === articleId));
  assert.deepEqual(rawFts, [{ id: articleId }]);

  const anonymousPrivateResults = await searchReadableArticles(privateToken, { limit: 5 });
  assert.equal(
    anonymousPrivateResults.articles.some((article) => article.id === privateArticleId),
    false,
  );
  const ownerPrivateResults = await searchReadableArticles(privateToken, { limit: 5 }, ownerId);
  assert.equal(
    ownerPrivateResults.articles.some((article) => article.id === privateArticleId),
    true,
  );
});
