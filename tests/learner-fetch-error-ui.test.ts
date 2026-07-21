/**
 * Source-level UI wiring tests for learner fetch error + retry states (#1218).
 *
 * These client islands used to fail closed or render hand-rolled static error
 * text. The assertions follow the repo convention: source-string checks for
 * shared primitives/a11y plus mocked client-fetch calls for exact endpoints.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const WORKTREE = resolve(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(join(WORKTREE, relPath), "utf8");
}

type GetCall = { url: string };
let getCalls: GetCall[] = [];
let clientFetch: typeof import("@/lib/client-fetch");

before(async () => {
  mock.module("@/lib/client-fetch", {
    namedExports: {
      getJson: async (url: string) => {
        getCalls.push({ url });
        return { lists: [], words: [], articles: {}, total: 0, page: 1, totalPages: 1, pageSize: 20 };
      },
      postJson: async () => ({ ok: true }),
      deleteJson: async () => ({ ok: true }),
    },
  });
  clientFetch = await import("@/lib/client-fetch");
});

beforeEach(() => {
  getCalls = [];
});

test("mocked client-fetch records saved-words and list membership endpoints", async () => {
  await clientFetch.getJson("/api/study/words?q=term");
  await clientFetch.getJson("/api/bookmarks/membership?articleId=article-1");

  assert.deepEqual(getCalls.map((call) => call.url), [
    "/api/study/words?q=term",
    "/api/bookmarks/membership?articleId=article-1",
  ]);
});

test("VocabularyJournal wires useFilteredFetch errors to a retryable stale-results alert", () => {
  const src = readSrc("src/components/VocabularyJournal.tsx");

  assert.ok(src.includes("fetchError"), "tracks filtered fetch failures");
  assert.ok(src.includes("onError"), "uses useFilteredFetch onError");
  assert.ok(src.includes("setFetchError(null)"), "clears fetchError on success");
  assert.ok(src.includes("lastWordsQueryRef"), "remembers the last query for retry");
  assert.ok(src.includes("retryFetchWords"), "has a retry handler");
  assert.ok(src.includes("<PanelError"), "uses the shared error primitive");
  assert.ok(src.includes("<Button"), "uses the Button primitive for retry");
  assert.ok(src.includes("Retry"), "offers retry copy");
  assert.ok(src.includes("may be stale"), "labels stale results while keeping them visible");
  assert.ok(src.includes("`/api/study/words?${queryString}`"), "retry uses the same query endpoint");
});

test("ListPickerPopover replaces hand-rolled load states with panel primitives and retry", () => {
  const src = readSrc("src/components/ListPickerPopover.tsx");

  assert.ok(src.includes("loadMembership"), "extracts membership loading for retry");
  assert.ok(src.includes("membershipEndpoint"), "reuses the same endpoint on retry");
  assert.ok(src.includes("<PanelLoading"), "uses shared loading primitive");
  assert.ok(src.includes("<PanelFallback"), "uses shared fallback primitive");
  assert.ok(src.includes("<PanelError"), "uses shared error primitive");
  assert.ok(src.includes("<Button"), "uses Button primitive");
  assert.ok(src.includes("Retry"), "offers retry copy");
  assert.ok(!src.includes("<Spinner"), "does not hand-roll a spinner in the popover");
  assert.ok(!src.includes("style={{ scrollbarWidth"), "does not use inline scrollbar styles");
});

test("LevelRecommendationBanner exposes fetch/update errors and token-driven accents", () => {
  const src = readSrc("src/components/LevelRecommendationBanner.tsx");

  assert.ok(src.includes("loadRecommendation"), "extracts recommendation fetch for retry");
  assert.ok(src.includes('fetch("/api/level-recommendation")'), "keeps the recommendation endpoint");
  assert.ok(src.includes('fetch("/api/profile"'), "keeps the profile update endpoint");
  assert.ok(src.includes("loadError"), "tracks load errors");
  assert.ok(src.includes("applyError"), "tracks profile update errors");
  assert.ok(src.includes("<PanelError"), "uses shared error primitive");
  assert.ok(src.includes("Retry update"), "offers a retry for update failures");
  assert.ok(src.includes("text-success"), "uses token-backed success classes");
  assert.ok(src.includes("text-warning"), "uses token-backed warning classes");
  assert.ok(!src.includes("style={{"), "does not use inline accent styles");
});

test("OfflineDownloadButton surfaces unsupported/storage errors with retryable primitives", () => {
  const src = readSrc("src/components/OfflineDownloadButton.tsx");

  assert.ok(src.includes('"checking"'), "has an explicit initial checking state");
  assert.ok(src.includes("checkOfflineAvailability"), "extracts storage check for retry");
  assert.ok(src.includes("setState(\"unsupported\")"), "tracks unsupported storage explicitly");
  assert.ok(src.includes("Offline unavailable"), "renders unsupported copy");
  assert.ok(src.includes("<Tooltip"), "explains unsupported state with Tooltip");
  assert.ok(src.includes("<PanelError"), "uses shared error primitive");
  assert.ok(src.includes("errorMode"), "distinguishes storage-check and download retries");
  assert.ok(src.includes("Retry"), "offers retry copy");
  assert.ok(!src.includes("catch(() => {\n        if (!cancelled) setState(\"idle\")"), "does not fail closed to idle");
  assert.ok(!src.includes("if (state === \"unsupported\") return null"), "does not hide unsupported state");
});

for (const rel of [
  "src/components/VocabularyJournal.tsx",
  "src/components/ListPickerPopover.tsx",
  "src/components/LevelRecommendationBanner.tsx",
  "src/components/OfflineDownloadButton.tsx",
]) {
  test(`${rel} is token-driven (no raw hex, no inline font-size/style)`, () => {
    const src = readSrc(rel).replace(/#\d+/g, "");
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), "must not use a raw hex colour");
    assert.ok(!src.includes("fontSize"), "must not set an inline fontSize");
    assert.ok(!src.includes("style={{"), "must not use inline styles");
  });
}
