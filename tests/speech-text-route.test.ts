/**
 * Tests for GET /api/reader/[id]/speech/text — narration text for on-device
 * synthesis. Mocks auth + article access; no DB, no speech provider.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { withParams, getReq } from "./support/route";
import { type AuthState, sessionAuthExports } from "./support/auth-mock";

let authState: AuthState = "ok";
let readableArticle: { id: string; title: string; content: string } | null = null;
let rateLimitCalls = 0;

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: sessionAuthExports(() => authState),
  });
  mock.module("@/lib/article-library", {
    namedExports: {
      articleAccessContextForUser: async (user: unknown) => ({
        userId: (user as { id?: string })?.id ?? null,
        role: (user as { role?: string })?.role ?? null,
      }),
      getReadableArticleById: async () => readableArticle,
    },
  });
  mock.module("@/lib/security/rate-limit/index", {
    namedExports: {
      checkRateLimit: async () => {
        rateLimitCalls++;
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  readableArticle = {
    id: "a1",
    title: "T",
    content: "<p>First paragraph here.</p><p>Second &amp; final paragraph.</p>",
  };
  rateLimitCalls = 0;
});

async function callGet(id: string) {
  const { GET } = await import("@/app/api/reader/[id]/speech/text/route");
  return GET(getReq(`http://test/api/reader/${id}/speech/text`), withParams({ id }));
}

test("GET /speech/text returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await callGet("a1");
  assert.equal(res.status, 401);
});

test("GET /speech/text returns 404 when the article is not readable", async () => {
  readableArticle = null;
  const res = await callGet("a1");
  assert.equal(res.status, 404);
});

test("GET /speech/text returns the full reader plain text without spending AI quota", async () => {
  const res = await callGet("a1");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "private, no-store");
  const body = (await res.json()) as { plainText: string };
  assert.match(body.plainText, /^First paragraph here\.\s+Second & final paragraph\.$/);
  assert.equal(rateLimitCalls, 0);
});
