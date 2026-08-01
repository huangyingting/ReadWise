/**
 * Unit tests for the speech (TTS) repository/storage adapter:
 * `src/lib/speech/repository.ts`.
 *
 * Covers:
 *   - parseStoredSpeechWords — pure JSON parsing of stored timings (valid,
 *     empty, and the many malformed shapes that map to a null/corrupt result).
 *   - resolveStoredSpeechMediaMetadata — canonical media metadata resolution.
 *   - saveSpeechResult — storage-unconfigured skip, successful storage write,
 *     storage-failure skip, and blob cleanup after DB persistence failure.
 *
 * Mocks: @/lib/prisma and @/lib/storage. No real DB, network, or Azure SDK.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { MediaStorage, PutMediaInput, PutMediaResult } from "@/lib/storage";

// ---------------------------------------------------------------------------
// Mutable stub state — reconfigured per test
// ---------------------------------------------------------------------------

type UpsertArgs = { where: Record<string, unknown>; update: Record<string, unknown>; create: Record<string, unknown>; select?: Record<string, unknown> };

let storageImpl: MediaStorage | null = null;
let articleSpeechFindRow: { mediaAssetId: string | null } | null = null;
let mediaAssetFindRow: { storageKey: string | null; mimeType: string; voice: string | null } | null = null;
let mediaAssetUpsertArgs: UpsertArgs | null = null;
let articleSpeechUpsertArgs: UpsertArgs | null = null;
let transactionThrows: Error | null = null;
let loggerEntries: Array<{ event: string; meta?: Record<string, unknown> }> = [];

function resetState(): void {
  storageImpl = null;
  articleSpeechFindRow = null;
  mediaAssetFindRow = null;
  mediaAssetUpsertArgs = null;
  articleSpeechUpsertArgs = null;
  transactionThrows = null;
  loggerEntries = [];
}

before(() => {
  mock.module("@/lib/observability/logger", {
    namedExports: {
      createLogger: () => ({
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: (event: string, meta?: Record<string, unknown>) => {
          loggerEntries.push({ event, meta });
        },
      }),
    },
  });
  mock.module("@/lib/storage", {
    namedExports: {
      getMediaStorage: () => storageImpl,
    },
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        articleSpeech: {
          findUnique: async () => articleSpeechFindRow,
        },
        mediaAsset: {
          findUnique: async () => mediaAssetFindRow,
        },
        $transaction: async (
          callback: (tx: {
            mediaAsset: { upsert: (args: UpsertArgs) => Promise<{ id: string }> };
            articleSpeech: { upsert: (args: UpsertArgs) => Promise<{ articleId: string }> };
          }) => Promise<unknown>,
        ) => {
          if (transactionThrows) throw transactionThrows;
          return callback({
            mediaAsset: {
              upsert: async (args: UpsertArgs) => {
                mediaAssetUpsertArgs = args;
                return { id: "media-1" };
              },
            },
            articleSpeech: {
              upsert: async (args: UpsertArgs) => {
                articleSpeechUpsertArgs = args;
                return { articleId: (args.where as { articleId: string }).articleId };
              },
            },
          });
        },
      },
    },
  });
});

beforeEach(() => {
  resetState();
});

async function loadRepo() {
  return import("@/lib/speech/repository");
}

function assertParseRejects<Raw>(parseStoredSpeechWords: (value: Raw) => unknown, values: Raw[]): void {
  for (const value of values) {
    assert.equal(parseStoredSpeechWords(value), null);
  }
}

/** Build a scriptable in-memory MediaStorage. */
function makeStorage(opts: {
  put?: (input: PutMediaInput) => Promise<PutMediaResult>;
  get?: (key: string) => Promise<Buffer | null>;
  delete?: (key: string) => Promise<void>;
}): MediaStorage {
  return {
    kind: "local",
    put:
      opts.put ??
      (async () => ({ storageKey: "speech/abc", sizeBytes: 3, checksum: "deadbeef" })),
    get: opts.get ?? (async () => null),
    delete: opts.delete ?? (async () => {}),
  };
}

// ---------------------------------------------------------------------------
// parseStoredSpeechWords
// ---------------------------------------------------------------------------

test("parseStoredSpeechWords returns null for null or undefined input", async () => {
  const { parseStoredSpeechWords } = await loadRepo();
  assertParseRejects(parseStoredSpeechWords, [null, undefined]);
});

