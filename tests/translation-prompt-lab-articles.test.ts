process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

type ArticleRow = { id: string; title: string; content: string; category: string | null };
type BodyResult = {
  content: string;
  sourceBlockCount: number;
  chunkCount: number;
  repairedChunkCount: number;
  suspiciousBlockCount: number;
};

let sourceRows: ArticleRow[] = [];
const sourceSql: Array<{ sql: string; params: unknown[] }> = [];
let sourceClosed = 0;
let storeClosed = 0;
const existingHashes = new Map<string, string>();
const upserts: Record<string, unknown>[] = [];
const recordedErrors: unknown[][] = [];
const bodyQueue: Array<BodyResult | Error> = [];
const titleQueue: Array<{ text: string } | Error> = [];

const fakeStore = {
  close: () => {
    storeClosed += 1;
  },
};

before(() => {
  mock.module("../scripts/translation-prompt-lab/db.ts", {
    namedExports: {
      openReadOnly: () => ({
        prepare: (sql: string) => ({
          all: (...params: unknown[]) => {
            sourceSql.push({ sql, params });
            return sourceRows;
          },
        }),
        close: () => {
          sourceClosed += 1;
        },
      }),
    },
  });
  mock.module("../scripts/translation-prompt-lab/html-blocks.ts", {
    namedExports: {
      translateArticleBlocks: async () => {
        const next = bodyQueue.shift();
        if (next instanceof Error) throw next;
        if (!next) throw new Error("missing body result");
        return next;
      },
    },
  });
  mock.module("../scripts/translation-prompt-lab/concurrency.ts", {
    namedExports: {
      mapWithConcurrency: async <T, R>(
        items: readonly T[],
        _concurrency: number,
        worker: (item: T, index: number) => Promise<R>,
      ) => Promise.all(items.map(worker)),
    },
  });
  mock.module("../scripts/translation-prompt-lab/prompts.ts", {
    namedExports: {
      recommendedPromptForCategory: (category: string | null) => ({
        id: `${category ?? "narrative"}/recommended`,
        profile: "news",
        label: "recommended",
        systemPrompt: "system prompt",
      }),
    },
  });
  mock.module("../scripts/translation-prompt-lab/store.ts", {
    namedExports: {
      openTranslationStore: () => fakeStore,
      getExistingHash: (_db: unknown, providerDb: string, articleId: string, lang: string) =>
        existingHashes.get(`${providerDb}:${articleId}:${lang}`) ?? null,
      upsertTranslation: (_db: unknown, row: Record<string, unknown>) => upserts.push(row),
      recordError: (...args: unknown[]) => recordedErrors.push(args),
    },
  });
  mock.module("../scripts/translation-prompt-lab/vllm-client.ts", {
    namedExports: {
      chatCompleteWithRetry: async () => {
        const next = titleQueue.shift();
        if (next instanceof Error) throw next;
        if (!next) throw new Error("missing title result");
        return { ...next, finishReason: "stop", usage: null, durationMs: 1 };
      },
    },
  });
});

beforeEach(() => {
  sourceRows = [];
  sourceSql.length = 0;
  sourceClosed = 0;
  storeClosed = 0;
  existingHashes.clear();
  upserts.length = 0;
  recordedErrors.length = 0;
  bodyQueue.length = 0;
  titleQueue.length = 0;
});

function body(overrides: Partial<BodyResult> = {}): BodyResult {
  return {
    content: "第一段\n\n第二段",
    sourceBlockCount: 2,
    chunkCount: 1,
    repairedChunkCount: 0,
    suspiciousBlockCount: 0,
    ...overrides,
  };
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    providerDb: "workinprogress",
    lang: "zh-CN",
    limit: null,
    categories: null,
    articleIds: null,
    concurrency: 2,
    force: false,
    dryRun: false,
    outDir: "/tmp/readwise-provider-translations",
    ...overrides,
  };
}

async function withArgv<T>(args: string[], run: () => Promise<T>): Promise<T> {
  const original = process.argv;
  process.argv = [process.execPath, "translate-articles.ts", ...args];
  try {
    return await run();
  } finally {
    process.argv = original;
  }
}

test("article translator pure helpers hash, translate titles, and report every QA flag", async () => {
  const script = await import("../scripts/translation-prompt-lab/translate-articles");

  assert.equal(script.contentHash("a", "bc"), script.contentHash("a", "bc"));
  assert.notEqual(script.contentHash("ab", "c"), script.contentHash("a", "bc"));
  assert.equal(await script.translateTitle("   ", "system", 0.2), "");
  titleQueue.push({ text: "  标题  " });
  assert.equal(await script.translateTitle("Title", "system", 0.2), "标题");

  assert.deepEqual(script.qaFlags("", 0, 1), ["empty-output", "low-cjk-ratio", "block-count-mismatch"]);
  const noisy = script.qaFlags(`\`\`\`${"a".repeat(200)}`, 100, 1);
  assert.ok(noisy.includes("markdown-fence"));
  assert.ok(noisy.includes("low-cjk-ratio"));
  assert.ok(noisy.includes("length-ratio-out-of-range"));
  assert.ok(script.qaFlags("中文", 1_000, 1).includes("length-ratio-out-of-range"));
  assert.deepEqual(script.qaFlags("这是完整的中文翻译", 20, 1), []);
});

test("article translator rejects a missing provider database", async () => {
  const { runTranslateArticles } = await import("../scripts/translation-prompt-lab/translate-articles");
  await assert.rejects(
    () => runTranslateArticles(options({ providerDb: `missing-${Date.now()}` }) as never),
    /Provider db not found/,
  );
  assert.equal(sourceClosed, 0);
});

