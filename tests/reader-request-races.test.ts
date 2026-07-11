import { describe, test, before, mock } from "node:test";
import assert from "node:assert/strict";

import {
  beginRender,
  flushAsyncWork,
} from "./support/react-hook-harness";

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

before(() => {
  mock.module("@/components/GrammarPopover", {
    namedExports: {},
  });
});

function useRenderDictionaryHook(
  useDictionaryLookup: typeof import("@/components/reader/wordLookup/useDictionaryLookup").useDictionaryLookup,
) {
  beginRender();
  return useDictionaryLookup();
}

function useRenderGrammarHook(
  useGrammarExplanation: typeof import("@/components/reader/wordLookup/useGrammarExplanation").useGrammarExplanation,
  articleId: string,
  contextSentenceFor: (phrase: string) => string,
) {
  beginRender();
  return useGrammarExplanation(articleId, contextSentenceFor);
}

describe("useDictionaryLookup race guards", () => {
  test("out-of-order stale success is discarded", async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    let fetchCall = 0;
    globalThis.fetch = (async () => {
      fetchCall++;
      return fetchCall === 1 ? d1.promise : d2.promise;
    }) as typeof fetch;

    const { useDictionaryLookup } = await import(
      "@/components/reader/wordLookup/useDictionaryLookup"
    );

    let hook = useRenderDictionaryHook(useDictionaryLookup);

    // First request
    const p1 = hook.runLookup("apple");
    // Second request supersedes first
    const p2 = hook.runLookup("banana");

    // Resolve second (newer) first
    d2.resolve(jsonResponse({ word: "banana", found: true, meanings: [] }));
    await flushAsyncWork();
    await p2;

    hook = useRenderDictionaryHook(useDictionaryLookup);
    assert.equal(hook.result?.word, "banana");
    assert.equal(hook.loading, false);

    // Now resolve first (stale) — must NOT overwrite
    d1.resolve(jsonResponse({ word: "apple", found: true, meanings: [] }));
    await flushAsyncWork();
    await p1;

    hook = useRenderDictionaryHook(useDictionaryLookup);
    assert.equal(hook.result?.word, "banana", "stale success must not overwrite current result");
    assert.equal(hook.loading, false);
  });

  test("out-of-order stale failure is discarded", async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    let fetchCall = 0;
    globalThis.fetch = (async () => {
      fetchCall++;
      return fetchCall === 1 ? d1.promise : d2.promise;
    }) as typeof fetch;

    const { useDictionaryLookup } = await import(
      "@/components/reader/wordLookup/useDictionaryLookup"
    );

    let hook = useRenderDictionaryHook(useDictionaryLookup);

    const p1 = hook.runLookup("apple");
    const p2 = hook.runLookup("banana");

    // Resolve second successfully
    d2.resolve(jsonResponse({ word: "banana", found: true, meanings: [] }));
    await flushAsyncWork();
    await p2;

    hook = useRenderDictionaryHook(useDictionaryLookup);
    assert.equal(hook.result?.word, "banana");
    assert.equal(hook.dictError, null);

    // First rejects (stale failure) — must NOT set error
    d1.reject(new Error("Network failure"));
    await flushAsyncWork();
    await p1;

    hook = useRenderDictionaryHook(useDictionaryLookup);
    assert.equal(hook.dictError, null, "stale failure must not set error");
    assert.equal(hook.result?.word, "banana");
  });

  test("stale request cannot clear loading while newer request is pending", async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    let fetchCall = 0;
    globalThis.fetch = (async () => {
      fetchCall++;
      return fetchCall === 1 ? d1.promise : d2.promise;
    }) as typeof fetch;

    const { useDictionaryLookup } = await import(
      "@/components/reader/wordLookup/useDictionaryLookup"
    );

    let hook = useRenderDictionaryHook(useDictionaryLookup);

    const p1 = hook.runLookup("apple");
    hook.runLookup("banana");

    hook = useRenderDictionaryHook(useDictionaryLookup);
    assert.equal(hook.loading, true);

    // Stale resolves while newer is still pending
    d1.resolve(jsonResponse({ word: "apple", found: true, meanings: [] }));
    await flushAsyncWork();
    await p1;

    hook = useRenderDictionaryHook(useDictionaryLookup);
    assert.equal(hook.loading, true, "loading must remain true while newer request is pending");

    // Now resolve newer
    d2.resolve(jsonResponse({ word: "banana", found: true, meanings: [] }));
    await flushAsyncWork();

    hook = useRenderDictionaryHook(useDictionaryLookup);
    assert.equal(hook.loading, false);
    assert.equal(hook.result?.word, "banana");
  });

  test("resetDictionary invalidates in-flight request", async () => {
    const d1 = deferred<Response>();
    globalThis.fetch = (async () => d1.promise) as typeof fetch;

    const { useDictionaryLookup } = await import(
      "@/components/reader/wordLookup/useDictionaryLookup"
    );

    let hook = useRenderDictionaryHook(useDictionaryLookup);

    const p1 = hook.runLookup("apple");
    hook.resetDictionary();

    hook = useRenderDictionaryHook(useDictionaryLookup);
    assert.equal(hook.loading, false);
    assert.equal(hook.result, null);

    // Late resolve must not repopulate state
    d1.resolve(jsonResponse({ word: "apple", found: true, meanings: [] }));
    await flushAsyncWork();
    await p1;

    hook = useRenderDictionaryHook(useDictionaryLookup);
    assert.equal(hook.result, null, "reset must prevent stale response from populating state");
    assert.equal(hook.loading, false);
    assert.equal(hook.dictError, null);
  });

  test("request payload and endpoint remain unchanged", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = init?.body as string;
      return jsonResponse({ word: "test", found: true, meanings: [] });
    }) as typeof fetch;

    const { useDictionaryLookup } = await import(
      "@/components/reader/wordLookup/useDictionaryLookup"
    );

    const hook = useRenderDictionaryHook(useDictionaryLookup);
    await hook.runLookup("ephemeral");

    assert.equal(capturedUrl, "/api/dictionary");
    assert.deepEqual(JSON.parse(capturedBody), { word: "ephemeral" });
  });
});