test("parseStoredSpeechWords returns null when the stored value is not an array", async () => {
  const { parseStoredSpeechWords } = await loadRepo();
  assertParseRejects(parseStoredSpeechWords, [
    "not-an-array",
    42,
    { word: "hi", offset: 0, duration: 1 },
  ]);
});

test("parseStoredSpeechWords returns null when an item is null, a primitive, or a nested array", async () => {
  const { parseStoredSpeechWords } = await loadRepo();
  assertParseRejects(parseStoredSpeechWords, [
    [null],
    ["hello"],
    [[{ word: "x", offset: 0, duration: 1 }]],
  ]);
});

test("parseStoredSpeechWords returns null when word is missing, non-string, or blank", async () => {
  const { parseStoredSpeechWords } = await loadRepo();
  assertParseRejects(parseStoredSpeechWords, [
    [{ offset: 0, duration: 1 }],
    [{ word: 123, offset: 0, duration: 1 }],
    [{ word: "   ", offset: 0, duration: 1 }],
  ]);
});

test("parseStoredSpeechWords returns null for non-finite or negative offset/duration", async () => {
  const { parseStoredSpeechWords } = await loadRepo();
  assertParseRejects(parseStoredSpeechWords, [
    [{ word: "a", offset: Number.NaN, duration: 1 }],
    [{ word: "a", offset: 0, duration: "1" }],
    [{ word: "a", offset: -1, duration: 1 }],
    [{ word: "a", offset: 0, duration: -1 }],
  ]);
});

test("parseStoredSpeechWords returns an empty array for an empty stored array", async () => {
  const { parseStoredSpeechWords } = await loadRepo();
  assert.deepEqual(parseStoredSpeechWords([]), []);
});

test("parseStoredSpeechWords parses valid words and sorts them by ascending offset", async () => {
  const { parseStoredSpeechWords } = await loadRepo();
  const result = parseStoredSpeechWords([
    { word: "world", offset: 500, duration: 200, textOffset: 6, wordLength: 5 },
    { word: "hello", offset: 0, duration: 400 },
    { word: "there", offset: 100, duration: 50, extra: "ignored" },
  ]);
  assert.deepEqual(result, [
    { word: "hello", startMs: 0, endMs: 400 },
    { word: "there", startMs: 100, endMs: 150 },
    { word: "world", startMs: 500, endMs: 700, textStart: 6, textEnd: 11 },
  ]);
});

test("parseStoredSpeechWords parses versioned V2 columnar payloads", async () => {
  const { parseStoredSpeechWords } = await loadRepo();
  assert.deepEqual(
    parseStoredSpeechWords({
      version: 2,
      provider: "azure",
      timeUnit: "ms",
      textUnit: "utf16",
      words: ["hello", "world"],
      startMs: [0, 500],
      endMs: [400, 1100],
      textStart: [0, 6],
      textEnd: [5, 11],
    }),
    [
      { word: "hello", startMs: 0, endMs: 400, textStart: 0, textEnd: 5 },
      { word: "world", startMs: 500, endMs: 1100, textStart: 6, textEnd: 11 },
    ],
  );
});

test("parseStoredSpeechWords rejects incomplete or invalid text offsets", async () => {
  const { parseStoredSpeechWords } = await loadRepo();
  assertParseRejects(parseStoredSpeechWords, [
    [{ word: "a", offset: 0, duration: 1, textOffset: 0 }],
    [{ word: "a", offset: 0, duration: 1, wordLength: 1 }],
    [{ word: "a", offset: 0, duration: 1, textOffset: -1, wordLength: 1 }],
    [{ word: "a", offset: 0, duration: 1, textOffset: 0, wordLength: 0 }],
  ]);
});

// ---------------------------------------------------------------------------
// resolveStoredSpeechMediaMetadata
// ---------------------------------------------------------------------------

test("resolveStoredSpeechMediaMetadata returns null when there is no media asset", async () => {
  const { resolveStoredSpeechMediaMetadata } = await loadRepo();
  assert.equal(await resolveStoredSpeechMediaMetadata({ mediaAssetId: null }), null);
});

