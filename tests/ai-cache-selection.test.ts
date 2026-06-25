/**
 * Tests for the shared getOrCreateSelectionAi helper in src/lib/ai-cache.ts.
 *
 * Exercises the common lifecycle through a minimal synthetic spec so any future
 * selection-level feature can use this harness as a template.
 */
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

process.env.LOG_LEVEL = "error";

let aiConfigured = false;
let aiReply: string | null = null;

before(() => {
  mock.module("@/lib/ai", {
    namedExports: {
      isAiConfigured: () => aiConfigured,
      aiModelName: () => (aiConfigured ? "gpt-test" : null),
      chatComplete: async () => aiReply,
    },
  });
  // promptVersionFor is needed by the helper
  mock.module("@/lib/ai/chunking", {
    namedExports: {
      promptVersionFor: () => "v1",
      boundedSampleForFeature: (text: string) => text,
      chunkForFeature: (text: string) => [text],
    },
  });
});

beforeEach(() => {
  aiConfigured = false;
  aiReply = null;
});

type SimpleResult = { value: string | null; fallback: boolean };

function makeSpec(overrides: {
  cached?: SimpleResult | null;
  validateFn?: (text: string) => boolean;
  persistCount?: { n: number };
}) {
  const persistCount = overrides.persistCount ?? { n: 0 };

  return {
    feature: "test-feature",
    articleId: "art-1",
    readCache: async () => overrides.cached ?? null,
    generate: async (callModel: (msgs: never[]) => Promise<string | null>) =>
      callModel([] as never[]),
    validate: overrides.validateFn,
    persist: async (text: string): Promise<SimpleResult> => {
      persistCount.n++;
      return { value: text, fallback: false };
    },
    fallback: (): SimpleResult => ({ value: null, fallback: true }),
  };
}

test("cache hit: returns cached result without calling AI", async () => {
  const { getOrCreateSelectionAi } = await import("@/lib/ai-cache");
  const cached: SimpleResult = { value: "cached-value", fallback: false };
  const persistCount = { n: 0 };
  const result = await getOrCreateSelectionAi(makeSpec({ cached, persistCount }));
  assert.deepEqual(result, cached);
  assert.equal(persistCount.n, 0);
});

test("AI unconfigured: returns fallback without caching", async () => {
  const { getOrCreateSelectionAi } = await import("@/lib/ai-cache");
  aiConfigured = false;
  const persistCount = { n: 0 };
  const result = await getOrCreateSelectionAi(makeSpec({ persistCount }));
  assert.equal(result.fallback, true);
  assert.equal(result.value, null);
  assert.equal(persistCount.n, 0);
});

test("AI configured + null reply: returns fallback without caching", async () => {
  const { getOrCreateSelectionAi } = await import("@/lib/ai-cache");
  aiConfigured = true;
  aiReply = null;
  const persistCount = { n: 0 };
  const result = await getOrCreateSelectionAi(makeSpec({ persistCount }));
  assert.equal(result.fallback, true);
  assert.equal(persistCount.n, 0);
});

test("AI configured + valid reply: persists and returns result", async () => {
  const { getOrCreateSelectionAi } = await import("@/lib/ai-cache");
  aiConfigured = true;
  aiReply = "generated text";
  const persistCount = { n: 0 };
  const result = await getOrCreateSelectionAi(makeSpec({ persistCount }));
  assert.equal(result.fallback, false);
  assert.equal(result.value, "generated text");
  assert.equal(persistCount.n, 1);
});

test("validate returns false: fallback without caching", async () => {
  const { getOrCreateSelectionAi } = await import("@/lib/ai-cache");
  aiConfigured = true;
  aiReply = "unsafe content";
  const persistCount = { n: 0 };
  const result = await getOrCreateSelectionAi(
    makeSpec({ persistCount, validateFn: () => false }),
  );
  assert.equal(result.fallback, true);
  assert.equal(persistCount.n, 0);
});

test("validate returns true: persists and returns result", async () => {
  const { getOrCreateSelectionAi } = await import("@/lib/ai-cache");
  aiConfigured = true;
  aiReply = "safe content";
  const persistCount = { n: 0 };
  const result = await getOrCreateSelectionAi(
    makeSpec({ persistCount, validateFn: () => true }),
  );
  assert.equal(result.fallback, false);
  assert.equal(result.value, "safe content");
  assert.equal(persistCount.n, 1);
});
