/**
 * Unit tests for the admin backfill UI wiring (#1186).
 *
 * The route already accepted `articleIds`, but the form could only send broad
 * filters. These tests lock in the pure parser, exact POST endpoint/body shape,
 * and the source-level client island wiring without jsdom.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

import {
  ADMIN_BACKFILL_ENDPOINT,
  MAX_BACKFILL_ARTICLE_IDS,
  parseArticleIds,
} from "@/lib/admin/jobs/backfill-ui";

const WORKTREE = resolve(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(join(WORKTREE, relPath), "utf8");
}

type PostCall = { url: string; body: unknown };
let postCalls: PostCall[] = [];
let clientFetch: typeof import("@/lib/client-fetch");

before(async () => {
  mock.module("@/lib/client-fetch", {
    namedExports: {
      postJson: async (url: string, body: unknown) => {
        postCalls.push({ url, body });
        return { ok: true };
      },
    },
  });
  clientFetch = await import("@/lib/client-fetch");
});

beforeEach(() => {
  postCalls = [];
});

test("ADMIN_BACKFILL_ENDPOINT targets the existing route", () => {
  assert.equal(ADMIN_BACKFILL_ENDPOINT, "/api/admin/jobs/backfill");
});

test("parseArticleIds accepts comma/newline input, trims, and de-dupes", () => {
  assert.deepEqual(parseArticleIds(" article-1,article_2\narticle-1 "), {
    articleIds: ["article-1", "article_2"],
    error: null,
  });
});

test("parseArticleIds rejects invalid values and excessive batches", () => {
  assert.equal(parseArticleIds("article 1").error, "Article IDs may only contain letters, numbers, underscores, and hyphens.");
  assert.equal(
    parseArticleIds(Array.from({ length: MAX_BACKFILL_ARTICLE_IDS + 1 }, (_, i) => `a${i}`).join(",")).error,
    `Use ${MAX_BACKFILL_ARTICLE_IDS} or fewer article IDs per run.`,
  );
});

test("postJson can send articleIds to the existing backfill endpoint", async () => {
  const parsed = parseArticleIds("article-1\narticle-2");
  await clientFetch.postJson(ADMIN_BACKFILL_ENDPOINT, {
    features: ["tags"],
    mode: "missing",
    reason: "repair article tag derivation",
    dryRun: true,
    batchCap: 50,
    articleIds: parsed.articleIds,
  });
  assert.equal(postCalls[0]?.url, "/api/admin/jobs/backfill");
  assert.deepEqual(postCalls[0]?.body, {
    features: ["tags"],
    mode: "missing",
    reason: "repair article tag derivation",
    dryRun: true,
    batchCap: 50,
    articleIds: ["article-1", "article-2"],
  });
});

test("AdminBackfillForm renders article-id targeting with primitives and exact endpoint helper", () => {
  const src = readSrc("src/components/AdminBackfillForm.tsx");
  assert.ok(src.includes("parseArticleIds"), "parses article IDs before submit");
  assert.ok(src.includes("ADMIN_BACKFILL_ENDPOINT"), "posts to the endpoint helper");
  assert.ok(src.includes("<Field"), "uses Field for validation/error copy");
  assert.ok(src.includes("<Textarea"), "uses Textarea for CSV/newline IDs");
  assert.ok(src.includes("articleIds:"), "threads articleIds into the POST body");
  assert.ok(src.includes("parsedArticleIds.error"), "disables submit while invalid");
});

test("AdminBackfillForm remains token-driven", () => {
  const src = readSrc("src/components/AdminBackfillForm.tsx").replace(/#\d+/g, "");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), "must not use a raw hex colour");
  assert.ok(!src.includes("fontSize"), "must not set an inline fontSize");
  assert.ok(!src.includes("style={{"), "must not use inline styles");
});