describe("useGrammarExplanation race guards", () => {
  test("out-of-order stale success is discarded", async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    let fetchCall = 0;
    globalThis.fetch = (async () => {
      fetchCall++;
      return fetchCall === 1 ? d1.promise : d2.promise;
    }) as typeof fetch;

    const { useGrammarExplanation } = await import(
      "@/components/reader/wordLookup/useGrammarExplanation"
    );

    let hook = useRenderGrammarHook(useGrammarExplanation, "article-1", () => "context sentence");

    const p1 = hook.runGrammarExplain("phrase-a");
    const p2 = hook.runGrammarExplain("phrase-b");

    // Resolve newer first
    d2.resolve(jsonResponse({ explanation: "B explanation", fallback: false }));
    await flushAsyncWork();
    await p2;

    hook = useRenderGrammarHook(useGrammarExplanation, "article-1", () => "context sentence");
    assert.equal(hook.grammarResult?.explanation, "B explanation");
    assert.equal(hook.grammarLoading, false);

    // Stale resolves
    d1.resolve(jsonResponse({ explanation: "A explanation", fallback: false }));
    await flushAsyncWork();
    await p1;

    hook = useRenderGrammarHook(useGrammarExplanation, "article-1", () => "context sentence");
    assert.equal(
      hook.grammarResult?.explanation,
      "B explanation",
      "stale success must not overwrite grammar result",
    );
  });

  test("out-of-order stale failure is discarded", async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    let fetchCall = 0;
    globalThis.fetch = (async () => {
      fetchCall++;
      return fetchCall === 1 ? d1.promise : d2.promise;
    }) as typeof fetch;

    const { useGrammarExplanation } = await import(
      "@/components/reader/wordLookup/useGrammarExplanation"
    );

    let hook = useRenderGrammarHook(useGrammarExplanation, "article-1", () => "context");

    const p1 = hook.runGrammarExplain("phrase-a");
    const p2 = hook.runGrammarExplain("phrase-b");

    d2.resolve(jsonResponse({ explanation: "B result", fallback: false }));
    await flushAsyncWork();
    await p2;

    hook = useRenderGrammarHook(useGrammarExplanation, "article-1", () => "context");
    assert.equal(hook.grammarResult?.explanation, "B result");
    assert.equal(hook.grammarError, null);

    // Stale failure
    d1.reject(new Error("Network error"));
    await flushAsyncWork();
    await p1;

    hook = useRenderGrammarHook(useGrammarExplanation, "article-1", () => "context");
    assert.equal(hook.grammarError, null, "stale failure must not set error");
    assert.equal(hook.grammarResult?.explanation, "B result");
  });

  test("stale request cannot clear loading while newer request is pending", async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    let fetchCall = 0;
    globalThis.fetch = (async () => {
      fetchCall++;
      return fetchCall === 1 ? d1.promise : d2.promise;
    }) as typeof fetch;

    const { useGrammarExplanation } = await import(
      "@/components/reader/wordLookup/useGrammarExplanation"
    );

    let hook = useRenderGrammarHook(useGrammarExplanation, "article-1", () => "ctx");

    const p1 = hook.runGrammarExplain("x");
    hook.runGrammarExplain("y");

    hook = useRenderGrammarHook(useGrammarExplanation, "article-1", () => "ctx");
    assert.equal(hook.grammarLoading, true);

    d1.resolve(jsonResponse({ explanation: "stale", fallback: false }));
    await flushAsyncWork();
    await p1;

    hook = useRenderGrammarHook(useGrammarExplanation, "article-1", () => "ctx");
    assert.equal(hook.grammarLoading, true, "loading must remain true while newer request pending");

    d2.resolve(jsonResponse({ explanation: "fresh", fallback: false }));
    await flushAsyncWork();

    hook = useRenderGrammarHook(useGrammarExplanation, "article-1", () => "ctx");
    assert.equal(hook.grammarLoading, false);
    assert.equal(hook.grammarResult?.explanation, "fresh");
  });

  test("resetGrammar invalidates in-flight request", async () => {
    const d1 = deferred<Response>();
    globalThis.fetch = (async () => d1.promise) as typeof fetch;

    const { useGrammarExplanation } = await import(
      "@/components/reader/wordLookup/useGrammarExplanation"
    );

    let hook = useRenderGrammarHook(useGrammarExplanation, "article-1", () => "ctx");

    const p1 = hook.runGrammarExplain("phrase");
    hook.resetGrammar();

    hook = useRenderGrammarHook(useGrammarExplanation, "article-1", () => "ctx");
    assert.equal(hook.grammarLoading, false);
    assert.equal(hook.grammarResult, null);

    d1.resolve(jsonResponse({ explanation: "late", fallback: false }));
    await flushAsyncWork();
    await p1;

    hook = useRenderGrammarHook(useGrammarExplanation, "article-1", () => "ctx");
    assert.equal(hook.grammarResult, null, "reset must prevent stale response from populating state");
    assert.equal(hook.grammarLoading, false);
    assert.equal(hook.grammarError, null);
  });

  test("request payload and endpoint remain unchanged", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = init?.body as string;
      return jsonResponse({ explanation: "ok", fallback: false });
    }) as typeof fetch;

    const { useGrammarExplanation } = await import(
      "@/components/reader/wordLookup/useGrammarExplanation"
    );

    const hook = useRenderGrammarHook(useGrammarExplanation, "article-42", (p) => `The ${p} is here.`);
    await hook.runGrammarExplain("paradigm");

    assert.equal(capturedUrl, "/api/reader/article-42/grammar");
    assert.deepEqual(JSON.parse(capturedBody), {
      phrase: "paradigm",
      contextSentence: "The paradigm is here.",
    });
  });
});
