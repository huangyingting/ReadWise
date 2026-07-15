process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

type ArticleRow = {
  id: string;
  status: string;
  wordCount: number | null;
  content: string;
  speech: { words: unknown } | null;
  mediaAssets: Array<{ storageKey: string }>;
};

let articleFindManyImpl: (args: Record<string, unknown>) => Promise<ArticleRow[]>;
let deleteManyCount = 0;
let deleteManyArgs: Record<string, unknown> | null = null;
let disconnects = 0;

let storageKind: "local" | "azure" = "local";
let storageDeletes: string[] = [];
let hasStorage = true;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findMany: async (args: Record<string, unknown>) => articleFindManyImpl(args),
        },
        articleSpeech: {
          deleteMany: async (args: Record<string, unknown>) => {
            deleteManyArgs = args;
            return { count: deleteManyCount };
          },
        },
        $disconnect: async () => {
          disconnects++;
        },
      },
    },
  });

  mock.module("@/lib/content-pipeline", {
    namedExports: {
      articleHtmlToReaderText: (content: string) => content,
    },
  });

  mock.module("@/lib/storage", {
    namedExports: {
      mediaStorageKind: () => storageKind,
      getMediaStorage: () =>
        hasStorage
          ? {
              kind: "local",
              delete: async (key: string) => {
                storageDeletes.push(key);
              },
            }
          : null,
    },
  });

  mock.module("@/lib/speech", {
    namedExports: {
      parseSpeechTimingPayload: (value: unknown) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        const v = value as Record<string, unknown>;
        if (v.version !== 2 || v.timeUnit !== "ms" || v.textUnit !== "utf16") return null;
        const words = Array.isArray(v.words) ? (v.words as string[]) : [];
        const startMs = Array.isArray(v.startMs) ? (v.startMs as number[]) : [];
        const endMs = Array.isArray(v.endMs) ? (v.endMs as number[]) : [];
        if (words.length !== startMs.length || words.length !== endMs.length) return null;
        return {
          version: 2,
          provider: typeof v.provider === "string" ? v.provider : "unknown",
          timeUnit: "ms",
          textUnit: "utf16",
          words: words.map((word, i) => ({ word, startMs: startMs[i] ?? 0, endMs: endMs[i] ?? 0 })),
        };
      },
      extractSpeechBoundaryTokens: (text: string) =>
        text
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map((word) => ({ value: word, normalized: word.toLowerCase() })),
      buildTokenAlignment: (
        tokens: Array<{ normalized?: string }>,
        words: Array<{ word?: string }>,
      ) => {
        const alignment: Array<number | null> = [];
        const spanLengths: number[] = [];
        for (const word of words) {
          const normalized = word.word?.toLowerCase();
          const index = tokens.findIndex((token) => token.normalized === normalized);
          alignment.push(index >= 0 ? index : null);
          spanLengths.push(1);
        }
        return { alignment, spanLengths };
      },
    },
  });
});

beforeEach(() => {
  articleFindManyImpl = async () => [];
  deleteManyCount = 0;
  deleteManyArgs = null;
  disconnects = 0;
  storageKind = "local";
  storageDeletes = [];
  hasStorage = true;
});

test("analyze speech alignment parses ids and rejects invalid delete threshold", async () => {
  const { parseArgs } = await import("../scripts/analyze-speech-alignment");

  const parsed = parseArgs([
    "--ids",
    "a1,a2",
    "--batch-size",
    "7",
    "--progress-rows",
    "4",
    "--worst-limit",
    "3",
    "--delete-below",
    "0.8",
    "--apply",
    "a3",
  ]);

  assert.deepEqual(parsed.ids, ["a1", "a2", "a3"]);
  assert.equal(parsed.batchSize, 7);
  assert.equal(parsed.progressRows, 4);
  assert.equal(parsed.worstLimit, 3);
  assert.equal(parsed.deleteBelow, 0.8);
  assert.equal(parsed.apply, true);

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = ((...args: unknown[]) => warnings.push(args.join(" "))) as typeof console.warn;
  parseArgs(["--mystery-flag"]);
  console.warn = originalWarn;
  assert.match(warnings.join("\n"), /Unknown flag: --mystery-flag/);

  assert.throws(() => parseArgs(["--delete-below", "2"]), /--delete-below/);
});

