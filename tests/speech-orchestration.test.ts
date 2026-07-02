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
let deletedArticleIds: string[] = [];
let speechFindUniqueCalls = 0;

let synthesizeCalls: Array<{ text: string; articleId: string }> = [];
let synthesizeResult: { audio: Buffer; provider: "azure"; words: SpeechWord[] } | null = null;

function resetState(): void {
  cachedSpeechRow = null;
  articleRow = null;
  deletedArticleIds = [];
  speechFindUniqueCalls = 0;
  synthesizeCalls = [];
  synthesizeResult = null;
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
        put: async () => ({ storageKey: "speech/generated.mp3", sizeBytes: 5, checksum: "deadbeef" }),
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
          upsert: async () => ({ id: "media-1" }),
        },
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
  const { getOrCreateArticleSpeech } = await loadSpeech();
  cachedSpeechRow = {
    articleId: "a1",
    words: STORED_LEGACY_WORDS,
    storageKey: "speech/cached.mp3",
    mimeType: "audio/mpeg",
    voice: "en-US-Cached",
    plainText: "cached plain text",
  };
  articleRow = { content: "<p>Hello world from the article.</p>" };

  const result = await getOrCreateArticleSpeech("a1");

  assert.ok(result);
  assert.equal(result!.cached, true);
  assert.equal(result!.fallback, false);
  assert.equal(result!.voice, "en-US-Cached");
  assert.equal(result!.audio, "data:audio/mpeg;base64,QUJD");
  assert.equal(result!.plainText, "Hello world from the article.");
  assert.deepEqual(result!.words, VALID_WORDS);
  assert.equal(synthesizeCalls.length, 0, "provider must not be called on a cache hit");
});

test("getOrCreateArticleSpeech falls back to the stored plainText when the article row is gone", async () => {
  const { getOrCreateArticleSpeech } = await loadSpeech();
  cachedSpeechRow = {
    articleId: "a1",
    words: STORED_LEGACY_WORDS,
    storageKey: "speech/cached.mp3",
    mimeType: "audio/mpeg",
    voice: "en-US-Cached",
    plainText: "stored fallback text",
  };
  articleRow = null;

  const result = await getOrCreateArticleSpeech("a1");

  assert.ok(result);
  assert.equal(result!.cached, true);
  assert.equal(result!.plainText, "stored fallback text");
});

test("getOrCreateArticleSpeech treats a malformed cached row as a miss, deletes it, and regenerates", async () => {
  const { getOrCreateArticleSpeech } = await loadSpeech();
  cachedSpeechRow = {
    articleId: "a1",
    words: [{ word: "broken", offset: -1, duration: 1 }],
    storageKey: "speech/corrupt.mp3",
    mimeType: "audio/mpeg",
    voice: "en-US-Cached",
    plainText: "ignored",
  };
  articleRow = { title: "T", content: "<p>Fresh article text.</p>" };
  synthesizeResult = { audio: Buffer.from("NEW"), provider: "azure", words: VALID_WORDS };

  const result = await getOrCreateArticleSpeech("a1");

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
  const { getOrCreateArticleSpeech } = await loadSpeech();
  cachedSpeechRow = null;
  articleRow = { title: "Title", content: "<p>The quick brown fox.</p>" };
  synthesizeResult = { audio: Buffer.from("AUDIO"), provider: "azure", words: VALID_WORDS };

  const result = await getOrCreateArticleSpeech("a1");

  assert.equal(synthesizeCalls.length, 1);
  assert.equal(synthesizeCalls[0].text, "The quick brown fox.");
  assert.ok(result);
  assert.equal(result!.cached, false);
  assert.equal(result!.fallback, false);
  assert.equal(result!.mimeType, "audio/mpeg");
  assert.equal(result!.voice, "en-US-TestNeural");
  assert.equal(result!.audio, `data:audio/mpeg;base64,${Buffer.from("AUDIO").toString("base64")}`);
  assert.deepEqual(result!.words, VALID_WORDS);
});

// ---------------------------------------------------------------------------
// getOrCreateArticleSpeech — fallback / null paths
// ---------------------------------------------------------------------------

test("getOrCreateArticleSpeech returns a graceful fallback when the TTS feature flag is off", async () => {
  const { getOrCreateArticleSpeech } = await loadSpeech();
  cachedSpeechRow = null;
  articleRow = { title: "Title", content: "<p>Some readable text.</p>" };
  disableTtsFlag();

  const result = await getOrCreateArticleSpeech("a1");

  assert.ok(result);
  assert.equal(result!.fallback, true);
  assert.equal(result!.audio, null);
  assert.equal(result!.voice, DEFAULT_SPEECH_VOICE);
  assert.equal(synthesizeCalls.length, 0, "synthesis must not run when TTS is disabled");
});

test("getOrCreateArticleSpeech returns a fallback when Azure Speech credentials are absent", async () => {
  const { getOrCreateArticleSpeech } = await loadSpeech();
  cachedSpeechRow = null;
  articleRow = { title: "Title", content: "<p>Some readable text.</p>" };
  unconfigureAzure();

  const result = await getOrCreateArticleSpeech("a1");

  assert.ok(result);
  assert.equal(result!.fallback, true);
  assert.equal(result!.voice, DEFAULT_SPEECH_VOICE);
  assert.equal(synthesizeCalls.length, 0);
});

test("getOrCreateArticleSpeech returns null when the article does not exist", async () => {
  const { getOrCreateArticleSpeech } = await loadSpeech();
  cachedSpeechRow = null;
  articleRow = null;

  const result = await getOrCreateArticleSpeech("missing");

  assert.equal(result, null);
  assert.equal(synthesizeCalls.length, 0);
});

test("getOrCreateArticleSpeech returns a fallback when the article has no readable text", async () => {
  const { getOrCreateArticleSpeech } = await loadSpeech();
  cachedSpeechRow = null;
  articleRow = { title: "Title", content: "<p>   </p>" };

  const result = await getOrCreateArticleSpeech("a1");

  assert.ok(result);
  assert.equal(result!.fallback, true);
  assert.equal(result!.voice, "en-US-TestNeural");
  assert.equal(synthesizeCalls.length, 0, "empty text must short-circuit before synthesis");
});

test("getOrCreateArticleSpeech returns a fallback when synthesis yields no output", async () => {
  const { getOrCreateArticleSpeech } = await loadSpeech();
  cachedSpeechRow = null;
  articleRow = { title: "Title", content: "<p>Readable article body.</p>" };
  synthesizeResult = null;

  const result = await getOrCreateArticleSpeech("a1");

  assert.equal(synthesizeCalls.length, 1, "synthesis is attempted");
  assert.ok(result);
  assert.equal(result!.fallback, true);
  assert.equal(result!.audio, null);
  assert.equal(result!.voice, "en-US-TestNeural");
});
