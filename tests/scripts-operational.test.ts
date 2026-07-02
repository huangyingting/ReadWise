process.env.LOG_LEVEL = "error";

import { beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

type ProcessStep = {
  step: string;
  status: string;
  detail?: string;
};

type ArticleResult = {
  articleId: string;
  title: string;
  ok: boolean;
  published: boolean;
  steps: ProcessStep[];
};

type ProcessOpts = {
  tts?: boolean;
  translateLangs?: string[];
};

type LoggerEntry = {
  name: string;
  level: "info" | "warn" | "error";
  args: unknown[];
};

const processPath = fileURLToPath(new URL("../scripts/process.ts", import.meta.url));
const pushPath = fileURLToPath(new URL("../scripts/push-reminders.ts", import.meta.url));
const workerPath = fileURLToPath(new URL("../scripts/worker.ts", import.meta.url));

let aiConfigured: boolean;
let speechConfigured: boolean;
let supportedLanguages: Set<string>;
let discoveredIds: string[];
let listCalls: Array<{ includePublished?: boolean; limit?: number }>;
let articleResults: Map<string, ArticleResult>;
let processCalls: Array<{ id: string; opts: ProcessOpts }>;
let enqueueFailures: Set<string>;
let enqueueCalls: Array<{ id: string; opts: ProcessOpts }>;
let pushConfigured: boolean;
let reminderResult: { usersWithDue: number; sent: number; skipped: number; suppressed: number };
let reminderCalls: number;
let loggerEntries: LoggerEntry[];
let workerCalls: unknown[];
let workerLoggerEntries: Array<{ level: "info" | "warn" | "error"; args: unknown[] }>;
let disconnects: number;

function resetState(): void {
  aiConfigured = true;
  speechConfigured = true;
  supportedLanguages = new Set(["es", "fr"]);
  discoveredIds = [];
  listCalls = [];
  articleResults = new Map();
  processCalls = [];
  enqueueFailures = new Set();
  enqueueCalls = [];
  pushConfigured = true;
  reminderResult = { usersWithDue: 1, sent: 1, skipped: 0, suppressed: 0 };
  reminderCalls = 0;
  loggerEntries = [];
  workerCalls = [];
  workerLoggerEntries = [];
  disconnects = 0;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  return JSON.stringify(value) ?? String(value);
}

function formatArgs(args: readonly unknown[]): string {
  return args.map(formatValue).join(" ");
}

async function captureConsole<T>(
  fn: () => T | Promise<T>,
): Promise<{ result: T; logs: string[]; warns: string[]; errors: string[] }> {
  const original = { log: console.log, warn: console.warn, error: console.error };
  const logs: string[] = [];
  const warns: string[] = [];
  const errors: string[] = [];
  console.log = ((...args: unknown[]) => {
    logs.push(formatArgs(args));
  }) as typeof console.log;
  console.warn = ((...args: unknown[]) => {
    warns.push(formatArgs(args));
  }) as typeof console.warn;
  console.error = ((...args: unknown[]) => {
    errors.push(formatArgs(args));
  }) as typeof console.error;
  try {
    return { result: await fn(), logs, warns, errors };
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
}

async function runMain(
  scriptPath: string,
  main: () => Promise<number>,
  args: string[],
): Promise<{ result: number; logs: string[]; warns: string[]; errors: string[] }> {
  const originalArgv = process.argv;
  process.argv = [process.execPath, scriptPath, ...args];
  try {
    return await captureConsole(main);
  } finally {
    process.argv = originalArgv;
  }
}

async function importAsEntrypoint<T>(
  specifier: string,
  scriptPath: string,
  args: string[],
): Promise<T> {
  const originalArgv = process.argv;
  const originalExit = process.exit;
  const originalConsole = { log: console.log, warn: console.warn, error: console.error };
  const exitCodes: Array<string | number | null | undefined> = [];
  let resolveExit!: () => void;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  process.argv = [process.execPath, scriptPath, ...args];
  process.exit = ((code?: string | number | null | undefined): never => {
    exitCodes.push(code);
    resolveExit();
    return undefined as never;
  }) as typeof process.exit;
  console.log = (() => {}) as typeof console.log;
  console.warn = (() => {}) as typeof console.warn;
  console.error = (() => {}) as typeof console.error;
  try {
    const imported = (await import(specifier)) as T;
    await Promise.race([
      exited,
      new Promise<void>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Entrypoint did not exit: ${specifier}`)), 1000);
      }),
    ]);
    assert.deepEqual(exitCodes, [0]);
    return imported;
  } finally {
    if (timeout) clearTimeout(timeout);
    process.argv = originalArgv;
    process.exit = originalExit;
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }
}

resetState();

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      $disconnect: async () => {
        disconnects++;
      },
    },
  },
});

mock.module("@/lib/processing/processor", {
  namedExports: {
    listUnprocessedArticleIds: async (opts: { includePublished?: boolean; limit?: number }) => {
      listCalls.push(opts);
      return discoveredIds;
    },
    processArticle: async (id: string, opts: ProcessOpts) => {
      processCalls.push({ id, opts });
      return articleResults.get(id) ?? null;
    },
  },
});

mock.module("@/lib/ai", {
  namedExports: {
    isAiConfigured: () => aiConfigured,
  },
});

mock.module("@/lib/speech", {
  namedExports: {
    isSpeechConfigured: () => speechConfigured,
  },
});

mock.module("@/lib/translation", {
  namedExports: {
    isSupportedLanguage: (lang: string) => supportedLanguages.has(lang),
  },
});

mock.module("@/lib/jobs", {
  namedExports: {
    enqueueArticleProcess: async (id: string, opts: ProcessOpts) => {
      enqueueCalls.push({ id, opts });
      if (enqueueFailures.has(id)) throw new Error(`enqueue failed for ${id}`);
      return { id: `job-${id}`, status: "PENDING" };
    },
  },
});

mock.module("@/lib/push/provider", {
  namedExports: {
    isPushConfigured: () => pushConfigured,
  },
});

mock.module("@/lib/push/scheduler", {
  namedExports: {
    sendDueReminders: async () => {
      reminderCalls++;
      return reminderResult;
    },
  },
});

mock.module("@/lib/observability/logger", {
  namedExports: {
    createLogger: (name: string) => ({
      info: (...args: unknown[]) => loggerEntries.push({ name, level: "info", args }),
      warn: (...args: unknown[]) => loggerEntries.push({ name, level: "warn", args }),
      error: (...args: unknown[]) => loggerEntries.push({ name, level: "error", args }),
    }),
  },
});

mock.module("@/lib/worker", {
  namedExports: {
    createConsoleLogger: () => ({
      info: (...args: unknown[]) => workerLoggerEntries.push({ level: "info", args }),
      warn: (...args: unknown[]) => workerLoggerEntries.push({ level: "warn", args }),
      error: (...args: unknown[]) => workerLoggerEntries.push({ level: "error", args }),
    }),
    runJobWorker: async (opts: unknown) => {
      workerCalls.push(opts);
    },
  },
});

const processScript = await importAsEntrypoint<typeof import("../scripts/process")>(
  "../scripts/process",
  processPath,
  ["--help"],
);
const pushScript = await importAsEntrypoint<typeof import("../scripts/push-reminders")>(
  "../scripts/push-reminders",
  pushPath,
  ["--help"],
);
const workerScript = await importAsEntrypoint<typeof import("../scripts/worker")>(
  "../scripts/worker",
  workerPath,
  ["--help"],
);

beforeEach(() => {
  resetState();
});

test("process main covers help, invalid translation, and empty discovery paths", async () => {
  let run = await runMain(processPath, processScript.main, []);
  assert.equal(run.result, 0);
  assert.match(run.logs.join("\n"), /ReadWise article processor/);

  run = await runMain(processPath, processScript.main, ["--bogus"]);
  assert.equal(run.result, 0);
  assert.match(run.warns.join("\n"), /Unknown flag: --bogus/);

  supportedLanguages = new Set(["es"]);
  run = await runMain(processPath, processScript.main, ["--translate", "zz"]);
  assert.equal(run.result, 1);
  assert.match(run.errors.join("\n"), /Unsupported translation language: "zz"/);

  discoveredIds = [];
  run = await runMain(processPath, processScript.main, ["--all"]);
  assert.equal(run.result, 0);
  assert.deepEqual(listCalls, [{ includePublished: false, limit: undefined }]);
  assert.match(run.logs.join("\n"), /No unprocessed articles found/);
});

test("process main discovers ids and reports enqueue successes and failures", async () => {
  aiConfigured = false;
  speechConfigured = false;
  discoveredIds = ["draft-1", "article-1"];
  enqueueFailures.add("draft-1");

  const run = await runMain(processPath, processScript.main, [
    "article-1",
    "--all",
    "--include-published",
    "--limit",
    "2",
    "--tts",
    "--translate",
    "es,fr",
    "--enqueue",
  ]);

  assert.equal(run.result, 1);
  assert.deepEqual(listCalls, [{ includePublished: true, limit: 2 }]);
  assert.deepEqual(enqueueCalls, [
    { id: "article-1", opts: { tts: true, translateLangs: ["es", "fr"] } },
    { id: "draft-1", opts: { tts: true, translateLangs: ["es", "fr"] } },
  ]);
  assert.match(run.warns.join("\n"), /Azure OpenAI is not configured/);
  assert.match(run.warns.join("\n"), /Azure Speech is not configured/);
  assert.match(run.logs.join("\n"), /Enqueuing 2 ARTICLE_PROCESS job/);
  assert.match(run.logs.join("\n"), /Done\. enqueued=1 failed=1/);
  assert.match(run.errors.join("\n"), /could not enqueue draft-1/);
});

test("process main summarizes inline processing results and failures", async () => {
  articleResults.set("published", {
    articleId: "published",
    title: "Published article",
    ok: true,
    published: true,
    steps: [{ step: "difficulty", status: "completed", detail: "deterministic" }],
  });
  articleResults.set("draft", {
    articleId: "draft",
    title: "Draft article",
    ok: true,
    published: false,
    steps: [{ step: "tts", status: "skipped" }],
  });
  articleResults.set("failed", {
    articleId: "failed",
    title: "Failed article",
    ok: false,
    published: false,
    steps: [{ step: "quiz", status: "failed", detail: "provider unavailable" }],
  });

  const run = await runMain(processPath, processScript.main, [
    "published",
    "missing",
    "draft",
    "failed",
    "--translate",
    "es",
  ]);

  assert.equal(run.result, 1);
  assert.deepEqual(processCalls, [
    { id: "published", opts: { tts: false, translateLangs: ["es"] } },
    { id: "missing", opts: { tts: false, translateLangs: ["es"] } },
    { id: "draft", opts: { tts: false, translateLangs: ["es"] } },
    { id: "failed", opts: { tts: false, translateLangs: ["es"] } },
  ]);
  assert.match(run.logs.join("\n"), /✓ Published article/);
  assert.match(run.logs.join("\n"), /✗ article not found: missing/);
  assert.match(run.logs.join("\n"), /• Draft article/);
  assert.match(run.logs.join("\n"), /✗ Failed article/);
  assert.match(run.logs.join("\n"), /Done\. processed=4 published=1 failed=1 missing=1/);
});

test("push-reminders main covers help, configuration, dry-run, and send paths", async () => {
  let run = await runMain(pushPath, pushScript.main, ["--help"]);
  assert.equal(run.result, 0);
  assert.match(run.logs.join("\n"), /push-reminders — send SRS review push notifications/);

  pushConfigured = false;
  run = await runMain(pushPath, pushScript.main, []);
  assert.equal(run.result, 0);
  assert.equal(reminderCalls, 0);
  assert.ok(loggerEntries.some((entry) => entry.level === "warn" && formatArgs(entry.args).includes("VAPID keys not configured")));

  resetState();
  run = await runMain(pushPath, pushScript.main, ["--dry-run"]);
  assert.equal(run.result, 0);
  assert.equal(reminderCalls, 0);
  assert.ok(loggerEntries.some((entry) => entry.level === "info" && formatArgs(entry.args).includes("dry-run")));

  resetState();
  reminderResult = { usersWithDue: 3, sent: 2, skipped: 1, suppressed: 4 };
  run = await runMain(pushPath, pushScript.main, []);
  assert.equal(run.result, 0);
  assert.equal(reminderCalls, 1);
  assert.ok(loggerEntries.some((entry) => entry.level === "info" && formatArgs(entry.args).includes("sending due-card")));
  assert.ok(loggerEntries.some((entry) => entry.level === "info" && formatArgs(entry.args).includes('"sent":2')));
});

test("worker main covers help, translation validation, provider warnings, and worker options", async () => {
  let run = await runMain(workerPath, workerScript.main, ["--help"]);
  assert.equal(run.result, 0);
  assert.match(run.logs.join("\n"), /ReadWise background processing worker/);

  run = await runMain(workerPath, workerScript.main, ["--bogus", "--once"]);
  assert.equal(run.result, 0);
  assert.match(run.warns.join("\n"), /Unknown flag: --bogus/);
  assert.equal(workerCalls.length, 1);

  resetState();
  supportedLanguages = new Set(["es"]);
  run = await runMain(workerPath, workerScript.main, ["--translate", "zz"]);
  assert.equal(run.result, 1);
  assert.match(run.errors.join("\n"), /Unsupported translation language: "zz"/);

  resetState();
  aiConfigured = false;
  speechConfigured = false;
  run = await runMain(workerPath, workerScript.main, [
    "--once",
    "--interval",
    "7",
    "--lock-ttl",
    "9",
    "--tts",
    "--translate",
    "es,fr",
  ]);

  assert.equal(run.result, 0);
  assert.match(run.warns.join("\n"), /Azure OpenAI is not configured/);
  assert.match(run.warns.join("\n"), /Azure Speech is not configured/);
  assert.equal(workerCalls.length, 1);
  const opts = workerCalls[0] as {
    pollIntervalMs: number;
    lockTtlMs: number;
    once: boolean;
    signal: AbortSignal;
    logger: unknown;
    process: ProcessOpts;
  };
  assert.equal(opts.pollIntervalMs, 7);
  assert.equal(opts.lockTtlMs, 9);
  assert.equal(opts.once, true);
  assert.equal(opts.signal.aborted, false);
  assert.deepEqual(opts.process, { tts: true, translateLangs: ["es", "fr"] });
});
