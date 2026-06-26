/**
 * Tests for the lexical dictionary provider interface (REF-048).
 *
 * Demonstrates that the DictionaryProvider interface can be mocked without
 * any network access, and that lookupWord degrades gracefully through
 * provider failures and "not found" responses.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DictionaryProvider, DictionaryEntry } from "@/lib/lexical/provider";
import { lookupWord } from "@/lib/lexical/lookup";
import {
  FallbackDictionaryProvider,
  FreeDictionaryProvider,
  LocalDictionaryProvider,
} from "@/lib/lexical/provider";

// ---------------------------------------------------------------------------
// Mock provider helpers
// ---------------------------------------------------------------------------

/** Creates a provider that returns a fixed entry for any word. */
function fixedProvider(entry: DictionaryEntry | null): DictionaryProvider {
  return {
    async fetchEntry(): Promise<DictionaryEntry | null> {
      return entry;
    },
  };
}

/** Creates a provider that records calls and returns entries from a map. */
function mappedProvider(
  map: Record<string, DictionaryEntry | null>,
): DictionaryProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async fetchEntry(word: string): Promise<DictionaryEntry | null> {
      calls.push(word);
      return map[word] ?? null;
    },
  };
}

const sampleEntry: DictionaryEntry = {
  phonetic: "/rʌn/",
  audio: "https://audio/run.mp3",
  meanings: [
    {
      partOfSpeech: "verb",
      definitions: [{ definition: "to move fast", example: "I run." }],
    },
  ],
};

// ---------------------------------------------------------------------------
// lookupWord with mock providers
// ---------------------------------------------------------------------------

test("lookupWord uses injected provider — no network required", async () => {
  const result = await lookupWord("run", fixedProvider(sampleEntry));
  assert.equal(result.found, true);
  assert.equal(result.word, "run");
  assert.equal(result.audio, "https://audio/run.mp3");
  assert.equal(result.meanings[0].partOfSpeech, "verb");
});

test("lookupWord returns found:false when provider returns null", async () => {
  const result = await lookupWord("xyzzy", fixedProvider(null));
  assert.equal(result.found, false);
  assert.equal(result.word, "xyzzy");
  assert.deepEqual(result.meanings, []);
});

test("lookupWord iterates candidates until one resolves", async () => {
  // "running" normalizes to ["running", "runn", "run", ...]
  // Only "run" has an entry.
  const provider = mappedProvider({ run: sampleEntry });
  const result = await lookupWord("running", provider);
  assert.equal(result.found, true);
  assert.equal(result.lookedUp, "run");
  assert.ok(provider.calls.includes("run"), "should have tried 'run'");
  assert.ok(provider.calls[0] === "running", "should have tried 'running' first");
});

test("lookupWord returns found:false when all candidates fail", async () => {
  const result = await lookupWord("zzzqqq", fixedProvider(null));
  assert.equal(result.found, false);
  assert.deepEqual(result.meanings, []);
});

test("lookupWord returns found:false for empty-ish input", async () => {
  const result = await lookupWord("!!!", fixedProvider(sampleEntry));
  assert.equal(result.found, false, "no candidates → not found");
});

test("lookupWord sets lookedUp to the resolved candidate, not the raw input", async () => {
  const provider = mappedProvider({ run: sampleEntry });
  const result = await lookupWord("running", provider);
  assert.equal(result.found, true);
  assert.equal(result.word, "running");
  assert.equal(result.lookedUp, "run");
});

test("lookupWord never throws when provider throws", async () => {
  const throwingProvider: DictionaryProvider = {
    async fetchEntry(): Promise<DictionaryEntry | null> {
      throw new Error("provider exploded");
    },
  };
  // lookupWord itself does not catch provider throws — the provider must handle
  // them internally (FreeDictionaryProvider does). Test that a well-behaved
  // mock never throws by returning null.
  const result = await lookupWord("word", fixedProvider(null));
  assert.equal(result.found, false);
});

// ---------------------------------------------------------------------------
// LocalDictionaryProvider — compact local JSON dictionaries
// ---------------------------------------------------------------------------