test("article translator dry-run applies filters and limits without provider calls or a store", async () => {
  sourceRows = [
    { id: "one", title: "One", content: "<p>one</p>", category: "science" },
    { id: "two", title: "Two", content: "<p>two</p>", category: "science" },
  ];
  const { runTranslateArticles } = await import("../scripts/translation-prompt-lab/translate-articles");

  const stats = await runTranslateArticles(options({
    dryRun: true,
    categories: ["science"],
    articleIds: ["one", "two"],
    limit: 1,
  }) as never);

  assert.deepEqual(stats, {
    total: 1,
    translated: 1,
    skippedUnchanged: 0,
    errors: 0,
    flagged: 0,
    repairedChunks: 0,
  });
  assert.match(sourceSql[0]!.sql, /category IN \(\?\)/);
  assert.match(sourceSql[0]!.sql, /id IN \(\?,\?\)/);
  assert.deepEqual(sourceSql[0]!.params, ["science", "one", "two"]);
  assert.equal(titleQueue.length, 0);
  assert.equal(sourceClosed, 1);
  assert.equal(storeClosed, 0);
});

test("article translator skips unchanged rows, retries transient failures, persists QA, and records terminal errors", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "log", (message: string) => logs.push(message));
  sourceRows = [
    { id: "skip", title: "Skip", content: "<p>same</p>", category: "world" },
    { id: "flagged", title: "Flagged", content: "<p>source body</p>", category: "science" },
    { id: "retry", title: "Retry", content: "<p>source body</p>", category: null },
    { id: "error", title: "Error", content: "<p>source body</p>", category: "world" },
  ];
  const script = await import("../scripts/translation-prompt-lab/translate-articles");
  existingHashes.set(
    "workinprogress:skip:zh-CN",
    script.contentHash("Skip", "<p>same</p>"),
  );
  titleQueue.push(
    { text: "标题一" },
    { text: "重试标题一" },
    { text: "重试标题二" },
    { text: "失败标题一" },
    { text: "失败标题二" },
  );
  bodyQueue.push(
    body({
      content: "English only",
      sourceBlockCount: 1,
      repairedChunkCount: 2,
      suspiciousBlockCount: 1,
    }),
    new Error("transient body failure"),
    body(),
    new Error("persistent body failure"),
    new Error("persistent body failure"),
  );

  const stats = await script.runTranslateArticles(options() as never);

  assert.deepEqual(stats, {
    total: 4,
    translated: 2,
    skippedUnchanged: 1,
    errors: 1,
    flagged: 1,
    repairedChunks: 2,
  });
  assert.equal(upserts.length, 2);
  assert.deepEqual(upserts[0]?.qaFlags, ["low-cjk-ratio", "suspicious-untranslated-block"]);
  assert.equal(upserts[0]?.promptVariantId, "science/recommended");
  assert.equal(recordedErrors.length, 1);
  assert.match(String(recordedErrors[0]!.at(-1)), /persistent body failure/);
  assert.equal(sourceClosed, 1);
  assert.equal(storeClosed, 1);
  assert.match(logs.join("\n"), /translated=2 skipped=1 errors=1/);
});

test("article translator force mode bypasses content-hash skips", async () => {
  sourceRows = [{ id: "one", title: "One", content: "<p>source</p>", category: "world" }];
  existingHashes.set("workinprogress:one:zh-CN", "same");
  titleQueue.push({ text: "标题" });
  bodyQueue.push(body());
  const { runTranslateArticles } = await import("../scripts/translation-prompt-lab/translate-articles");

  const stats = await runTranslateArticles(options({ force: true }) as never);
  assert.equal(stats.translated, 1);
  assert.equal(stats.skippedUnchanged, 0);
});

test("article translator CLI parses bounded filters and maps help/success/error exits", async (t) => {
  const logs: string[] = [];
  const warnings: string[] = [];
  t.mock.method(console, "log", (message: string) => logs.push(message));
  t.mock.method(console, "warn", (message: string) => warnings.push(message));
  const script = await import("../scripts/translation-prompt-lab/translate-articles");

  const parsed = script.parseArgs([
    "--db", "workinprogress",
    "--lang", "zh-CN",
    "--limit", "bad",
    "--category", "science, world,",
    "--article-id", "one,two",
    "--concurrency", "4",
    "--force",
    "--dry-run",
    "--out-dir", "/tmp/out",
    "--unknown",
  ]);
  assert.equal(parsed.limit, 1);
  assert.deepEqual(parsed.categories, ["science", "world"]);
  assert.deepEqual(parsed.articleIds, ["one", "two"]);
  assert.equal(parsed.force, true);
  assert.equal(parsed.dryRun, true);
  assert.equal(warnings.length, 1);

  assert.equal(await withArgv([], () => script.main()), 2);
  assert.equal(await withArgv(["--db", "workinprogress", "--help"], () => script.main()), 0);

  sourceRows = [{ id: "one", title: "One", content: "<p>source</p>", category: "world" }];
  assert.equal(await withArgv(["--db", "workinprogress", "--dry-run", "--limit", "1"], () => script.main()), 0);

  titleQueue.push({ text: "one" }, { text: "two" });
  bodyQueue.push(new Error("failed"), new Error("failed"));
  assert.equal(await withArgv(["--db", "workinprogress", "--force"], () => script.main()), 1);
  assert.match(logs.join("\n"), /errors=1/);
});
