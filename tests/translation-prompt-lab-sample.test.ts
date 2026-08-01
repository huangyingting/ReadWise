process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openReadWrite } from "../scripts/translation-prompt-lab/db";
import {
  buildCorpus,
  buildLongestCorpus,
  main,
  paragraphCount,
  parseArgs,
  providerDbFiles,
  readerParagraphText,
  sampleFromDb,
  summarize,
  truncateAtParagraph,
} from "../scripts/translation-prompt-lab/sample";

async function withArgv<T>(args: string[], run: () => Promise<T>): Promise<T> {
  const original = process.argv;
  process.argv = [process.execPath, "sample.ts", ...args];
  try {
    return await run();
  } finally {
    process.argv = original;
  }
}

test("sample text helpers preserve paragraphs and bounded sentence fallbacks", () => {
  assert.equal(truncateAtParagraph(" short ", 20), "short");
  assert.equal(truncateAtParagraph(`${"a".repeat(60)}\n\n${"b".repeat(80)}`, 100), "a".repeat(60));
  assert.equal(truncateAtParagraph(`${"a".repeat(50)}. ${"b".repeat(80)}`, 100), `${"a".repeat(50)}.`);
  assert.equal(truncateAtParagraph("x".repeat(150), 100), "x".repeat(100));
  assert.equal(paragraphCount(" first \n\n\n second \n\n"), 2);
  assert.equal(readerParagraphText("<p>First.</p><p>Second.</p>"), "First.\n\nSecond.");
});

test("sampleFromDb reads eligible public fixtures and always closes the source", () => {
  const dir = mkdtempSync(join(tmpdir(), "readwise-sample-db-"));
  const path = join(dir, "fixture.db");
  const db = openReadWrite(path);
  db.exec("CREATE TABLE Article (id TEXT, title TEXT, content TEXT, category TEXT)");
  const longText = "A complete source sentence with useful article prose. ".repeat(12);
  db.prepare("INSERT INTO Article (id, title, content, category) VALUES (?, ?, ?, ?)").run(
    "one",
    "Title",
    `<p>${longText}</p><p>${longText}</p>`,
    "science",
  );
  db.prepare("INSERT INTO Article (id, title, content, category) VALUES (?, ?, ?, ?)").run(
    "short",
    "Short",
    `<p>${"x".repeat(410)}</p>`,
    "world",
  );
  db.close();

  const sampled = sampleFromDb(path, 2, 300);
  assert.equal(sampled.length, 2);
  assert.ok(sampled.every((article) => article.providerDb === "fixture"));
  assert.equal(sampled.find((article) => article.category === "science")?.profile, "technical");
  assert.ok(sampled.every((article) => article.text.length <= 300));
});

test("provider database discovery handles missing directories and real filtered corpora", () => {
  const missing = join(tmpdir(), `readwise-missing-provider-dbs-${Date.now()}`);
  assert.deepEqual(providerDbFiles(missing), []);
  assert.ok(providerDbFiles().some((path) => path.endsWith("workinprogress.db")));

  const corpus = buildCorpus(1, 300, "workinprogress");
  assert.equal(corpus.mode, "per-category");
  assert.equal(corpus.perCategory, 1);
  assert.ok(corpus.articles.every((article) => article.providerDb === "workinprogress"));

  const longest = buildLongestCorpus(1, "workinprogress");
  assert.equal(longest.mode, "longest");
  assert.equal(longest.articles.length, 1);
  assert.equal(longest.articles[0]?.providerDb, "workinprogress");

  assert.deepEqual(buildCorpus(1, 100, "does-not-exist").articles, []);
  assert.deepEqual(buildLongestCorpus(1, "does-not-exist").articles, []);
});

test("sample summary emits aggregate-only counts for populated and empty corpora", (t) => {
  const logs: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => logs.push(args.map(String).join(" ")));
  summarize({
    generatedAt: "now",
    mode: "per-category",
    perCategory: 1,
    maxChars: 100,
    articles: [
      {
        sampleId: "provider:one",
        providerDb: "provider",
        category: "world",
        profile: "news",
        text: "source",
        paragraphCount: 1,
        charCount: 6,
      },
    ],
  });
  summarize({ generatedAt: "now", mode: "per-category", perCategory: 0, maxChars: 0, articles: [] });
  assert.match(logs.join("\n"), /Char counts — min 6, max 6, mean 6/);
  assert.match(logs.join("\n"), /Sampled 0 article excerpts/);
});

test("sample CLI parses flags and writes both sampling modes without content logging", async (t) => {
  const logs: string[] = [];
  const warnings: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => logs.push(args.map(String).join(" ")));
  t.mock.method(console, "warn", (message: string) => warnings.push(message));
  const dir = mkdtempSync(join(tmpdir(), "readwise-sample-main-"));
  const out = join(dir, "nested", "corpus.json");

  const parsed = parseArgs([
    "--per-category", "3",
    "--max-chars", "500",
    "--longest", "2",
    "--out", out,
    "--db", "does-not-exist",
    "--unknown",
  ]);
  assert.equal(parsed.perCategory, 3);
  assert.equal(parsed.maxChars, 500);
  assert.equal(parsed.longest, 2);
  assert.equal(warnings.length, 1);

  assert.equal(await withArgv(["--help"], () => main()), 0);
  assert.equal(await withArgv(["--db", "does-not-exist", "--out", out], () => main()), 0);
  assert.equal(existsSync(out), true);
  assert.equal((JSON.parse(readFileSync(out, "utf8")) as { mode: string }).mode, "per-category");
  assert.equal(await withArgv(["--longest", "1", "--db", "does-not-exist", "--out", out], () => main()), 0);
  assert.equal((JSON.parse(readFileSync(out, "utf8")) as { mode: string }).mode, "longest");
  assert.match(logs.join("\n"), /Wrote corpus/);
});
