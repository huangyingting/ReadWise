import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCandidates, lookupWord } from "@/lib/dictionary";

test("normalizeCandidates expands contractions", () => {
  assert.ok(normalizeCandidates("don't").includes("do"));
  assert.ok(normalizeCandidates("it's").includes("it"));
});

test("normalizeCandidates strips possessives and punctuation", () => {
  assert.ok(normalizeCandidates("dog's").includes("dog"));
  assert.ok(normalizeCandidates("(hello)").includes("hello"));
});

test("normalizeCandidates generates inflection base forms", () => {
  assert.ok(normalizeCandidates("running").includes("run"));
  assert.ok(normalizeCandidates("running").includes("running"));
  assert.ok(normalizeCandidates("cities").includes("city"));
  assert.ok(normalizeCandidates("happier").includes("happy") || normalizeCandidates("happier").includes("happi"));
  assert.ok(normalizeCandidates("quickly").includes("quick"));
});

test("normalizeCandidates returns [] for empty input", () => {
  assert.deepEqual(normalizeCandidates("!!!"), []);
  assert.deepEqual(normalizeCandidates("   "), []);
});

test("lookupWord resolves via stubbed dictionary API", async (t) => {
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
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  const result = await lookupWord("running");
  assert.equal(result.found, true);
  assert.equal(result.meanings[0].partOfSpeech, "verb");
  assert.equal(result.audio, "https://audio/run.mp3");
});

test("lookupWord degrades gracefully when the provider is unreachable", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;

  const result = await lookupWord("anything");
  assert.equal(result.found, false);
  assert.deepEqual(result.meanings, []);
});
