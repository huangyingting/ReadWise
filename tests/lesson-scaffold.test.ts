/**
 * Unit tests for lesson scaffold generation (#1304): model output parsing
 * and the cache-first spec wiring (persist, results, fallback).
 */
process.env.LOG_LEVEL = "error";

import { before, mock, test } from "node:test";
import assert from "node:assert/strict";

type Spec = {
  feature: string;
  buildMessages: (article: { title: string; content: string }) => Array<{ role: string; content: string }>;
  parse: (completion: string) => unknown;
  isEmpty: (parsed: unknown) => boolean;
  persist: (articleId: string, parsed: unknown) => Promise<unknown>;
  toResult: (cache: unknown) => unknown;
  fallback: (article: { title: string; content: string }, ctx?: { reason: string }) => unknown;
  readCache: (articleId: string) => Promise<unknown>;
};

let captured: Spec | null = null;
const upserts: unknown[] = [];

before(() => {
  mock.module("@/lib/ai/cache", {
    namedExports: {
      getOrCreateArticleAi: async (_articleId: string, spec: Spec) => {
        captured = spec;
        return null;
      },
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        articleLessonScaffold: {
          upsert: async (args: unknown) => {
            upserts.push(args);
            return {};
          },
          findUnique: async () => null,
        },
      },
    },
  });
});

test("parseLessonScaffold keeps a hook, questions, and defined terms", async () => {
  const { parseLessonScaffold } = await import("@/lib/lesson/scaffold");
  const parsed = parseLessonScaffold(
    JSON.stringify([
      { type: "hook", text: "  What do you know about reefs? " },
      { type: "hook", text: "Ignored second hook" },
      { type: "question", text: "Why do reefs matter?" },
      { type: "question", text: "x".repeat(401) },
      { type: "term", term: "reef", definition: "an underwater ridge" },
      { type: "term", term: "coral" },
      "noise",
      null,
    ]),
  );
  assert.deepEqual(parsed, {
    hook: "What do you know about reefs?",
    questions: ["Why do reefs matter?"],
    keyTerms: [{ term: "reef", definition: "an underwater ridge", context: null }],
  });
  assert.equal(parseLessonScaffold("not json"), null);
  assert.equal(parseLessonScaffold(JSON.stringify([{ type: "question", text: "Q?" }])), null, "a hook is required");
  assert.equal(parseLessonScaffold(JSON.stringify([{ type: "hook", text: "H" }])), null, "questions are required");
});

test("the scaffold spec persists generated scaffolds and falls back to the text", async () => {
  const { getOrCreateLessonScaffold } = await import("@/lib/lesson/scaffold");
  assert.equal(await getOrCreateLessonScaffold("a1", null), null);
  const spec = captured as unknown as Spec;
  assert.equal(spec.feature, "lesson-scaffold");
  assert.equal(await spec.readCache("a1"), null);
  const messages = spec.buildMessages({ title: "Reefs", content: "<p>Coral reefs recover.</p>" });
  assert.match(messages[1].content, /Coral reefs recover/);
  assert.equal(spec.isEmpty(null), true);

  const scaffold = { hook: "H", questions: ["Q?"], keyTerms: [{ term: "reef", definition: "ridge", context: null }] };
  assert.deepEqual(await spec.persist("a1", scaffold), scaffold);
  assert.deepEqual((upserts[0] as { create: { keyTerms: unknown } }).create.keyTerms, [{ term: "reef", definition: "ridge" }]);
  assert.deepEqual(spec.toResult(scaffold), { ...scaffold, fallback: false });

  const fallback = spec.fallback(
    { title: "Reefs", content: "<p>Restoration helps. Restoration works.</p>" },
    { reason: "provider_unconfigured" },
  ) as { fallback: boolean; fallbackReason: string; keyTerms: Array<{ term: string }> };
  assert.equal(fallback.fallback, true);
  assert.equal(fallback.fallbackReason, "provider_unconfigured");
  assert.equal(fallback.keyTerms[0].term, "restoration");
  assert.equal("fallbackReason" in (spec.fallback({ title: "T", content: "" }) as object), false);
});
