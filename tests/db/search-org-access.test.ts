import assert from "node:assert/strict";
import { test } from "node:test";

import { ArticleStatus, ArticleVisibility } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { searchReadableArticles } from "@/lib/search/providers";

import { enabled } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";

registerIntegrationCleanup();

function resultIds(results: { articles: Array<{ id: string }> }): string[] {
  return results.articles.map((article) => article.id);
}

test("searchReadableArticles returns ORG articles for members and hides them from non-members", { skip: !enabled }, async () => {
  const memberId = id("search_member");
  const nonMemberId = id("search_nonmember");
  const orgId = id("search_org");
  const articleId = id("search_org_article");
  const token = id("searchtoken");

  await prisma.user.createMany({
    data: [
      { id: memberId, name: "Search Org Member", role: "Reader" },
      { id: nonMemberId, name: "Search Non Member", role: "Reader" },
    ],
  });
  await prisma.organization.create({
    data: { id: orgId, name: "Search Org", slug: orgId },
  });
  await prisma.membership.create({ data: { userId: memberId, orgId } });
  await prisma.article.create({
    data: {
      id: articleId,
      title: `Org Search ${token}`,
      content: `Member-only article for ${token}.`,
      status: ArticleStatus.PUBLISHED,
      visibility: ArticleVisibility.ORG,
      organizationId: orgId,
      publishedAt: new Date(),
    },
  });

  const memberResults = await searchReadableArticles(token, { limit: 10 }, memberId);
  const nonMemberResults = await searchReadableArticles(token, { limit: 10 }, nonMemberId);

  assert.deepEqual(resultIds(memberResults), [articleId]);
  assert.equal(resultIds(nonMemberResults).includes(articleId), false);
});