test("resolveStoredSpeechMediaMetadata reports unavailable when storage is unconfigured", async () => {
  const { resolveStoredSpeechMediaMetadata } = await loadRepo();
  mediaAssetFindRow = {
    storageKey: "speech/abc",
    mimeType: "audio/mpeg",
    voice: "en-US-Test",
  };
  storageImpl = null;
  const media = await resolveStoredSpeechMediaMetadata({
    mediaAssetId: "media-1",
  });
  assert.deepEqual(media, {
    available: false,
    mimeType: "audio/mpeg",
    voice: "en-US-Test",
  });
});

test("resolveStoredSpeechMediaMetadata does not load audio bytes", async () => {
  const { resolveStoredSpeechMediaMetadata } = await loadRepo();
  let requestedKey: string | null = null;
  mediaAssetFindRow = {
    storageKey: "speech/missing",
    mimeType: "audio/mpeg",
    voice: null,
  };
  storageImpl = makeStorage({
    get: async (key) => {
      requestedKey = key;
      return null;
    },
  });
  const media = await resolveStoredSpeechMediaMetadata({
    mediaAssetId: "media-1",
  });
  assert.equal(requestedKey, null);
  assert.deepEqual(media, {
    available: true,
    mimeType: "audio/mpeg",
    voice: null,
  });
});

// ---------------------------------------------------------------------------
// getArticleSpeechAudio
// ---------------------------------------------------------------------------

test("getArticleSpeechAudio returns null for missing speech and media rows", async () => {
  const { getArticleSpeechAudio } = await loadRepo();

  assert.equal(await getArticleSpeechAudio("missing-speech"), null);

  articleSpeechFindRow = { mediaAssetId: "missing-media" };
  assert.equal(await getArticleSpeechAudio("missing-media"), null);
});

test("getArticleSpeechAudio treats unavailable or missing storage bytes as a cache miss", async () => {
  const { getArticleSpeechAudio } = await loadRepo();
  articleSpeechFindRow = { mediaAssetId: "media-1" };

  mediaAssetFindRow = { storageKey: null, mimeType: "audio/mpeg", voice: null };
  assert.equal(await getArticleSpeechAudio("no-storage-key"), null);

  mediaAssetFindRow = {
    storageKey: "speech/unconfigured",
    mimeType: "audio/mpeg",
    voice: null,
  };
  assert.equal(await getArticleSpeechAudio("no-storage-provider"), null);

  storageImpl = makeStorage({ get: async () => null });
  assert.equal(await getArticleSpeechAudio("missing-blob"), null);
});

test("getArticleSpeechAudio returns stored bytes with their canonical MIME type", async () => {
  const { getArticleSpeechAudio } = await loadRepo();
  const audio = Buffer.from("stored narration");
  articleSpeechFindRow = { mediaAssetId: "media-1" };
  mediaAssetFindRow = {
    storageKey: "speech/stored",
    mimeType: "audio/ogg",
    voice: "en-US-Test",
  };
  storageImpl = makeStorage({ get: async () => audio });

  assert.deepEqual(await getArticleSpeechAudio("article-1"), {
    mimeType: "audio/ogg",
    bytes: audio,
  });
});

// ---------------------------------------------------------------------------
// saveSpeechResult
// ---------------------------------------------------------------------------

const SAVE_PARAMS = {
  articleId: "a1",
  audio: Buffer.from("AUDIO"),
  mimeType: "audio/mpeg",
  voice: "en-US-Test",
  words: [
    { word: "hello", startMs: 0, endMs: 400, textStart: 0, textEnd: 5 },
    { word: "world", startMs: 500, endMs: 1100, textStart: 6, textEnd: 11 },
  ],
};

test("saveSpeechResult skips persistence when no media storage is configured", async () => {
  const { saveSpeechResult } = await loadRepo();
  storageImpl = null;

  const saved = await saveSpeechResult(SAVE_PARAMS);

  assert.equal(saved, false);
  assert.equal(mediaAssetUpsertArgs, null, "media asset upsert should be skipped without storage");
  assert.equal(articleSpeechUpsertArgs, null, "speech row upsert should be skipped without storage");
});