test("analyze speech alignment converts timing JSON and computes coverage spans", async () => {
  const { timingWordsFromJson, coverage, coverageBucket } = await import(
    "../scripts/analyze-speech-alignment"
  );

  const words = timingWordsFromJson([{ word: "hello" }, {}, null, { word: "world" }]);
  assert.deepEqual(words, [{ word: "hello" }, { word: "world" }]);

  // V2 columnar payload — the current on-disk format; must parse correctly.
  const v2Words = timingWordsFromJson({
    version: 2,
    timeUnit: "ms",
    textUnit: "utf16",
    provider: "azure-batch",
    words: ["hello", "world"],
    startMs: [0, 500],
    endMs: [400, 900],
  });
  assert.deepEqual(v2Words, [
    { word: "hello", startMs: 0, endMs: 400 },
    { word: "world", startMs: 500, endMs: 900 },
  ]);

  const result = coverage(
    [
      { value: "hello", normalized: "hello" },
      { value: "world", normalized: "world" },
    ],
    words,
  );
  assert.deepEqual(result, { covered: 2, aligned: 2 });

  assert.equal(coverageBucket(1), "full");
  assert.equal(coverageBucket(0.97), "gte95");
  assert.equal(coverageBucket(0.5), "lt80");
});

test("analyze speech alignment id scan preserves requested order", async () => {
  const rows: ArticleRow[] = [
    {
      id: "b",
      status: "READY",
      wordCount: 2,
      content: "hello world",
      speech: {
        words: [{ word: "hello" }],
      },
      mediaAssets: [{ storageKey: "speech/b" }],
    },
    {
      id: "a",
      status: "READY",
      wordCount: 2,
      content: "hello world",
      speech: {
        words: [{ word: "hello" }, { word: "world" }],
      },
      mediaAssets: [{ storageKey: "speech/a" }],
    },
  ];
  articleFindManyImpl = async () => rows;

  const { analyzeIds } = await import("../scripts/analyze-speech-alignment");
  const result = await analyzeIds(["a", "b"]);

  assert.deepEqual(result.map((row) => row.id), ["a", "b"]);
  assert.equal(result[0]?.coverage, 1);
  assert.equal(result[1]?.coverage, 0.5);
});

test("analyze speech alignment full scan supports deletion dry-run and applied local cleanup", async () => {
  const pageOne: ArticleRow[] = [
    {
      id: "row-1",
      status: "READY",
      wordCount: 3,
      content: "alpha beta gamma",
      speech: {
        words: [{ word: "alpha" }, { word: "beta" }, { word: "gamma" }],
      },
      mediaAssets: [{ storageKey: "k1" }],
    },
    {
      id: "row-2",
      status: "READY",
      wordCount: 2,
      content: "alpha beta",
      speech: {
        words: [{ word: "alpha" }],
      },
      mediaAssets: [{ storageKey: "k2" }],
    },
  ];
  let callCount = 0;
  articleFindManyImpl = async () => {
    callCount++;
    return callCount === 1 ? pageOne : [];
  };

  deleteManyCount = 1;

  const { analyzeAll } = await import("../scripts/analyze-speech-alignment");
  const errors: string[] = [];
  const originalError = console.error;
  console.error = ((...args: unknown[]) => errors.push(args.join(" "))) as typeof console.error;

  try {
    const dryRun = await analyzeAll({
      ids: [],
      batchSize: 10,
      progressRows: 1,
      worstLimit: 10,
      deleteBelow: 0.9,
      apply: false,
      help: false,
    });

    assert.equal(dryRun.totalRows, 2);
    assert.equal(dryRun.buckets.full, 1);
    assert.equal(dryRun.buckets.lt80, 1);
    assert.equal(dryRun.deletion?.mode, "dry-run");
    assert.equal(dryRun.deletion?.selectedCount, 1);
    assert.equal(dryRun.deletion?.deletedCount, 0);
    assert.equal(storageDeletes.length, 0);
    assert.match(errors.join("\n"), /scanned=1/);

    callCount = 0;
    const applied = await analyzeAll({
      ids: [],
      batchSize: 10,
      progressRows: 0,
      worstLimit: 10,
      deleteBelow: 0.9,
      apply: true,
      help: false,
    });

    assert.equal(applied.deletion?.mode, "applied");
    assert.equal(applied.deletion?.deletedCount, 1);
    assert.deepEqual(storageDeletes, ["k2"]);
    assert.deepEqual(deleteManyArgs, {
      where: { articleId: { in: ["row-2"] } },
    });

    storageKind = "azure";
    hasStorage = false;
    callCount = 0;
    storageDeletes = [];
    const noLocalDelete = await analyzeAll({
      ids: [],
      batchSize: 10,
      progressRows: 0,
      worstLimit: 10,
      deleteBelow: 0.9,
      apply: true,
      help: false,
    });
    assert.equal(noLocalDelete.deletion?.localFiles.storageKind, "azure");
    assert.equal(storageDeletes.length, 0);
  } finally {
    console.error = originalError;
  }
});

