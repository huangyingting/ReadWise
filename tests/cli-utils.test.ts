/**
 * Unit tests for scripts/lib/cli.ts (REF-034).
 *
 * Covers the shared CLI runtime utilities: parseFlag, parseString,
 * parsePositiveInt, addUniqueFromCsv, warnUnknown, isMain, and the
 * parseArgs function exported from each migrated script (process, scrape,
 * worker, push-reminders, migrate-storage).
 */
process.env.LOG_LEVEL = "error";

import { test, before, describe, mock } from "node:test";
import assert from "node:assert/strict";

// ── Stub heavy modules before any script imports ───────────────────────────

before(() => {
  mock.module("@/lib/prisma", { namedExports: { prisma: { $disconnect: async () => {} } } });
  mock.module("@/lib/processor", {
    namedExports: {
      processArticle: async () => null,
      listUnprocessedArticleIds: async () => [],
    },
  });
  mock.module("@/lib/ai", { namedExports: { isAiConfigured: () => false } });
  mock.module("@/lib/speech", { namedExports: { isSpeechConfigured: () => false } });
  mock.module("@/lib/translation", {
    namedExports: { isSupportedLanguage: () => true },
  });
  mock.module("@/lib/jobs", {
    namedExports: { enqueueArticleProcess: async () => ({ id: "j1", status: "PENDING" }) },
  });
  mock.module("@/lib/scraper/providers", {
    namedExports: {
      PROVIDERS: [{ key: "bbc", name: "BBC", hostnames: ["bbc.com"] }],
      getProvider: () => null,
      providerForUrl: () => null,
    },
  });
  mock.module("@/lib/scraper/extract", { namedExports: { extractArticle: () => null } });
  mock.module("@/lib/scraper", {
    namedExports: {
      discoverProviderUrls: async () => [],
      saveDraftArticle: async () => ({ status: "saved", id: "a1", article: {} }),
      scrapeAndSave: async () => ({ status: "saved", id: "a1", article: {} }),
      scrapeUrl: async () => null,
    },
  });
  mock.module("@/lib/content-sources", {
    namedExports: {
      isProviderEnabled: async () => false,
      recordCrawlRun: async () => {},
    },
  });
  mock.module("@/lib/worker", {
    namedExports: {
      runJobWorker: async () => {},
      createConsoleLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
    },
  });
  mock.module("@/lib/seed", {
    namedExports: {
      runSeed: async () => ({
        discovered: 0, saved: 0, duplicates: 0, enriched: 0, published: 0, failed: 0, articleIds: [],
      }),
      DEFAULT_SEED_LIMIT: 5,
    },
  });
  mock.module("@/lib/push", {
    namedExports: {
      sendDueReminders: async () => ({ usersWithDue: 0, sent: 0, skipped: 0, suppressed: 0 }),
      isPushConfigured: () => false,
    },
  });
  mock.module("@/lib/logger", {
    namedExports: {
      createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
    },
  });
  mock.module("@/lib/storage", {
    namedExports: {
      migrateArticleSpeechToStorage: async () => ({
        skippedNoStorage: true,
        storageKind: "database",
        scanned: 0,
        migrated: 0,
        failed: 0,
      }),
    },
  });
});

// ── Shared CLI helpers ─────────────────────────────────────────────────────

describe("parseFlag", async () => {
  const { parseFlag } = await import("../scripts/lib/cli");

  test("returns true when flag is present", () => {
    assert.equal(parseFlag(["--dry-run", "--other"], "--dry-run"), true);
  });

  test("returns false when flag is absent", () => {
    assert.equal(parseFlag(["--other"], "--dry-run"), false);
  });

  test("returns false for empty argv", () => {
    assert.equal(parseFlag([], "--help"), false);
  });

  test("matches any of multiple flag alternatives", () => {
    assert.equal(parseFlag(["-h"], "--help", "-h"), true);
    assert.equal(parseFlag(["--help"], "--help", "-h"), true);
    assert.equal(parseFlag(["--other"], "--help", "-h"), false);
  });
});

