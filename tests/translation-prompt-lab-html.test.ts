process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

type Completion = {
  text: string;
  finishReason: string | null;
  usage: null;
  durationMs: number;
};

const completions: Array<Completion | Error> = [];
const completionCalls: Array<{ messages: unknown[]; options: Record<string, unknown> }> = [];

before(() => {
  mock.module("../scripts/translation-prompt-lab/vllm-client.ts", {
    namedExports: {
      chatCompleteWithRetry: async (messages: unknown[], options: Record<string, unknown>) => {
        completionCalls.push({ messages, options });
        const next = completions.shift();
        if (next instanceof Error) throw next;
        if (!next) throw new Error("missing mocked completion");
        return next;
      },
    },
  });
});

beforeEach(() => {
  completions.length = 0;
  completionCalls.length = 0;
});

function completion(text: string, finishReason: string | null = "stop"): Completion {
  return { text, finishReason, usage: null, durationMs: 1 };
}

test("HTML block translation splits on the Reader boundary and accepts strict markers", async () => {
  completions.push(completion("[[1]]\n第一段\n\n[[2]]\n第二段"));
  const { splitArticleBlocks, translateArticleBlocks } = await import(
    "../scripts/translation-prompt-lab/html-blocks"
  );

  const blocks = splitArticleBlocks("<p>Hello.</p><p>World.</p>");
  assert.deepEqual(blocks.map((block) => ({ index: block.index, text: block.text })), [
    { index: 0, text: "Hello." },
    { index: 1, text: "World." },
  ]);

  const result = await translateArticleBlocks("<p>Hello.</p><p>World.</p>", "system", {
    maxInputTokens: 100,
    temperature: 0,
  });
  assert.deepEqual(result, {
    content: "第一段\n\n第二段",
    sourceBlockCount: 2,
    chunkCount: 1,
    repairedChunkCount: 0,
    suspiciousBlockCount: 0,
  });
  assert.match(String((completionCalls[0]!.messages[0] as { content: string }).content), /same order/i);
  assert.equal(completionCalls[0]!.options.temperature, 0);
});

test("marker recovery tolerates a short preamble, a missing first marker, and unmarked paragraphs", async () => {
  const { translateArticleBlocks } = await import("../scripts/translation-prompt-lab/html-blocks");
  const html = "<p>Hello.</p><p>World.</p>";

  completions.push(completion("Here is the translation:\n\n[[1]]\n第一段\n\n[[2]]\n第二段"));
  assert.equal((await translateArticleBlocks(html, "system")).content, "第一段\n\n第二段");

  completions.push(completion("第一段\n\n[[2]]\n第二段"));
  assert.equal((await translateArticleBlocks(html, "system")).content, "第一段\n\n第二段");

  completions.push(completion("第一段\n\n第二段"));
  assert.equal((await translateArticleBlocks(html, "system")).content, "第一段\n\n第二段");
});

test("marker parsing rejects malformed or untranslated batches and repairs blocks individually", async () => {
  const longEnglish = "This source paragraph remains long enough to trigger the suspicious repaired-block quality signal. ".repeat(2);
  const html = `<p>${longEnglish}</p><p>Short source.</p>`;
  completions.push(
    completion("[[1]]\nEnglish only\n\n[[2]]\nEnglish only"),
    completion("[[2]]\n第二段"),
    completion("partial", "length"),
    completion("English output remains untranslated after retry", "stop"),
    completion("短译文", "stop"),
  );
  const { translateArticleBlocks } = await import("../scripts/translation-prompt-lab/html-blocks");

  const result = await translateArticleBlocks(html, "system", { maxInputTokens: 100 });

  assert.equal(result.repairedChunkCount, 1);
  assert.equal(result.suspiciousBlockCount, 1);
  assert.match(result.content, /English output/);
  assert.match(result.content, /短译文/);
  assert.equal(completionCalls.length, 5);
  assert.ok(Number(completionCalls[3]!.options.maxTokens) > Number(completionCalls[2]!.options.maxTokens));
});

test("a repaired block that hits the output cap twice fails the article", async () => {
  completions.push(
    completion("partial", "length"),
    completion("partial", "length"),
    completion("partial", "length"),
    completion("partial", "length"),
  );
  const { translateArticleBlocks } = await import("../scripts/translation-prompt-lab/html-blocks");

  await assert.rejects(
    () => translateArticleBlocks("<p>One source block.</p>", "system"),
    /hit the output token cap twice/,
  );
});

test("block batching flushes ordinary and oversized blocks without splitting alignment", async () => {
  const first = "a".repeat(120);
  const oversized = "b".repeat(250);
  const last = "c".repeat(120);
  completions.push(
    completion("[[1]]\n第一段"),
    completion("[[1]]\n第二段"),
    completion("[[1]]\n第三段"),
  );
  const { translateArticleBlocks } = await import("../scripts/translation-prompt-lab/html-blocks");

  const result = await translateArticleBlocks(`<p>${first}</p><p>${oversized}</p><p>${last}</p>`, "system", {
    maxInputTokens: 1,
  });
  assert.equal(result.chunkCount, 3);
  assert.equal(result.sourceBlockCount, 3);
  assert.equal(result.content, "第一段\n\n第二段\n\n第三段");
});

test("one block cannot inject extra blank-line paragraphs into the aligned output", async () => {
  completions.push(completion("[[1]]\n第一行\n\n第二行"));
  const { translateArticleBlocks } = await import("../scripts/translation-prompt-lab/html-blocks");

  const result = await translateArticleBlocks("<p>One source block.</p>", "system");
  assert.equal(result.content, "第一行\n第二行");
  assert.equal(result.sourceBlockCount, 1);
});
