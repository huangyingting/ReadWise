process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Session } from "next-auth";
import { Prisma } from "@prisma/client";
import type { ScrapedArticle } from "@/lib/scraper/types";
import type { UrlImportDeps } from "@/lib/import/url-import";

const req = new Request("http://localhost/api/articles/import", { method: "POST" });
const session = { user: { id: "user-1", role: "Reader" }, expires: "2099-01-01" } as Session;

const scraped: ScrapedArticle = {
  title: "Imported Article",
  author: null,
  source: "example.com",
  sourceUrl: "https://example.com/canonical",
  heroImage: null,
  excerpt: null,
  content: `<p>${"word ".repeat(60)}</p>`,
  category: "science",
  wordCount: 60,
  readingMinutes: 1,
  publishedAt: null,
};

function p2002(): Error {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["sourceUrl", "ownerId"] },
  });
}

function deps(overrides: Partial<UrlImportDeps> = {}): UrlImportDeps {
  return {
    assertSafeUrl: async () => {},
    findOwnedArticleBySourceUrl: async () => null,
    scrape: async () => ({ ...scraped }),
    assertWithinDailyQuota: async () => {},
    db: {
      $transaction: async (fn) =>
        fn({
          article: {
            create: async () => ({ id: "created-id" }),
            update: async () => ({}),
          },
        }),
    },
    recordAuditFromRequest: async () => {},
    recordSecurityEvent: () => {},
    recordEvent: async () => {},
    ...overrides,
  };
}

test("URL import returns a duplicate when canonical sourceUrl is already owned", async () => {
  const { importArticleFromUrl } = await import("@/lib/import/url-import");
  let quotaCalled = false;

  const result = await importArticleFromUrl({
    rawUrl: "https://example.com/raw",
    userId: "user-1",
    req,
    session,
    requestId: "request-1",
    deps: deps({
      findOwnedArticleBySourceUrl: async (url) =>
        url === "https://example.com/canonical" ? { id: "canonical-id" } : null,
      assertWithinDailyQuota: async () => {
        quotaCalled = true;
      },
    }),
  });

  assert.deepEqual(result, { status: 200, id: "canonical-id", duplicate: true });
  assert.equal(quotaCalled, false);
});

test("URL import resolves a concurrent P2002 insert as a duplicate", async () => {
  const { importArticleFromUrl } = await import("@/lib/import/url-import");
  let lookupCount = 0;

  const result = await importArticleFromUrl({
    rawUrl: "https://example.com/raw",
    userId: "user-1",
    req,
    session,
    requestId: "request-2",
    deps: deps({
      findOwnedArticleBySourceUrl: async () => {
        lookupCount++;
        return lookupCount >= 3 ? { id: "race-winner" } : null;
      },
      db: {
        $transaction: async (fn) =>
          fn({
            article: {
              create: async () => {
                throw p2002();
              },
              update: async () => ({}),
            },
          }),
      },
    }),
  });

  assert.deepEqual(result, { status: 200, id: "race-winner", duplicate: true });
});

test("URL import rethrows non-P2002 transaction failures", async () => {
  const { importArticleFromUrl } = await import("@/lib/import/url-import");

  await assert.rejects(
    () =>
      importArticleFromUrl({
        rawUrl: "https://example.com/raw",
        userId: "user-1",
        req,
        session,
        requestId: "request-3",
        deps: deps({
          db: {
            $transaction: async () => {
              throw new Error("write failed");
            },
          },
        }),
      }),
    /write failed/,
  );
});

test("URL import succeeds when deterministic difficulty persistence fails", async () => {
  const { importArticleFromUrl } = await import("@/lib/import/url-import");

  const result = await importArticleFromUrl({
    rawUrl: "https://example.com/canonical",
    userId: "user-1",
    req,
    session,
    requestId: "request-4",
    deps: deps({
      db: {
        $transaction: async (fn) =>
          fn({
            article: {
              create: async () => ({ id: "created-without-difficulty" }),
              update: async () => {
                throw new Error("difficulty write failed");
              },
            },
          }),
      },
    }),
  });

  assert.deepEqual(result, { status: 201, id: "created-without-difficulty" });
});