describe("parseString", async () => {
  const { parseString } = await import("../scripts/lib/cli");

  test("returns value following flag", () => {
    assert.equal(parseString(["--out", "report.json"], "--out"), "report.json");
  });

  test("returns null when flag is absent", () => {
    assert.equal(parseString(["--other", "val"], "--out"), null);
  });

  test("returns null when flag is last argument", () => {
    assert.equal(parseString(["--out"], "--out"), null);
  });

  test("returns empty string if next arg is empty string", () => {
    assert.equal(parseString(["--out", ""], "--out"), "");
  });
});

describe("parsePositiveInt", async () => {
  const { parsePositiveInt } = await import("../scripts/lib/cli");

  test("returns parsed value", () => {
    assert.equal(parsePositiveInt(["--limit", "10"], "--limit", 5), 10);
  });

  test("returns fallback when flag is absent", () => {
    assert.equal(parsePositiveInt(["--other"], "--limit", 5), 5);
  });

  test("returns minimum 1 when value is 0", () => {
    assert.equal(parsePositiveInt(["--limit", "0"], "--limit", 5), 5);
  });

  test("returns minimum 1 for non-numeric value", () => {
    assert.equal(parsePositiveInt(["--limit", "abc"], "--limit", 5), 5);
  });

  test("returns fallback when flag is last arg", () => {
    assert.equal(parsePositiveInt(["--limit"], "--limit", 5), 5);
  });
});

describe("addUniqueFromCsv", async () => {
  const { addUniqueFromCsv } = await import("../scripts/lib/cli");

  test("appends items from CSV", () => {
    const list: string[] = [];
    addUniqueFromCsv(list, "es,fr");
    assert.deepEqual(list, ["es", "fr"]);
  });

  test("deduplicates items", () => {
    const list: string[] = [];
    addUniqueFromCsv(list, "es,fr,es");
    assert.deepEqual(list, ["es", "fr"]);
  });

  test("does not duplicate items already in list", () => {
    const list = ["es"];
    addUniqueFromCsv(list, "es,fr");
    assert.deepEqual(list, ["es", "fr"]);
  });

  test("trims whitespace", () => {
    const list: string[] = [];
    addUniqueFromCsv(list, " es , fr ");
    assert.deepEqual(list, ["es", "fr"]);
  });

  test("ignores empty items", () => {
    const list: string[] = [];
    addUniqueFromCsv(list, ",es,,fr,");
    assert.deepEqual(list, ["es", "fr"]);
  });

  test("handles empty string", () => {
    const list: string[] = [];
    addUniqueFromCsv(list, "");
    assert.deepEqual(list, []);
  });
});

describe("warnUnknown", async () => {
  const { warnUnknown } = await import("../scripts/lib/cli");

  test("prints Unknown flag message to console.warn", () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
    try {
      warnUnknown("--bogus");
      assert.equal(warnings.length, 1);
      assert.ok(warnings[0]?.includes("--bogus"), `expected --bogus in: ${warnings[0]}`);
    } finally {
      console.warn = original;
    }
  });
});

describe("isMain", async () => {
  const { isMain } = await import("../scripts/lib/cli");

  test("returns false for a URL that does not match argv[1]", () => {
    assert.equal(isMain("file:///some/other/script.ts"), false);
  });

  test("returns true when URL matches argv[1]", () => {
    // When Node.js runs a test file, process.argv[1] is the test file path,
    // so isMain(import.meta.url) is true in this context.
    assert.equal(isMain(import.meta.url), true);
  });
});

// ── Script parseArgs ───────────────────────────────────────────────────────

describe("process.ts parseArgs", async () => {
  const { parseArgs } = await import("../scripts/process");

  test("defaults", () => {
    const args = parseArgs([]);
    assert.deepEqual(args, {
      ids: [],
      all: false,
      includePublished: false,
      limit: null,
      tts: false,
      translateLangs: [],
      enqueue: false,
      help: false,
    });
  });

  test("--all flag", () => {
    assert.equal(parseArgs(["--all"]).all, true);
  });

  test("--include-published flag", () => {
    assert.equal(parseArgs(["--include-published"]).includePublished, true);
  });

  test("--limit value", () => {
    assert.equal(parseArgs(["--limit", "3"]).limit, 3);
  });

  test("--tts flag", () => {
    assert.equal(parseArgs(["--tts"]).tts, true);
  });

  test("--enqueue flag", () => {
    assert.equal(parseArgs(["--enqueue"]).enqueue, true);
  });

  test("--translate accumulates comma-separated languages", () => {
    assert.deepEqual(parseArgs(["--translate", "es,fr"]).translateLangs, ["es", "fr"]);
  });

  test("--help / -h sets help flag", () => {
    assert.equal(parseArgs(["--help"]).help, true);
    assert.equal(parseArgs(["-h"]).help, true);
  });

  test("positional args become ids", () => {
    assert.deepEqual(parseArgs(["article-1", "article-2"]).ids, ["article-1", "article-2"]);
  });
});