test("saveSpeechResult writes to media storage and upserts a MediaAsset on success", async () => {
  const { saveSpeechResult } = await loadRepo();
  let putInput: PutMediaInput | null = null;
  storageImpl = makeStorage({
    put: async (input) => {
      putInput = input;
      return { storageKey: "speech/xyz", sizeBytes: 5, checksum: "cafef00d" };
    },
  });

  const saved = await saveSpeechResult(SAVE_PARAMS);

  assert.equal(saved, true);
  assert.ok(putInput);
  assert.equal((putInput as PutMediaInput).keyHint, "speech");
  assert.equal((putInput as PutMediaInput).keyScope, "a1");
  assert.ok(mediaAssetUpsertArgs);
  assert.deepEqual(mediaAssetUpsertArgs!.where, { storageKey: "speech/xyz" });
  assert.equal(mediaAssetUpsertArgs!.create.kind, "speech");
  assert.equal(mediaAssetUpsertArgs!.create.voice, "en-US-Test");
  for (const field of ["sizeBytes", "checksum", "durationSec", "format"]) {
    assert.equal(field in mediaAssetUpsertArgs!.create, false);
    assert.equal(field in mediaAssetUpsertArgs!.update, false);
  }

  assert.ok(articleSpeechUpsertArgs);
  assert.equal(articleSpeechUpsertArgs!.create.mediaAssetId, "media-1");
  for (const field of ["audioBase64", "voice", "plainText", "format", "mimeType", "storageKey"]) {
    assert.equal(field in articleSpeechUpsertArgs!.create, false);
    assert.equal(field in articleSpeechUpsertArgs!.update, false);
  }
  assert.deepEqual(articleSpeechUpsertArgs!.create.words, {
    version: 2,
    provider: "azure",
    timeUnit: "ms",
    textUnit: "utf16",
    words: ["hello", "world"],
    startMs: [0, 500],
    endMs: [400, 1100],
    textStart: [0, 6],
    textEnd: [5, 11],
  });
});

test("saveSpeechResult skips persistence when the storage write throws", async () => {
  const { saveSpeechResult } = await loadRepo();
  storageImpl = makeStorage({
    put: async () => {
      throw new Error("blob unavailable with private article sentence");
    },
  });

  const saved = await saveSpeechResult(SAVE_PARAMS);

  assert.equal(saved, false);
  assert.doesNotMatch(JSON.stringify(loggerEntries), /private article sentence/);
  assert.equal(loggerEntries.at(-1)?.meta?.machineReason, "storage_write_failed");
  assert.equal(mediaAssetUpsertArgs, null, "media asset upsert is never reached after a put failure");
  assert.equal(articleSpeechUpsertArgs, null, "speech row upsert is skipped after a put failure");
});

test("saveSpeechResult deletes the uploaded blob and returns false when the DB transaction fails", async () => {
  const { saveSpeechResult } = await loadRepo();
  const deletedKeys: string[] = [];
  transactionThrows = new Error("transaction unavailable with private article sentence");
  storageImpl = makeStorage({
    put: async () => ({ storageKey: "speech/orphaned", sizeBytes: 5, checksum: "cafef00d" }),
    delete: async (key) => {
      deletedKeys.push(key);
    },
  });

  const saved = await saveSpeechResult(SAVE_PARAMS);

  assert.equal(saved, false);
  assert.deepEqual(deletedKeys, ["speech/orphaned"]);
  assert.doesNotMatch(JSON.stringify(loggerEntries), /private article sentence/);
  assert.equal(loggerEntries.at(-1)?.meta?.machineReason, "speech_persistence_failed");
  assert.equal(mediaAssetUpsertArgs, null, "media asset upsert should not commit after tx failure");
  assert.equal(articleSpeechUpsertArgs, null, "speech row upsert should not commit after tx failure");
});

test("saveSpeechResult preserves graceful fallback when orphan cleanup also fails", async () => {
  const { saveSpeechResult } = await loadRepo();
  transactionThrows = new Error("transaction unavailable");
  storageImpl = makeStorage({
    put: async () => ({ storageKey: "speech/orphaned", sizeBytes: 5, checksum: "cafef00d" }),
    delete: async () => {
      throw new Error("storage unavailable");
    },
  });

  assert.equal(await saveSpeechResult(SAVE_PARAMS), false);
  assert.deepEqual(
    loggerEntries.map((entry) => entry.meta?.machineReason),
    ["storage_cleanup_failed", "speech_persistence_failed"],
  );
});
