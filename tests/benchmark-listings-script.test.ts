process.env.LOG_LEVEL = "error";

import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

type Page = { articles: unknown[]; hasMore: boolean };

const ENV_KEYS = [
  "DATABASE_URL",
  "READWISE_BENCHMARK_ALLOW_REMOTE_DB",
  "READWISE_DISABLE_LISTING_CACHE",
] as const;

let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
let listCalls: unknown[];
let feedCalls: unknown[];
let disconnects: number;
let importCounter = 0;

const mutableEnv = process.env as Record<string, string | undefined>;

function resetState(): void {
  listCalls = [];
  feedCalls = [];
  disconnects = 0;
}

function saveEnv(): void {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = mutableEnv[key];
    delete mutableEnv[key];
  }
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete mutableEnv[key];
    else mutableEnv[key] = value;
  }
}

function captureConsole<T>(fn: () => T | Promise<T>): Promise<{ result: T; logs: string[]; errors: string[] }> {
  const original = { log: console.log, error: console.error };
  const logs: string[] = [];
  const errors: string[] = [];
  console.log = ((...args: unknown[]) => logs.push(args.join(" "))) as typeof console.log;
  console.error = ((...args: unknown[]) => errors.push(args.join(" "))) as typeof console.error;
  return Promise.resolve()
    .then(fn)
    .then((result) => ({ result, logs, errors }))
    .finally(() => {
      console.log = original.log;
      console.error = original.error;
    });
}

async function importScript() {
  importCounter += 1;
  return import(`../scripts/benchmark-listings.ts?benchmarkTest=${importCounter}`);
}

beforeEach(() => {
  saveEnv();
  resetState();
});

afterEach(() => {
  restoreEnv();
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      $disconnect: async () => {
        disconnects++;
      },
    },
  },
});

mock.module("@/lib/article-library", {
  namedExports: {
    listCategoryPage: async (...args: unknown[]): Promise<Page> => {
      listCalls.push(args);
      return { articles: [{ id: "article-1" }], hasMore: false };
    },
  },
});

mock.module("@/lib/feed", {
  namedExports: {
    getPersonalizedFeed: async (...args: unknown[]): Promise<Page> => {
      feedCalls.push(args);
      return { articles: [{ id: "article-2" }], hasMore: true };
    },
  },
});

test("benchmark listings script runs browse and optional feed scenarios without content output", async () => {
  const { disconnectIfNeeded, main } = await importScript();
  const originalArgv = process.argv;
  process.argv = [
    process.execPath,
    "scripts/benchmark-listings.ts",
    "--iterations",
    "2",
    "--limit",
    "7",
    "--category",
    "science",
    "--level",
    "B1",
    "--query",
    "climate",
    "--user-id",
    "user-123",
    "--cold",
  ];

  try {
    const { result, logs, errors } = await captureConsole(() => main());

    assert.equal(result, 0);
    assert.equal(listCalls.length, 2);
    assert.equal(feedCalls.length, 2);
    assert.equal(process.env.READWISE_DISABLE_LISTING_CACHE, "1");
    assert.equal(errors.join("\n"), "");
    assert.match(logs.join("\n"), /browse-listing/);
    assert.match(logs.join("\n"), /personalized-feed/);
    assert.doesNotMatch(logs.join("\n"), /user-123|climate|article-1|article-2/);
    assert.equal(disconnects, 0);
    await disconnectIfNeeded();
    assert.equal(disconnects, 1);
  } finally {
    process.argv = originalArgv;
  }
});

test("benchmark listings script prints help without loading database-backed modules", async () => {
  const { main } = await importScript();
  const originalArgv = process.argv;
  process.argv = [process.execPath, "scripts/benchmark-listings.ts", "--help"];

  try {
    const { result, logs, errors } = await captureConsole(() => main());

    assert.equal(result, 0);
    assert.equal(listCalls.length, 0);
    assert.equal(feedCalls.length, 0);
    assert.match(logs.join("\n"), /Usage:/);
    assert.match(logs.join("\n"), /READWISE_BENCHMARK_ALLOW_REMOTE_DB=1/);
    assert.equal(errors.join("\n"), "");
  } finally {
    process.argv = originalArgv;
  }
});

test("benchmark listings script refuses non-SQLite databases unless explicitly allowed", async () => {
  process.env.DATABASE_URL = "postgresql://localhost:5432/readwise_benchmark";
  const { main } = await importScript();
  const originalArgv = process.argv;
  process.argv = [process.execPath, "scripts/benchmark-listings.ts"];

  try {
    const { result, logs, errors } = await captureConsole(() => main());

    assert.equal(result, 1);
    assert.equal(listCalls.length, 0);
    assert.equal(feedCalls.length, 0);
    assert.equal(logs.join("\n"), "");
    assert.match(errors.join("\n"), /Refusing to benchmark a non-SQLite DATABASE_URL/);
    assert.doesNotMatch(errors.join("\n"), /localhost|5432|readwise_benchmark/);
  } finally {
    process.argv = originalArgv;
  }
});

test("benchmark listings CLI disconnects and exits on success or failure", async () => {
  const { runBenchmarkCli } = await importScript();
  const exits: Array<number | undefined> = [];
  const errors: string[] = [];

  await runBenchmarkCli({
    main: async () => 2,
    disconnect: async () => {
      disconnects++;
    },
    error: (...args: unknown[]) => errors.push(args.join(" ")),
    exit: (code?: number) => {
      exits.push(code);
    },
  });
  assert.deepEqual([...exits], [2]);
  assert.equal(disconnects, 1);
  assert.equal(errors.length, 0);

  await runBenchmarkCli({
    main: async () => {
      throw new Error("benchmark boom");
    },
    disconnect: async () => {
      disconnects++;
    },
    error: (...args: unknown[]) => errors.push(args.join(" ")),
    exit: (code?: number) => {
      exits.push(code);
    },
  });
  assert.deepEqual([...exits], [2, 1]);
  assert.equal(disconnects, 2);
  assert.match(errors.join("\n"), /benchmark listings failed:/);
  assert.match(errors.join("\n"), /benchmark boom/);
});
