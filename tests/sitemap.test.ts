process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

const PUBLISHED_AT = new Date("2026-07-30T12:00:00.000Z");
const CREATED_AT = new Date("2026-07-29T12:00:00.000Z");
const UPDATED_AT = new Date("2026-07-31T12:00:00.000Z");

let failMetadataListing = false;
let legacyListingCalls = 0;
let metadataListingLimits: number[] = [];

before(() => {
  mock.module("@/lib/article-library", {
    namedExports: {
      listPublishedArticles: async () => {
        legacyListingCalls += 1;
        return [
          {
            id: "legacy-article",
            publishedAt: PUBLISHED_AT,
            createdAt: CREATED_AT,
            updatedAt: UPDATED_AT,
          },
        ];
      },
      listPublishedArticleSitemapEntries: async (limit: number) => {
        metadataListingLimits.push(limit);
        if (failMetadataListing) throw new Error("database unavailable");
        return [
          {
            id: "published-article",
            publishedAt: PUBLISHED_AT,
            createdAt: CREATED_AT,
            updatedAt: UPDATED_AT,
          },
          {
            id: "created-article",
            publishedAt: null,
            createdAt: CREATED_AT,
            updatedAt: null,
          },
        ];
      },
    },
  });
});

beforeEach(() => {
  failMetadataListing = false;
  legacyListingCalls = 0;
  metadataListingLimits = [];
});

test("sitemap lists article metadata without loading full published articles", async () => {
  const { default: sitemap } = await import("@/app/sitemap");

  const routes = await sitemap();

  assert.deepEqual(metadataListingLimits, [1000]);
  assert.equal(legacyListingCalls, 0);
  assert.equal(routes.length, 4);
  assert.equal(routes[2]?.url, "http://localhost:3000/reader/published-article");
  assert.deepEqual(routes[2]?.lastModified, PUBLISHED_AT);
  assert.equal(routes[3]?.url, "http://localhost:3000/reader/created-article");
  assert.deepEqual(routes[3]?.lastModified, CREATED_AT);
});

test("sitemap keeps static routes when the article metadata query is unavailable", async () => {
  const { default: sitemap } = await import("@/app/sitemap");
  failMetadataListing = true;

  const routes = await sitemap();

  assert.deepEqual(metadataListingLimits, [1000]);
  assert.equal(legacyListingCalls, 0);
  assert.deepEqual(
    routes.map((route) => route.url),
    ["http://localhost:3000/", "http://localhost:3000/signin"],
  );
});
