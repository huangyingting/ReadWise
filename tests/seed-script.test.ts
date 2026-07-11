process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

type SeedStats = {
  discovered: number;
  saved: number;
  duplicates: number;
  enriched: number;
  published: number;
  failed: number;
  articleIds: string[];
};

let runSeedCalls: Array<Record<string, unknown>> = [];
let runSeedResult: SeedStats = {
  discovered: 3,
  saved: 2,
  duplicates: 1,
  enriched: 2,
  published: 2,
  failed: 0,
  articleIds: ["a1", "a2"],
};
let aiConfigured = true;
let speechConfigured = true;
let supportedLanguages = new Set(["es", "fr"]);

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        $disconnect: async () => undefined,
      },
    },
  });

  mock.module("@/lib/seed", {
    namedExports: {
      DEFAULT_SEED_LIMIT: 5,
      runSeed: async (options: Record<string, unknown>) => {
        runSeedCalls.push(options);
        return runSeedResult;
      },
    },
  });

  mock.module("@/lib/scraper/providers", {
    namedExports: {
      PROVIDERS: [
        { key: "alpha", name: "Alpha" },
        { key: "beta", name: "Beta" },
      ],
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
});

beforeEach(() => {
  runSeedCalls = [];
  runSeedResult = {
    discovered: 3,
    saved: 2,
    duplicates: 1,
    enriched: 2,
    published: 2,
    failed: 0,
    articleIds: ["a1", "a2"],
  };
  aiConfigured = true;
  speechConfigured = true;
  supportedLanguages = new Set(["es", "fr"]);
});

test("seed script parses provider, limit, and translation args", async () => {
  const { parseArgs } = await import("../scripts/seed");

  const args = parseArgs([
    "--provider",
    "alpha,beta",
    "--limit",
    "9",
    "--no-tts",
    "--translate",
    "es,fr",
  ]);

  assert.deepEqual(args.providers, ["alpha", "beta"]);
  assert.equal(args.limit, 9);
  assert.equal(args.tts, false);
  assert.deepEqual(args.translateLangs, ["es", "fr"]);

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = ((...parts: unknown[]) => warnings.push(parts.join(" "))) as typeof console.warn;
  const allArgs = parseArgs(["--all", "--tts", "--unknown", "gamma"]);
  console.warn = originalWarn;
  assert.deepEqual(allArgs.providers, ["all", "gamma"]);
  assert.equal(allArgs.tts, true);
  assert.match(warnings.join("\n"), /Unknown flag: --unknown/);
});

test("seed script help and invalid translation paths", async () => {
  const { main } = await import("../scripts/seed");

  const originalArgv = process.argv;
  const originalLog = console.log;
  const originalError = console.error;
  const logs: string[] = [];
  const errors: string[] = [];
  console.log = ((...args: unknown[]) => logs.push(args.join(" "))) as typeof console.log;
  console.error = ((...args: unknown[]) => errors.push(args.join(" "))) as typeof console.error;

  try {
    process.argv = [process.execPath, "scripts/seed.ts", "--help"];
    let code = await main();
    assert.equal(code, 0);
    assert.match(logs.join("\n"), /ReadWise database seeder/);

    logs.length = 0;
    process.argv = [process.execPath, "scripts/seed.ts", "--translate", "zz"];
    code = await main();
    assert.equal(code, 1);
    assert.match(errors.join("\n"), /Unsupported translation language/);
    assert.equal(runSeedCalls.length, 0);
  } finally {
    process.argv = originalArgv;
    console.log = originalLog;
    console.error = originalError;
  }
});

test("seed script warns for optional providers and returns status from runSeed summary", async () => {
  const { main } = await import("../scripts/seed");

  aiConfigured = false;
  speechConfigured = false;

  const originalArgv = process.argv;
  const originalWarn = console.warn;
  const originalLog = console.log;
  const warns: string[] = [];
  const logs: string[] = [];
  console.warn = ((...args: unknown[]) => warns.push(args.join(" "))) as typeof console.warn;
  console.log = ((...args: unknown[]) => logs.push(args.join(" "))) as typeof console.log;

  try {
    process.argv = [
      process.execPath,
      "scripts/seed.ts",
      "--provider",
      "alpha",
      "--limit",
      "2",
      "--translate",
      "es",
    ];
    let code = await main();
    assert.equal(code, 0);
    assert.equal(runSeedCalls.length, 1);
    assert.match(warns.join("\n"), /Azure OpenAI is not configured/);
    assert.match(warns.join("\n"), /Azure Speech is not configured/);
    assert.match(logs.join("\n"), /Done\. discovered=3/);
    assert.match(logs.join("\n"), /Seeded article ids: a1, a2/);

    runSeedResult = {
      discovered: 1,
      saved: 0,
      duplicates: 0,
      enriched: 0,
      published: 0,
      failed: 1,
      articleIds: [],
    };
    process.argv = [process.execPath, "scripts/seed.ts", "--provider", "beta"];
    code = await main();
    assert.equal(code, 1);
  } finally {
    process.argv = originalArgv;
    console.warn = originalWarn;
    console.log = originalLog;
  }
});

test("seed script entrypoint executes runCli when module is main", async () => {
  const scriptUrl = new URL("../scripts/seed.ts", import.meta.url).href;
  const scriptPath = fileURLToPath(scriptUrl);
  const originalArgv = process.argv;
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalWarn = console.warn;
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
  console.warn = (() => undefined) as typeof console.warn;
  console.error = (() => undefined) as typeof console.error;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { runAsCli } = await import("../scripts/seed");
    runAsCli(scriptUrl);
    await Promise.race([
      exited,
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => reject(new Error("seed entrypoint did not exit")), 1000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    process.argv = originalArgv;
    process.exit = originalExit;
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }

  assert.deepEqual(exits, [0]);
});