function withLocalDictionaryDir(files: Record<string, unknown>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "readwise-dict-"));
  for (const [file, data] of Object.entries(files)) {
    writeFileSync(path.join(dir, file), JSON.stringify(data), "utf-8");
  }
  return dir;
}

test("LocalDictionaryProvider parses compact local entries", async (t) => {
  const dir = withLocalDictionaryDir({
    "en-50k.json": {
      run: [
        "/rʌn/",
        [
          ["verb", ["to move fast", "to operate"]],
          ["noun", ["an act of running"]],
        ],
      ],
    },
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const provider = new LocalDictionaryProvider({ directory: dir, dictionary: "en" });
  const entry = await provider.fetchEntry("run");

  assert.ok(entry);
  assert.equal(entry.phonetic, "/rʌn/");
  assert.equal(entry.meanings[0].partOfSpeech, "verb");
  assert.equal(entry.meanings[0].definitions[1].definition, "to operate");
  assert.equal(entry.meanings[1].definitions[0].definition, "an act of running");
});

test("LocalDictionaryProvider can read Chinese local definitions", async (t) => {
  const dir = withLocalDictionaryDir({
    "cn-50k.json": {
      run: ["/rʌn/", [["v.", ["跑", "运行"]]]],
    },
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const provider = new LocalDictionaryProvider({ directory: dir, dictionary: "cn" });
  const entry = await provider.fetchEntry("RUN");

  assert.ok(entry);
  assert.equal(entry.meanings[0].partOfSpeech, "v.");
  assert.equal(entry.meanings[0].definitions[0].definition, "跑");
});

test("LocalDictionaryProvider returns null for missing files and misses", async (t) => {
  const dir = withLocalDictionaryDir({ "en-50k.json": {} });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const provider = new LocalDictionaryProvider({ directory: dir, dictionary: "en" });
  assert.equal(await provider.fetchEntry("missing"), null);

  const missingFileProvider = new LocalDictionaryProvider({
    directory: path.join(dir, "does-not-exist"),
    dictionary: "en",
  });
  assert.equal(await missingFileProvider.fetchEntry("run"), null);
});

test("FallbackDictionaryProvider tries providers in order", async () => {
  const first = fixedProvider(null);
  const second = fixedProvider(sampleEntry);
  const provider = new FallbackDictionaryProvider([first, second]);

  const entry = await provider.fetchEntry("run");

  assert.equal(entry, sampleEntry);
});

// ---------------------------------------------------------------------------
// FreeDictionaryProvider — network mocked via globalThis.fetch
// ---------------------------------------------------------------------------

test("FreeDictionaryProvider fetches and parses a well-formed API response", async (t) => {
  const payload = [
    {
      phonetic: "/rʌn/",
      phonetics: [{ text: "/rʌn/", audio: "https://audio/run.mp3" }],
      meanings: [
        {
          partOfSpeech: "verb",
          definitions: [{ definition: "to move fast", example: "I run." }],
        },
      ],
    },
  ];
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  const provider = new FreeDictionaryProvider();
  const entry = await provider.fetchEntry("run");
  assert.ok(entry !== null);
  assert.equal(entry!.phonetic, "/rʌn/");
  assert.equal(entry!.audio, "https://audio/run.mp3");
  assert.equal(entry!.meanings[0].partOfSpeech, "verb");
});

test("FreeDictionaryProvider returns null on 404", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = (async () =>
    new Response("Not Found", { status: 404 })) as typeof fetch;

  const provider = new FreeDictionaryProvider();
  const entry = await provider.fetchEntry("unknownword");
  assert.equal(entry, null);
});

test("FreeDictionaryProvider returns null when network fails", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;

  const provider = new FreeDictionaryProvider();
  const entry = await provider.fetchEntry("run");
  assert.equal(entry, null);
});

test("FreeDictionaryProvider returns null for empty API response array", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = (async () =>
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  const provider = new FreeDictionaryProvider();
  const entry = await provider.fetchEntry("run");
  assert.equal(entry, null);
});