test("analyze speech alignment main prints help, runs ids flow, and disconnects prisma", async () => {
  const { main } = await import("../scripts/analyze-speech-alignment");

  const originalArgv = process.argv;
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = ((...args: unknown[]) => logs.push(args.join(" "))) as typeof console.log;

  try {
    process.argv = [process.execPath, "scripts/analyze-speech-alignment.ts", "--help"];
    const helpCode = await main();
    assert.equal(helpCode, 0);
    assert.match(logs.join("\n"), /ReadWise speech alignment analyzer/);

    logs.length = 0;
    articleFindManyImpl = async () => [
      {
        id: "article-1",
        status: "READY",
        wordCount: 2,
        content: "one two",
        speech: {
          words: [{ word: "one" }, { word: "two" }],
        },
        mediaAssets: [{ storageKey: "speech-1" }],
      },
    ];
    process.argv = [process.execPath, "scripts/analyze-speech-alignment.ts", "--ids", "article-1"];

    const code = await main();
    assert.equal(code, 0);
    const payload = JSON.parse(logs[0] ?? "{}") as {
      result: { ids: string[]; articles: Array<{ id: string; coverage: number }> };
    };
    assert.deepEqual(payload.result.ids, ["article-1"]);
    assert.equal(payload.result.articles[0]?.coverage, 1);
    assert.equal(disconnects, 1);

    logs.length = 0;
    let analyzeAllCalls = 0;
    articleFindManyImpl = async () => {
      analyzeAllCalls++;
      if (analyzeAllCalls === 1) {
        return [
          {
            id: "scan-1",
            status: "READY",
            wordCount: 1,
            content: "one",
            speech: {
              words: [{ word: "one" }],
            },
            mediaAssets: [],
          },
        ];
      }
      return [];
    };
    process.argv = [process.execPath, "scripts/analyze-speech-alignment.ts"];
    const fullScanCode = await main();
    assert.equal(fullScanCode, 0);
    const fullScan = JSON.parse(logs[0] ?? "{}") as { result: { totalRows: number } };
    assert.equal(fullScan.result.totalRows, 1);
  } finally {
    process.argv = originalArgv;
    console.log = originalLog;
  }
});

test("analyze speech alignment entrypoint executes runCli when module is main", async () => {
  const scriptUrl = new URL("../scripts/analyze-speech-alignment.ts", import.meta.url).href;
  const scriptPath = fileURLToPath(scriptUrl);
  const originalArgv = process.argv;
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalError = console.error;
  const exits: Array<number | undefined> = [];

  let resolveExit: (() => void) | null = null;
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  process.argv = [process.execPath, scriptPath, "--help"];
  process.exit = ((code?: string | number | null | undefined): never => {
    exits.push(typeof code === "number" ? code : code == null ? 0 : Number(code));
    resolveExit?.();
    return undefined as never;
  }) as typeof process.exit;
  console.log = (() => undefined) as typeof console.log;
  console.error = (() => undefined) as typeof console.error;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { runAsCli } = await import("../scripts/analyze-speech-alignment");
    runAsCli(scriptUrl);
    await Promise.race([
      exited,
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => reject(new Error("analyze-speech entrypoint did not exit")), 1000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    process.argv = originalArgv;
    process.exit = originalExit;
    console.log = originalLog;
    console.error = originalError;
  }

  assert.deepEqual(exits, [0]);
});
