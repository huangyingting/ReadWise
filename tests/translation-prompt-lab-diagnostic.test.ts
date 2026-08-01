process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

let closed = 0;
const chatResults = [
  { text: "[[1]]\n第一段\n\n[[2]]\n第二段", finishReason: "stop" },
  { text: "missing markers response", finishReason: "stop" },
];

before(() => {
  mock.module("../scripts/translation-prompt-lab/db.ts", {
    namedExports: {
      openReadOnly: () => ({
        prepare: () => ({
          all: () => [
            { id: "empty", title: "Empty", content: "empty", category: null },
            { id: "valid", title: "Valid", content: "valid", category: "world" },
            { id: "invalid", title: "Invalid", content: "invalid", category: "science" },
          ],
        }),
        close: () => {
          closed += 1;
        },
      }),
    },
  });
  mock.module("@/lib/content-pipeline", {
    namedExports: {
      sanitizeArticleHtml: (html: string) => html,
      articleHtmlToReaderText: (html: string) => (html === "empty" ? "" : html),
    },
  });
  mock.module("@/lib/bilingual", {
    namedExports: {
      splitHtmlParagraphs: (html: string) => (html === "valid" ? ["one", "two"] : [html]),
    },
  });
  mock.module("../scripts/translation-prompt-lab/prompts.ts", {
    namedExports: {
      recommendedPromptForCategory: (category: string | null) => ({
        id: "recommended",
        profile: category ?? "narrative",
        label: "recommended",
        systemPrompt: "system",
      }),
    },
  });
  mock.module("../scripts/translation-prompt-lab/vllm-client.ts", {
    namedExports: {
      chatCompleteWithRetry: async () => ({ ...chatResults.shift()!, usage: null, durationMs: 1 }),
    },
  });
  mock.module("@/lib/ai/input-safety", {
    namedExports: {
      CONTENT_ISOLATION_NOTICE: "isolate",
      wrapUntrustedContent: (content: string) => content,
    },
  });
});

beforeEach(() => {
  closed = 0;
  chatResults.splice(
    0,
    chatResults.length,
    { text: "[[1]]\n第一段\n\n[[2]]\n第二段", finishReason: "stop" },
    { text: "missing markers response", finishReason: "stop" },
  );
});

test("marker diagnostic is import-safe and reports valid and malformed batches", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "log", (message: string) => logs.push(message));
  const { main } = await import("../scripts/translation-prompt-lab/diag-marker");

  assert.equal(await main("fixture.db"), 0);
  assert.equal(closed, 1);
  assert.match(logs.join("\n"), /valid blocks=2.*ok=true/);
  assert.match(logs.join("\n"), /invalid blocks=1.*ok=false/);
  assert.match(logs.join("\n"), /RAW RESPONSE/);
  assert.doesNotMatch(logs.join("\n"), /empty blocks=/);
});
