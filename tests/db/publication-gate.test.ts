/**
 * Trusted-provider publication-gate integration tests (#1096, Phase 2.6).
 *
 * Engine-agnostic like `article-save-commit.test.ts`: runs on SQLite by default
 * under `npm run test:db` and PostgreSQL in CI, guarded by `enabled`
 * (RUN_DB_INTEGRATION=1). Proves against the LIVE database that:
 *
 *   - The three new DiscoverySource permission flags persist and DEFAULT FALSE
 *     (independent, additive, metadata-only columns from the dual migration).
 *   - A PUBLIC DRAFT article is HIDDEN from the public library listing and
 *     becomes visible EXACTLY when its status transitions to PUBLISHED — the
 *     visibility change tracks the publication STATE CHANGE, not discovery.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { ArticleStatus, ArticleVisibility, ArticleSourceType } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { publicListableArticleWhere } from "@/lib/article-library/policy";

import { enabled } from "./support/db-config";
import { registerIntegrationCleanup, id } from "./support/db-helpers";
import { createDiscoverySource } from "./support/discovery-fixtures";

registerIntegrationCleanup();

const articleIds = new Set<string>();

afterEach(async () => {
  if (!enabled) return;
  const ids = [...articleIds];
  if (ids.length > 0) {
    await prisma.article.deleteMany({ where: { id: { in: ids } } });
    articleIds.clear();
  }
});

async function createDraftArticle(title: string): Promise<string> {
  const articleId = id("article");
  await prisma.article.create({
    data: {
      id: articleId,
      title,
      content: "A calm article about gardening in spring.",
      sourceUrl: `https://provider.example/${articleId}`,
      visibility: ArticleVisibility.PUBLIC,
      status: ArticleStatus.DRAFT,
      sourceType: ArticleSourceType.SCRAPED,
      ownerId: null,
      organizationId: null,
    },
  });
  articleIds.add(articleId);
  return articleId;
}

function isListed(articleId: string): Promise<boolean> {
  return prisma.article
    .count({ where: publicListableArticleWhere({ id: articleId }) })
    .then((n) => n > 0);
}

test("DiscoverySource trust flags default to false and persist when set", { skip: !enabled }, async () => {
  const untrusted = await createDiscoverySource();
  assert.equal(untrusted.canFetchAuthenticated, false);
  assert.equal(untrusted.canRepublishPublicly, false);
  assert.equal(untrusted.autoPublishTrusted, false);

  const trusted = await createDiscoverySource({
    canFetchAuthenticated: true,
    canRepublishPublicly: true,
    autoPublishTrusted: true,
  });
  const reloaded = await prisma.discoverySource.findUniqueOrThrow({ where: { id: trusted.id } });
  assert.equal(reloaded.canFetchAuthenticated, true);
  assert.equal(reloaded.canRepublishPublicly, true);
  assert.equal(reloaded.autoPublishTrusted, true);
});

test("a public DRAFT is hidden and becomes listable exactly when published", { skip: !enabled }, async () => {
  const articleId = await createDraftArticle("Spring gardening draft");

  // Draft: hidden from the public library listing.
  assert.equal(await isListed(articleId), false);

  // Publication STATE CHANGE: draft → published makes it listable.
  await prisma.article.update({
    where: { id: articleId },
    data: { status: ArticleStatus.PUBLISHED, publishedAt: new Date() },
  });
  assert.equal(await isListed(articleId), true);
});