describe("scrape.ts parseArgs", async () => {
  const { parseArgs } = await import("../scripts/scrape");

  test("defaults", () => {
    const args = parseArgs([]);
    assert.deepEqual(args, {
      urls: [],
      provider: null,
      all: false,
      limit: 5,
      file: null,
      fileUrl: null,
      dryRun: false,
      listProviders: false,
      help: false,
    });
  });

  test("--provider value", () => {
    assert.equal(parseArgs(["--provider", "bbc"]).provider, "bbc");
  });

  test("--all flag", () => {
    assert.equal(parseArgs(["--all"]).all, true);
  });

  test("--limit value", () => {
    assert.equal(parseArgs(["--limit", "10"]).limit, 10);
  });

  test("--dry-run flag", () => {
    assert.equal(parseArgs(["--dry-run"]).dryRun, true);
  });

  test("--list-providers flag", () => {
    assert.equal(parseArgs(["--list-providers"]).listProviders, true);
  });

  test("--help sets help flag", () => {
    assert.equal(parseArgs(["--help"]).help, true);
    assert.equal(parseArgs(["-h"]).help, true);
  });

  test("positional args become urls", () => {
    assert.deepEqual(parseArgs(["https://example.com"]).urls, ["https://example.com"]);
  });
});

describe("worker.ts parseArgs", async () => {
  const { parseArgs } = await import("../scripts/worker");

  test("defaults", () => {
    const args = parseArgs([]);
    assert.deepEqual(args, {
      intervalMs: 5000,
      once: false,
      tts: false,
      translateLangs: [],
      lockTtlMs: 600000,
      help: false,
    });
  });

  test("--interval value", () => {
    assert.equal(parseArgs(["--interval", "1000"]).intervalMs, 1000);
  });

  test("--once flag", () => {
    assert.equal(parseArgs(["--once"]).once, true);
  });

  test("--tts flag", () => {
    assert.equal(parseArgs(["--tts"]).tts, true);
  });

  test("--translate value", () => {
    assert.deepEqual(parseArgs(["--translate", "es,fr"]).translateLangs, ["es", "fr"]);
  });

  test("--lock-ttl value", () => {
    assert.equal(parseArgs(["--lock-ttl", "300000"]).lockTtlMs, 300000);
  });

  test("--jobs is a no-op (backward compat)", () => {
    const args = parseArgs(["--jobs"]);
    assert.equal(args.once, false);
  });

  test("--help sets help flag", () => {
    assert.equal(parseArgs(["--help"]).help, true);
    assert.equal(parseArgs(["-h"]).help, true);
  });
});

describe("push-reminders.ts parseArgs", async () => {
  const { parseArgs } = await import("../scripts/push-reminders");

  test("defaults", () => {
    assert.deepEqual(parseArgs([]), { dryRun: false, help: false });
  });

  test("--dry-run flag", () => {
    assert.equal(parseArgs(["--dry-run"]).dryRun, true);
  });

  test("--help / -h sets help flag", () => {
    assert.equal(parseArgs(["--help"]).help, true);
    assert.equal(parseArgs(["-h"]).help, true);
  });
});

describe("migrate-storage.ts parseArgs", async () => {
  const { parseArgs } = await import("../scripts/migrate-storage");

  test("defaults to undefined limit", () => {
    assert.deepEqual(parseArgs([]), { limit: undefined });
  });

  test("--limit value", () => {
    assert.equal(parseArgs(["--limit", "50"]).limit, 50);
  });

  test("--limit with non-numeric is NaN", () => {
    assert.ok(Number.isNaN(parseArgs(["--limit", "abc"]).limit));
  });
});
