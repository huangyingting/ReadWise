/**
 * Unit tests for the speech (TTS) repository/storage adapter:
 * `src/lib/speech/repository.ts`.
 *
 * Covers:
 *   - parseStoredSpeechWords — pure JSON parsing of stored timings (valid,
 *     empty, and the many malformed shapes that map to a null/corrupt result).
 *   - resolveStoredAudioUrl — media-storage read-back vs unresolvable rows.
 *   - saveSpeechResult — storage-unconfigured skip, successful storage write,
 *     and storage-failure skip.
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
let mediaAssetUpsertArgs: UpsertArgs | null = null;
let articleSpeechUpsertArgs: UpsertArgs | null = null;

function resetState(): void {
  storageImpl = null;
  mediaAssetUpsertArgs = null;
  articleSpeechUpsertArgs = null;
}

before(() => {
  mock.module("@/lib/storage", {
    namedExports: {
      getMediaStorage: () => storageImpl,
    },
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
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

/** Build a scriptable in-memory MediaStorage. */
function makeStorage(opts: {
  put?: (input: PutMediaInput) => Promise<PutMediaResult>;
  get?: (key: string) => Promise<Buffer | null>;
}): MediaStorage {
  return {
    kind: "local",
    put:
      opts.put ??
      (async () => ({ storageKey: "speech/abc", sizeBytes: 3, checksum: "deadbeef" })),
    get: opts.get ?? (async () => null),
    delete: async () => {},
  };
}

// ---------------------------------------------------------------------------
// parseStoredSpeechWords
// ---------------------------------------------------------------------------

test("parseStoredSpeechWords returns null for null or undefined input", async () => {
  const { parseStoredSpeechWords } = await loadRepo();
  assert.equal(parseStoredSpeechWords(null), null);
  assert.equal(parseStoredSpeechWords(undefined), null);
});

test("parseStoredSpeechWords returns null when the stored value is not an array", async () => {
  const { parseStoredSpeechWords } = await loadRepo();
  assert.equal(parseStoredSpeechWords("not-an-array"), null);
  assert.equal(parseStoredSpeechWords(42), null);
  assert.equal(parseStoredSpeechWords({ word: "hi", offset: 0, duration: 1 }), null);
});

test("parseStoredSpeechWords returns null when an item is null, a primitive, or a nested array", async () => {
  const { parseStoredSpeechWords } = await loadRepo();
  assert.equal(parseStoredSpeechWords([null]), null);
  assert.equal(parseStoredSpeechWords(["hello"]), null);
  assert.equal(parseStoredSpeechWords([[{ word: "x", offset: 0, duration: 1 }]]), null);
});

test("parseStoredSpeechWords returns null when word is missing, non-string, or blank", async () => {
  const { parseStoredSpeechWords } = await loadRepo();
  assert.equal(parseStoredSpeechWords([{ offset: 0, duration: 1 }]), null);
  assert.equal(parseStoredSpeechWords([{ word: 123, offset: 0, duration: 1 }]), null);
  assert.equal(parseStoredSpeechWords([{ word: "   ", offset: 0, duration: 1 }]), null);
});

test("parseStoredSpeechWords returns null for non-finite or negative offset/duration", async () => {
  const { parseStoredSpeechWords } = await loadRepo();
  assert.equal(parseStoredSpeechWords([{ word: "a", offset: Number.NaN, duration: 1 }]), null);
  assert.equal(parseStoredSpeechWords([{ word: "a", offset: 0, duration: "1" }]), null);
  assert.equal(parseStoredSpeechWords([{ word: "a", offset: -1, duration: 1 }]), null);
  assert.equal(parseStoredSpeechWords([{ word: "a", offset: 0, duration: -1 }]), null);
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
  assert.equal(
    parseStoredSpeechWords([{ word: "a", offset: 0, duration: 1, textOffset: 0 }]),
    null,
  );
  assert.equal(
    parseStoredSpeechWords([{ word: "a", offset: 0, duration: 1, wordLength: 1 }]),
    null,
  );
  assert.equal(
    parseStoredSpeechWords([{ word: "a", offset: 0, duration: 1, textOffset: -1, wordLength: 1 }]),
    null,
  );
  assert.equal(
    parseStoredSpeechWords([{ word: "a", offset: 0, duration: 1, textOffset: 0, wordLength: 0 }]),
    null,
  );
});

// ---------------------------------------------------------------------------
// resolveStoredAudioUrl
// ---------------------------------------------------------------------------

test("resolveStoredAudioUrl returns null when there is no storage key", async () => {
  const { resolveStoredAudioUrl } = await loadRepo();
  const url = await resolveStoredAudioUrl({
    mimeType: "audio/mpeg",
    storageKey: null,
  });
  assert.equal(url, null);
});

test("resolveStoredAudioUrl returns null when a storage key exists but storage is unconfigured", async () => {
  const { resolveStoredAudioUrl } = await loadRepo();
  storageImpl = null;
  const url = await resolveStoredAudioUrl({
    mimeType: "audio/mpeg",
    storageKey: "speech/abc",
  });
  assert.equal(url, null);
});

test("resolveStoredAudioUrl returns null when storage has no bytes for the key", async () => {
  const { resolveStoredAudioUrl } = await loadRepo();
  storageImpl = makeStorage({ get: async () => null });
  const url = await resolveStoredAudioUrl({
    mimeType: "audio/mpeg",
    storageKey: "speech/missing",
  });
  assert.equal(url, null);
});

test("resolveStoredAudioUrl reads bytes back from storage and returns a data URL", async () => {
  const { resolveStoredAudioUrl } = await loadRepo();
  let requestedKey: string | null = null;
  storageImpl = makeStorage({
    get: async (key) => {
      requestedKey = key;
      return Buffer.from("ABC");
    },
  });
  const url = await resolveStoredAudioUrl({
    mimeType: "audio/ogg",
    storageKey: "speech/abc",
  });
  assert.equal(requestedKey, "speech/abc");
  assert.equal(url, `data:audio/ogg;base64,${Buffer.from("ABC").toString("base64")}`);
});

// ---------------------------------------------------------------------------
// saveSpeechResult
// ---------------------------------------------------------------------------

const SAVE_PARAMS = {
  articleId: "a1",
  audio: Buffer.from("AUDIO"),
  mimeType: "audio/mpeg",
  voice: "en-US-Test",
  format: "audio-24khz-96kbitrate-mono-mp3",
  plainText: "hello world",
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
  assert.ok(mediaAssetUpsertArgs);
  assert.deepEqual(mediaAssetUpsertArgs!.where, { storageKey: "speech/xyz" });
  // durationSec = last word end = 1100 / 1000 = 1.1s.
  assert.equal(mediaAssetUpsertArgs!.create.durationSec, 1.1);
  assert.equal(mediaAssetUpsertArgs!.create.kind, "speech");

  assert.ok(articleSpeechUpsertArgs);
  assert.equal(articleSpeechUpsertArgs!.create.storageKey, "speech/xyz");
  assert.equal(articleSpeechUpsertArgs!.create.mediaAssetId, "media-1");
  assert.equal("audioBase64" in articleSpeechUpsertArgs!.create, false);
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
      throw new Error("blob unavailable");
    },
  });

  const saved = await saveSpeechResult(SAVE_PARAMS);

  assert.equal(saved, false);
  assert.equal(mediaAssetUpsertArgs, null, "media asset upsert is never reached after a put failure");
  assert.equal(articleSpeechUpsertArgs, null, "speech row upsert is skipped after a put failure");
});
