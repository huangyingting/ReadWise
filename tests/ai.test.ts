import { test } from "node:test";
import assert from "node:assert/strict";
import { isAiConfigured, aiModelName, chatComplete } from "@/lib/ai";
import { enableAi, disableAi } from "./helpers";

test("isAiConfigured / aiModelName reflect env configuration", () => {
  disableAi();
  assert.equal(isAiConfigured(), false);
  assert.equal(aiModelName(), null);
  enableAi();
  assert.equal(isAiConfigured(), true);
  assert.equal(aiModelName(), "gpt-test");
  disableAi();
});

test("chatComplete returns null when unconfigured (no network call)", async (t) => {
  disableAi();
  const original = globalThis.fetch;
  let called = false;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = (async () => {
    called = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const result = await chatComplete([{ role: "user", content: "hi" }]);
  assert.equal(result, null);
  assert.equal(called, false);
});

test("chatComplete posts to Azure and returns assistant text", async (t) => {
  enableAi();
  const original = globalThis.fetch;
  let sentBody: unknown;
  t.after(() => {
    globalThis.fetch = original;
    disableAi();
  });
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    sentBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "  hello world  " } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const result = await chatComplete([{ role: "user", content: "hi" }], {
    maxOutputTokens: 32,
  });
  assert.equal(result, "hello world");
  assert.deepEqual((sentBody as { max_completion_tokens: number }).max_completion_tokens, 32);
});

test("chatComplete returns null on a non-2xx response", async (t) => {
  enableAi();
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
    disableAi();
  });
  globalThis.fetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;
  assert.equal(await chatComplete([{ role: "user", content: "x" }]), null);
});
