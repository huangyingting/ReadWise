import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { normalizeDatabaseUrl, parseArgs } from "../scripts/scrape-review";

test("scrape-review parseArgs supports DB sampling mode", () => {
  const args = parseArgs([
    "--db",
    "prisma/natgeo-scrape.db",
    "--provider",
    "natgeo",
    "--sample",
    "25",
    "--feedback-file",
    "tmp/feedback.jsonl",
  ]);

  assert.equal(args.noDb, false);
  assert.equal(args.db, "prisma/natgeo-scrape.db");
  assert.equal(args.provider, "natgeo");
  assert.equal(args.limit, 25);
  assert.equal(args.sample, 25);
  assert.equal(args.order, "random");
  assert.equal(args.feedbackFile, "tmp/feedback.jsonl");
});

test("scrape-review parseArgs supports no-DB preview mode", () => {
  const args = parseArgs([
    "--no-db",
    "--urls",
    "urls.txt",
    "--url",
    "https://example.com/a",
    "--limit",
    "10",
    "--feedback-none",
  ]);

  assert.equal(args.noDb, true);
  assert.equal(args.urlsFile, "urls.txt");
  assert.deepEqual(args.urls, ["https://example.com/a"]);
  assert.equal(args.limit, 10);
  assert.equal(args.feedbackFile, null);
});

test("normalizeDatabaseUrl accepts Prisma URLs and normalizes file paths", () => {
  assert.equal(normalizeDatabaseUrl("file:/tmp/review.db"), "file:/tmp/review.db");
  assert.equal(normalizeDatabaseUrl("postgresql://example/db"), "postgresql://example/db");
  assert.equal(
    normalizeDatabaseUrl("prisma/natgeo-scrape.db"),
    `file:${path.resolve(process.cwd(), "prisma/natgeo-scrape.db")}`,
  );
});
