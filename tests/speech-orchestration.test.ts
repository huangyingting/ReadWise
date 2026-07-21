/**
 * Unit tests for the speech (TTS) orchestration entry point:
 * `src/lib/speech/index.ts`.
 *
 * Covers:
 *   - isSpeechConfigured — combines the TTS feature flag with Azure Speech
 *     credential presence.
 *   - getOrCreateArticleSpeech — the full orchestration: cache hit (no
 *     provider call), corrupt cache recovery, cache miss synthesis + persist,
 *     feature-flag-off / unconfigured / empty-text / no-output fallbacks, and
 *     the missing-article null path.
 *
 * The Azure provider is MOCKED — synthesis is never actually invoked.
 * Mocks: @/lib/speech/provider-azure, @/lib/prisma, @/lib/storage.
 * No real DB, network, or Azure SDK.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { SpeechWord } from "@/lib/speech/timing";
import { DEFAULT_SPEECH_VOICE } from "@/lib/runtime-config/speech";

// ---------------------------------------------------------------------------
// Mutable stub state — reconfigured per test
// ---------------------------------------------------------------------------

type Row = Record<string, unknown> | null;

let cachedSpeechRow: Row = null;
let articleRow: Row = null;
let mediaAssetRow: Row = null;
let deletedArticleIds: string[] = [];
let speechFindUniqueCalls = 0;

let synthesizeCalls: Array<{ text: string; articleId: string }> = [];
let synthesizeResult: { audio: Buffer; provider: "azure"; words: SpeechWord[] } | null = null;
let storagePutFails = false;
let persistedTimingPayload: unknown = null;

function resetState(): void {
  cachedSpeechRow = null;
  articleRow = null;
  mediaAssetRow = null;
  deletedArticleIds = [];
  speechFindUniqueCalls = 0;
  synthesizeCalls = [];
  synthesizeResult = null;
  storagePutFails = false;
  persistedTimingPayload = null;
}

function enableTts(): void {
  delete process.env.FEATURE_TTS_ENABLED;
  process.env.AZURE_SPEECH_KEY = "test-key";
  process.env.AZURE_SPEECH_REGION = "eastus";
  process.env.AZURE_SPEECH_VOICE = "en-US-TestNeural";
  process.env.AZURE_SPEECH_OUTPUT_FORMAT = "audio-24khz-96kbitrate-mono-mp3";
}

function disableTtsFlag(): void {
  process.env.FEATURE_TTS_ENABLED = "false";
}

function unconfigureAzure(): void {
  delete process.env.AZURE_SPEECH_KEY;
  delete process.env.AZURE_SPEECH_REGION;
}

before(() => {
  mock.module("@/lib/speech/provider-azure", {
    namedExports: {
      synthesize: async (text: string, _config: unknown, articleId: string) => {
        synthesizeCalls.push({ text, articleId });
        return synthesizeResult;
      },
      resolveMimeType: () => "audio/mpeg",
    },
  });

  mock.module("@/lib/storage", {
    namedExports: {
      getMediaStorage: () => ({
        kind: "local" as const,
        get: async () => Buffer.from("ABC"),
        put: async () => {
          if (storagePutFails) throw new Error("storage unavailable");
          return { storageKey: "speech/generated.mp3", sizeBytes: 5, checksum: "deadbeef" };
        },
        delete: async () => {},
      }),
    },
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        articleSpeech: {
          findUnique: async () => {
            speechFindUniqueCalls += 1;
            // First lookup returns the configured row; a corrupt-cache retry
            // (after delete) sees no row so the miss path runs.
            return speechFindUniqueCalls === 1 ? cachedSpeechRow : null;
          },
          delete: async (args: { where: { articleId: string } }) => {
            deletedArticleIds.push(args.where.articleId);
            return {};
          },
          upsert: async () => ({}),
        },
        article: {
          findUnique: async () => articleRow,
        },
        mediaAsset: {
          findUnique: async () => mediaAssetRow,
          upsert: async () => ({ id: "media-1" }),
        },
        $transaction: async (
          callback: (tx: {
            articleSpeech: {
              upsert: (args: { create: { words: unknown } }) => Promise<Record<string, never>>;
            };
            mediaAsset: { upsert: () => Promise<{ id: string }> };
          }) => Promise<unknown>,
        ) =>
          callback({
            articleSpeech: {
              upsert: async (args) => {
                persistedTimingPayload = args.create.words;
                return {};
              },
            },
            mediaAsset: { upsert: async () => ({ id: "media-1" }) },
          }),
      },
    },
  });
});

beforeEach(() => {
  resetState();
  enableTts();
});

async function loadSpeech() {
  return import("@/lib/speech");
}

const VALID_WORDS = [
  { word: "hello", startMs: 0, endMs: 400 },
  { word: "world", startMs: 500, endMs: 1100 },
];

const STORED_LEGACY_WORDS = [
  { word: "hello", offset: 0, duration: 400 },
  { word: "world", offset: 500, duration: 600 },
];

async function getOrCreateSpeech(articleId = "a1") {
  const { getOrCreateArticleSpeech } = await loadSpeech();
  return getOrCreateArticleSpeech(articleId);
}

function cachedSpeech(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    articleId: "a1",
    mediaAssetId: "media-1",
    words: STORED_LEGACY_WORDS,
    ...overrides,
  };
}

function readableArticle(content = "<p>Some readable text.</p>", title = "Title"): Record<string, unknown> {
  return { title, content };
}

function synthesizeSuccess(audio = "AUDIO"): void {
  synthesizeResult = { audio: Buffer.from(audio), provider: "azure", words: VALID_WORDS };
}

// ---------------------------------------------------------------------------
// isSpeechConfigured
// ---------------------------------------------------------------------------

test("isSpeechConfigured is true when the TTS flag is on and Azure credentials are present", async () => {
  const { isSpeechConfigured } = await loadSpeech();
  enableTts();
  assert.equal(isSpeechConfigured(), true);
});

test("isSpeechConfigured is false when the TTS feature flag is disabled", async () => {
  const { isSpeechConfigured } = await loadSpeech();
  disableTtsFlag();
  assert.equal(isSpeechConfigured(), false);
});

test("isSpeechConfigured is false when Azure Speech credentials are missing", async () => {
  const { isSpeechConfigured } = await loadSpeech();
  unconfigureAzure();
  assert.equal(isSpeechConfigured(), false);
});

// ---------------------------------------------------------------------------
// getOrCreateArticleSpeech — cache hit
// ---------------------------------------------------------------------------

test("getOrCreateArticleSpeech returns cached speech without calling the provider on a cache hit", async () => {
  cachedSpeechRow = cachedSpeech();
  articleRow = { content: "<p>Hello world from the article.</p>" };
  mediaAssetRow = {
    storageKey: "speech/cached.mp3",
    mimeType: "audio/mpeg",
    voice: "en-US-Cached",
  };

  const result = await getOrCreateSpeech();

  assert.ok(result);
  assert.equal(result!.cached, true);
  assert.equal(result!.fallback, false);
  assert.equal(result!.voice, "en-US-Cached");
  assert.equal("audio" in result!, false);
  assert.equal(result!.plainText, "Hello world from the article.");
  assert.deepEqual(result!.words, VALID_WORDS);
  assert.equal(synthesizeCalls.length, 0, "provider must not be called on a cache hit");
});

test("getOrCreateArticleSpeech derives full text for cached batch narration", async () => {
  const fullText = `Hello ${"world ".repeat(1_000)}`.trim();
  cachedSpeechRow = cachedSpeech({
    words: {
      version: 2,
      provider: "azure-batch",
      timeUnit: "ms",
      textUnit: "utf16",
      words: ["Hello"],
      startMs: [0],
      endMs: [400],
      textStart: [0],
      textEnd: [5],
    },
  });
  articleRow = { content: `<p>${fullText}</p>` };
  mediaAssetRow = {
    storageKey: "speech/cached.mp3",
    mimeType: "audio/mpeg",
    voice: "en-US-Cached",
  };

  const result = await getOrCreateSpeech();

  assert.ok(result);
  assert.equal(result!.plainText, fullText);
  assert.ok(result!.plainText.length > 5_000);
});

test("getOrCreateArticleSpeech reconstructs the capped text basis for cached batch narration", async () => {
  cachedSpeechRow = cachedSpeech({
    words: {
      version: 2,
      provider: "azure-batch",
      timeUnit: "ms",
      textUnit: "utf16",
      textBasis: { kind: "paragraph-limit", maxChars: 10 },
      words: ["First"],
      startMs: [0],
      endMs: [400],
      textStart: [0],
      textEnd: [5],
    },
  });
  articleRow = { content: "<p>First paragraph.</p><p>Second paragraph.</p>" };
  mediaAssetRow = {
    storageKey: "speech/cached.mp3",
    mimeType: "audio/mpeg",
    voice: "en-US-Cached",
  };

  const result = await getOrCreateSpeech();

  assert.ok(result);
  assert.equal(result!.plainText, "First para");
});

test("getOrCreateArticleSpeech returns null when a dangling cache row has no article", async () => {
  cachedSpeechRow = cachedSpeech();
  mediaAssetRow = {
    storageKey: "speech/cached.mp3",
    mimeType: "audio/mpeg",
    voice: "en-US-Cached",
  };
  articleRow = null;

  const result = await getOrCreateSpeech();

  assert.equal(result, null);
});

test("getOrCreateArticleSpeech uses the default voice when cached asset metadata is unavailable", async () => {
  cachedSpeechRow = cachedSpeech();
  articleRow = { content: "<p>Hello world.</p>" };
  mediaAssetRow = null;

  const result = await getOrCreateSpeech();

  assert.ok(result);
  assert.equal(result!.voice, DEFAULT_SPEECH_VOICE);
});

test("getOrCreateArticleSpeech treats a malformed cached row as a miss, deletes it, and regenerates", async () => {
  cachedSpeechRow = cachedSpeech({
    words: [{ word: "broken", offset: -1, duration: 1 }],
  });
  articleRow = readableArticle("<p>Fresh article text.</p>", "T");
  synthesizeSuccess("NEW");

  const result = await getOrCreateSpeech();

  assert.deepEqual(deletedArticleIds, ["a1"], "corrupt row must be deleted");
  assert.equal(synthesizeCalls.length, 1, "regeneration must synthesize once");
  assert.ok(result);
  assert.equal(result!.cached, false);
  assert.equal(result!.fallback, false);
});

// ---------------------------------------------------------------------------
// getOrCreateArticleSpeech — cache miss synthesis
// ---------------------------------------------------------------------------

test("getOrCreateArticleSpeech synthesizes and persists fresh audio on a cache miss", async () => {
  cachedSpeechRow = null;
  articleRow = readableArticle("<p>The quick brown fox.</p>");
  synthesizeSuccess();

  const result = await getOrCreateSpeech();

  assert.equal(synthesizeCalls.length, 1);
  assert.equal(synthesizeCalls[0].text, "The quick brown fox.");
  assert.ok(result);
  assert.equal(result!.cached, false);
  assert.equal(result!.fallback, false);
  assert.equal(result!.mimeType, "audio/mpeg");
  assert.equal(result!.voice, "en-US-TestNeural");
  assert.equal("audio" in result!, false);
  assert.deepEqual(result!.words, VALID_WORDS);
  assert.deepEqual(
    (persistedTimingPayload as { textBasis?: unknown }).textBasis,
    { kind: "character-limit", maxChars: 5_000 },
  );
});

test("getOrCreateArticleSpeech reports storage persistence failure as recoverable fallback", async () => {
  cachedSpeechRow = null;
  articleRow = readableArticle("<p>The quick brown fox.</p>");
  synthesizeSuccess("RECOVERABLE");
  storagePutFails = true;

  const result = await getOrCreateSpeech();

  assert.equal(synthesizeCalls.length, 1);
  assert.ok(result);
  assert.equal(result!.cached, false);
  assert.equal(result!.fallback, true);
  assert.equal(result!.fallbackReason, "storage_unavailable");
  assert.equal("audio" in result!, false);
});

// ---------------------------------------------------------------------------
// getOrCreateArticleSpeech — fallback / null paths
// ---------------------------------------------------------------------------

test("getOrCreateArticleSpeech returns a graceful fallback when the TTS feature flag is off", async () => {
  cachedSpeechRow = null;
  articleRow = readableArticle();
  disableTtsFlag();

  const result = await getOrCreateSpeech();

  assert.ok(result);
  assert.equal(result!.fallback, true);
  assert.equal(result!.fallbackReason, "tts_unconfigured");
  assert.equal("audio" in result!, false);
  assert.equal(result!.voice, DEFAULT_SPEECH_VOICE);
  assert.equal(synthesizeCalls.length, 0, "synthesis must not run when TTS is disabled");
});

test("getOrCreateArticleSpeech returns a fallback when Azure Speech credentials are absent", async () => {
  cachedSpeechRow = null;
  articleRow = readableArticle();
  unconfigureAzure();

  const result = await getOrCreateSpeech();

  assert.ok(result);
  assert.equal(result!.fallback, true);
  assert.equal(result!.fallbackReason, "tts_unconfigured");
  assert.equal(result!.voice, DEFAULT_SPEECH_VOICE);
  assert.equal(synthesizeCalls.length, 0);
});

test("getOrCreateArticleSpeech returns null when the article does not exist", async () => {
  cachedSpeechRow = null;
  articleRow = null;

  const result = await getOrCreateSpeech("missing");

  assert.equal(result, null);
  assert.equal(synthesizeCalls.length, 0);
});

test("getOrCreateArticleSpeech returns a fallback when the article has no readable text", async () => {
  cachedSpeechRow = null;
  articleRow = readableArticle("<p>   </p>");

  const result = await getOrCreateSpeech();

  assert.ok(result);
  assert.equal(result!.fallback, true);
  assert.equal(result!.voice, "en-US-TestNeural");
  assert.equal(synthesizeCalls.length, 0, "empty text must short-circuit before synthesis");
});

test("getOrCreateArticleSpeech returns a fallback when synthesis yields no output", async () => {
  cachedSpeechRow = null;
  articleRow = readableArticle("<p>Readable article body.</p>");
  synthesizeResult = null;

  const result = await getOrCreateSpeech();

  assert.equal(synthesizeCalls.length, 1, "synthesis is attempted");
  assert.ok(result);
  assert.equal(result!.fallback, true);
  assert.equal("audio" in result!, false);
  assert.equal(result!.voice, "en-US-TestNeural");
});
