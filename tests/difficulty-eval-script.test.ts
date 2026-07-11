process.env.LOG_LEVEL = "error";

import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DIFFICULTY_ALGORITHM_VERSION } from "@/lib/difficulty";
import {
  __difficultyEvalTest,
  assertNcDatasetAllowed,
  buildReport,
  calibrationRecordFromRow,
  classifyDatasetSource,
  compareProviderSnapshots,
  datasetSourceReport,
  parseArgs,
  parseDelimitedRows,
  providerDbFiles,
  providerLabelFromRow,
  readVocabularyRecords,
  scoreCalibration,
  summarizeScoredRecords,
  summarizeVocabularyRecords,
  vocabularyRecordFromRow,
} from "../scripts/difficulty-eval";

type SqliteStatement = {
  run: (...params: unknown[]) => unknown;
};

type SqliteDatabase = {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => SqliteStatement;
  close: () => void;
};

type SqliteConstructor = new (path: string) => SqliteDatabase;

type ProviderArticleRow = {
  id: string;
  content: string;
  difficulty: string | null;
  difficultyScore: number | null;
  lexileApprox: number | null;
  difficultyVersion: string | null;
};

const require = createRequire(import.meta.url);
const BetterSqlite = require("better-sqlite3") as SqliteConstructor;

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIFFICULTY_EVAL_SCRIPT = fileURLToPath(new URL("../scripts/difficulty-eval.ts", import.meta.url));
const OUTSIDE_FIXTURE_ROOT = resolve(REPO_ROOT, "..", ".difficulty-eval-fixtures");
const REPO_FIXTURE_ROOT = resolve(REPO_ROOT, ".scratch", "difficulty-eval-fixtures");
const PROVIDER_DB_DIR = resolve(REPO_ROOT, "prisma", "provider-dbs");

let fixtureCounter = 0;
const cleanupPaths = new Set<string>();

function nextFixtureId(label: string): string {
  fixtureCounter += 1;
  return `${label}-${process.pid}-${fixtureCounter}`;
}

function trackCleanup(pathValue: string): string {
  cleanupPaths.add(pathValue);
  return pathValue;
}

function createFixtureDir(baseDir: string, label: string): string {
  mkdirSync(baseDir, { recursive: true });
  const dir = join(baseDir, nextFixtureId(label));
  mkdirSync(dir, { recursive: true });
  return trackCleanup(dir);
}

function writeFixture(pathValue: string, content: string): string {
  mkdirSync(dirname(pathValue), { recursive: true });
  writeFileSync(pathValue, content, "utf8");
  return pathValue;
}

function createProviderDb(rows: ProviderArticleRow[]): { dbName: string; dbPath: string } {
  mkdirSync(PROVIDER_DB_DIR, { recursive: true });
  const dbName = `${nextFixtureId("difficulty-provider")}.db`;
  const dbPath = join(PROVIDER_DB_DIR, dbName);
  const db = new BetterSqlite(dbPath);
  db.exec(
    "CREATE TABLE Article (id TEXT PRIMARY KEY, content TEXT, difficulty TEXT, difficultyScore REAL, lexileApprox REAL, difficultyVersion TEXT)",
  );
  const insert = db.prepare(
    "INSERT INTO Article (id, content, difficulty, difficultyScore, lexileApprox, difficultyVersion) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const row of rows) {
    insert.run(
      row.id,
      row.content,
      row.difficulty,
      row.difficultyScore,
      row.lexileApprox,
      row.difficultyVersion,
    );
  }
  db.close();
  trackCleanup(dbPath);
  return { dbName, dbPath };
}

function createVocabularyDb(pathValue: string, rows: Array<{ word: string; level: string }>): void {
  const db = new BetterSqlite(pathValue);
  db.exec("CREATE TABLE Lexicon (word TEXT, level TEXT)");
  const insert = db.prepare("INSERT INTO Lexicon (word, level) VALUES (?, ?)");
  for (const row of rows) insert.run(row.word, row.level);
  db.close();
}

function createNoVocabularyDb(pathValue: string): void {
  const db = new BetterSqlite(pathValue);
  db.exec("CREATE TABLE Metadata (id INTEGER PRIMARY KEY, value TEXT)");
  db.close();
}

function stringifyConsoleValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function runDifficultyEvalMain(args: string[]): Promise<{ code: number; logs: string[]; warns: string[]; errors: string[] }> {
  const logs: string[] = [];
  const warns: string[] = [];
  const errors: string[] = [];

  const originalArgv = process.argv;
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  process.argv = [process.execPath, DIFFICULTY_EVAL_SCRIPT, ...args];
  console.log = ((...parts: unknown[]) => {
    logs.push(parts.map(stringifyConsoleValue).join(" "));
  }) as typeof console.log;
  console.warn = ((...parts: unknown[]) => {
    warns.push(parts.map(stringifyConsoleValue).join(" "));
  }) as typeof console.warn;
  console.error = ((...parts: unknown[]) => {
    errors.push(parts.map(stringifyConsoleValue).join(" "));
  }) as typeof console.error;

  try {
    const code = await __difficultyEvalTest.main();
    return { code, logs, warns, errors };
  } finally {
    process.argv = originalArgv;
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

afterEach(() => {
  for (const pathValue of [...cleanupPaths].sort((a, b) => b.length - a.length)) {
    rmSync(pathValue, { recursive: true, force: true });
  }
  cleanupPaths.clear();
});

test("difficulty eval CLI parses aggregate harness flags", () => {
  const args = parseArgs([
    "--calibration",
    "../local/calibration.jsonl",
    "--onestop",
    "../local/ose.tsv",
    "--provider-dbs",
    "--provider-db",
    "workinprogress.db",
    "--provider-limit",
    "25",
    "--provider-labels",
    "docs/learning/provider-labels.csv",
    "--words-cefr",
    "../local/words.sqlite",
    "--snapshot-out",
    "test-results/provider-snapshot.json",
    "--compare-snapshot",
    "docs/learning/provider-snapshot.json",
    "--drift-threshold",
    "0.2",
    "--enable-nc",
    "--json",
  ]);

  assert.equal(args.calibration, "../local/calibration.jsonl");
  assert.equal(args.onestop, "../local/ose.tsv");
  assert.equal(args.providerDbs, true);
  assert.deepEqual(args.providerDbNames, ["workinprogress.db"]);
  assert.equal(args.providerLimit, 25);
  assert.equal(args.providerLabels, "docs/learning/provider-labels.csv");
  assert.equal(args.wordsCefr, "../local/words.sqlite");
  assert.equal(args.snapshotOut, "test-results/provider-snapshot.json");
  assert.equal(args.compareSnapshot, "docs/learning/provider-snapshot.json");
  assert.equal(args.driftThreshold, 0.2);
  assert.equal(args.enableNc, true);
  assert.equal(args.json, true);
});

test("difficulty eval parseArgs handles help/out and warns on unknown flags", () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...parts: unknown[]) => {
    warnings.push(parts.join(" "));
  };

  try {
    const args = parseArgs(["--out", "report.json", "--help", "--drift-threshold", "-5", "--bogus"]);

    assert.equal(args.out, "report.json");
    assert.equal(args.help, true);
    assert.equal(args.driftThreshold, 0);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /Unknown flag: --bogus/);
});

test("difficulty eval allows OneStopEnglish CC BY-SA without the NC gate", () => {
  const source = classifyDatasetSource("oneStopOrdinal", "../calibration/onestop-ordinal.tsv");

  assert.equal(source.dataset, "OneStopEnglish");
  assert.equal(source.license, "CC BY-SA 4.0");
  assert.equal(source.nonCommercial, false);
  assert.doesNotThrow(() => assertNcDatasetAllowed(source, false));
});

test("difficulty eval keeps vocabulary penalty audits default-allowed by license metadata", () => {
  const source = classifyDatasetSource("vocabularyPenaltyAudit", "../local/words-cefr.csv");

  assert.equal(source.dataset, "User-supplied Words-CEFR vocabulary");
  assert.equal(source.nonCommercial, false);
  assert.equal(datasetSourceReport(source).gate, "not-required");
});

test("difficulty eval rejects non-commercial calibration paths unless explicitly enabled", () => {
  const source = classifyDatasetSource("calibration", "../calibration/UniversalCEFR-CC-BY-NC-SA.jsonl");

  assert.equal(source.nonCommercial, true);
  assert.match(source.license, /non-commercial|CC BY-NC/i);
  assert.deepEqual(
    {
      gate: datasetSourceReport(source).gate,
      nonCommercial: datasetSourceReport(source).nonCommercial,
    },
    { gate: "--enable-nc", nonCommercial: true },
  );
  assert.throws(() => assertNcDatasetAllowed(source, false), /--enable-nc/);
  assert.doesNotThrow(() => assertNcDatasetAllowed(source, true));
});

test("difficulty eval detects non-commercial dataset metadata without raw text examples", () => {
  const source = classifyDatasetSource("calibration", "../calibration/local-labels.csv", [
    { dataset: "CEFR-SP", license: "CC BY-NC 4.0", label: "B1" },
  ]);

  assert.equal(source.dataset, "CEFR-SP");
  assert.equal(source.nonCommercial, true);
  assert.throws(() => assertNcDatasetAllowed(source, false), /non-commercial/);
  assert.doesNotThrow(() => assertNcDatasetAllowed(source, true));
});

test("difficulty eval treats CEFR plus labels as their base band", () => {
  const record = calibrationRecordFromRow({
    text: "Aggregate-only test passage with enough words to represent a row.",
    cefr_level: "B1+",
  });

  assert.equal(record?.label, "B1");
});

test("difficulty eval identifies elg_cefr_en as an NC UniversalCEFR source", () => {
  const source = classifyDatasetSource("calibration", "../calibration/elg-cefr-en.json", [
    { source_name: "elg-cefr-en", license: "CC BY-NC-SA 4.0" },
  ]);

  assert.equal(source.dataset, "UniversalCEFR/elg_cefr_en");
  assert.equal(source.nonCommercial, true);
  assert.throws(() => assertNcDatasetAllowed(source, false), /--enable-nc/);
});

test("difficulty eval parses CSV/TSV rows without leaking text into aggregate summaries", () => {
  const rows = parseDelimitedRows(
    'text,label\n"Short, quoted passage for scoring. It repeats enough words to be scored.",A2',
    ",",
  );
  const record = calibrationRecordFromRow(rows[0]!);

  assert.equal(record?.label, "A2");
  assert.ok(record?.text.includes("quoted passage"));

  const summary = summarizeScoredRecords(scoreCalibration([
    {
      text: "<p>The child reads a book at home. The child reads a book at home. The child reads a book at home. The child reads a book at home.</p>",
      label: "A2",
    },
  ]));
  const serialized = JSON.stringify(summary);
  assert.match(serialized, /predictedCefr/);
  assert.doesNotMatch(serialized, /child reads a book/);
});

test("difficulty eval supports multiline quoted calibration CSV fields", () => {
  const rows = parseDelimitedRows('text,label\n"First line.\nSecond line.",B1', ",");

  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.text, "First line.\nSecond line.");
  assert.equal(calibrationRecordFromRow(rows[0]!)?.label, "B1");
});

test("difficulty eval parses escaped quotes in CSV records", () => {
  const rows = parseDelimitedRows('text,label\n"He said ""hello"" twice",B1', ",");

  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.text, 'He said "hello" twice');
});

test("difficulty eval reports OneStop-style ordinal metrics and Lexile-like monotonicity", () => {
  const summary = summarizeScoredRecords(scoreCalibration([
    {
      text: "<p>The cat sat on the mat. The dog ran in the sun. The child had a red ball. The family ate at home.</p>",
      ordinalLabel: "elementary",
    },
    {
      text: "<p>Visitors compare several exhibits while following the museum guide and answering questions about local history. Visitors compare several exhibits while following the museum guide and answering questions about local history.</p>",
      ordinalLabel: "intermediate",
    },
    {
      text: "<p>Consequently the epistemological framework necessitates institutional reconsideration despite methodological uncertainty and regulatory fragmentation. Consequently the epistemological framework necessitates institutional reconsideration despite methodological uncertainty and regulatory fragmentation.</p>",
      ordinalLabel: "advanced",
    },
  ]));

  assert.equal(summary.count, 3);
  assert.ok(summary.ordinal);
  assert.ok(summary.lexileLike);
  assert.ok(summary.lexileLikeByLabel);
  assert.ok(summary.lexileLikeCorrelationByLabel);
});

test("vocabulary penalty audit aggregates MIT-style records without word examples", () => {
  const records = [
    vocabularyRecordFromRow({ word: "the", cefr: "A1" }),
    vocabularyRecordFromRow({ word: "institutional", cefr: "C1" }),
  ].filter((record) => record !== null);
  const summary = summarizeVocabularyRecords(records);
  const serialized = JSON.stringify(summary);

  assert.equal(summary.count, 2);
  assert.equal(summary.byCefr.A1, 1);
  assert.equal(summary.byCefr.C1, 1);
  assert.ok(summary.penaltyByCefr.A1);
  assert.doesNotMatch(serialized, /institutional|the/);
});

test("difficulty eval parses provider labels and normalizes provider DB basenames", () => {
  const record = providerLabelFromRow({
    providerDbPath: "prisma/provider-dbs/workinprogress.db",
    article_id: "article-1",
    level: "B2",
    ordinal: "intermediate",
  });

  assert.deepEqual(record, {
    providerDb: "workinprogress.db",
    articleId: "article-1",
    label: "B2",
    ordinalLabel: "intermediate",
  });
  assert.equal(providerLabelFromRow({ articleId: "missing-provider" }), null);
});

test("difficulty eval reads vocabulary records from JSON, JSONL, TSV, and SQLite sources", () => {
  const outsideDir = createFixtureDir(OUTSIDE_FIXTURE_ROOT, "vocabulary");

  const jsonPath = writeFixture(
    join(outsideDir, "words.json"),
    JSON.stringify([
      { word: "the", cefr: "A1" },
      42,
      { word: "institutional", cefr_level: "C1" },
    ]),
  );
  assert.equal(readVocabularyRecords(jsonPath).length, 2);

  const jsonObjectPath = writeFixture(
    join(outsideDir, "single-word.json"),
    JSON.stringify({ word: "analysis", cefr: "B2" }),
  );
  assert.equal(readVocabularyRecords(jsonObjectPath).length, 1);

  const jsonPrimitivePath = writeFixture(join(outsideDir, "primitive.json"), "42");
  assert.deepEqual(readVocabularyRecords(jsonPrimitivePath), []);

  const jsonlPath = writeFixture(
    join(outsideDir, "words.jsonl"),
    [
      JSON.stringify({ word: "focus", cefr: "B1" }),
      "42",
      JSON.stringify({ word: "bridge", level: "A2" }),
    ].join("\n"),
  );
  assert.equal(readVocabularyRecords(jsonlPath).length, 2);

  const tsvPath = writeFixture(join(outsideDir, "words.tsv"), "word\tcefr\nretain\tB2\n");
  assert.equal(readVocabularyRecords(tsvPath).length, 1);

  const sqlitePath = join(outsideDir, "words.sqlite");
  createVocabularyDb(sqlitePath, [
    { word: "the", level: "A1" },
    { word: "innovation", level: "B2" },
  ]);
  assert.equal(readVocabularyRecords(sqlitePath).length, 2);

  const noVocabularySqlitePath = join(outsideDir, "words-empty.sqlite");
  createNoVocabularyDb(noVocabularySqlitePath);
  assert.deepEqual(readVocabularyRecords(noVocabularySqlitePath), []);
});

test("difficulty eval provider DB discovery respects allowlists", () => {
  const provider = createProviderDb([
    {
      id: "provider-discovery-1",
      content: "A short article body with enough words for deterministic scoring.",
      difficulty: "B1",
      difficultyScore: 30,
      lexileApprox: 800,
      difficultyVersion: DIFFICULTY_ALGORITHM_VERSION,
    },
  ]);

  const discovered = providerDbFiles([provider.dbName]);
  assert.ok(discovered.some((pathValue) => pathValue.endsWith(provider.dbName)));
  assert.deepEqual(providerDbFiles(["missing-provider.db"]), []);
});

test("difficulty eval buildReport evaluates calibration/onestop/vocabulary/provider aggregates", () => {
  const outsideDir = createFixtureDir(OUTSIDE_FIXTURE_ROOT, "report");
  const repoDir = createFixtureDir(REPO_FIXTURE_ROOT, "report");
  const provider = createProviderDb([
    {
      id: "article-1",
      content: "This article explains practical management changes and measurable performance outcomes for distributed teams.",
      difficulty: "B2",
      difficultyScore: 35,
      lexileApprox: 880,
      difficultyVersion: DIFFICULTY_ALGORITHM_VERSION,
    },
    {
      id: "article-2",
      content: "Consequently, institutional frameworks and methodological uncertainty challenge governance in emerging economies.",
      difficulty: null,
      difficultyScore: 61,
      lexileApprox: null,
      difficultyVersion: "legacy-version",
    },
  ]);

  const calibrationPath = writeFixture(
    join(outsideDir, "calibration.csv"),
    [
      "text,cefr_level",
      '"Learners discuss routine topics with familiar vocabulary in short paragraphs.",A2',
      ",B1",
    ].join("\n"),
  );
  const onestopPath = writeFixture(
    join(outsideDir, "onestop.tsv"),
    [
      "text\tose_level",
      "Students evaluate competing claims in a long-form article.\tintermediate",
    ].join("\n"),
  );
  const wordsPath = writeFixture(
    join(outsideDir, "words.csv"),
    [
      "word,cefr",
      "the,A1",
      "governance,C1",
    ].join("\n"),
  );

  const labelsPath = writeFixture(
    join(repoDir, "provider-labels.csv"),
    [
      "providerDb,articleId,cefr,ordinal",
      `${provider.dbName},article-1,B2,intermediate`,
      `${provider.dbName},article-2,C1,advanced`,
    ].join("\n"),
  );

  const compareSnapshotPath = writeFixture(
    join(repoDir, "snapshot-object.json"),
    JSON.stringify({
      providerDbs: [
        {
          providerDb: `prisma/provider-dbs/${provider.dbName}`,
          articleCount: 2,
          computed: {
            count: 2,
            score: null,
            lexileLike: null,
            predictedCefr: { A1: 2 },
            predictedOrdinal: {},
            lexileLikeByPredictedCefr: {},
            lexileLikeByPredictedOrdinal: {},
          },
          stored: {
            difficulty: {},
            difficultyVersion: {},
            missingDifficulty: 0,
            missingLexileLike: 0,
            staleVersion: 0,
          },
        },
      ],
    }, null, 2),
  );

  const report = buildReport(parseArgs([
    "--calibration",
    calibrationPath,
    "--onestop",
    onestopPath,
    "--words-cefr",
    wordsPath,
    "--provider-dbs",
    "--provider-db",
    provider.dbName,
    "--provider-labels",
    labelsPath,
    "--compare-snapshot",
    compareSnapshotPath,
    "--drift-threshold",
    "0",
  ]));

  assert.equal(report.datasetSources.length, 3);
  assert.ok(report.calibration);
  assert.ok(report.oneStopOrdinal);
  assert.ok(report.vocabularyPenaltyAudit);
  assert.equal(report.providerDbs?.length, 1);
  assert.equal(report.providerDbs?.[0]?.providerDb, `prisma/provider-dbs/${provider.dbName}`);
  assert.equal(report.providerDbs?.[0]?.stored.staleVersion, 1);
  assert.ok((report.snapshotComparison?.compared ?? 0) >= 1);
});

test("difficulty eval buildReport supports words-cefr SQLite inputs", () => {
  const outsideDir = createFixtureDir(OUTSIDE_FIXTURE_ROOT, "words-db");
  const sqlitePath = join(outsideDir, "words.db");
  createVocabularyDb(sqlitePath, [
    { word: "the", level: "A1" },
    { word: "analysis", level: "B2" },
  ]);

  const report = buildReport(parseArgs(["--words-cefr", sqlitePath]));

  assert.equal(report.datasetSources.length, 1);
  assert.equal(report.datasetSources[0]?.kind, "vocabularyPenaltyAudit");
  assert.equal(report.vocabularyPenaltyAudit?.count, 2);
});

test("difficulty eval validates required files and outside-repo calibration guards", () => {
  assert.throws(
    () => buildReport(parseArgs(["--provider-dbs", "--provider-labels", "does-not-exist.csv"])),
    /must point to an existing file/,
  );

  assert.throws(
    () => buildReport(parseArgs(["--calibration", join(REPO_ROOT, "package.json")])),
    /must be outside the repository/,
  );
});

test("difficulty eval rejects invalid snapshot payloads", () => {
  const repoDir = createFixtureDir(REPO_FIXTURE_ROOT, "snapshot-invalid");
  const provider = createProviderDb([
    {
      id: "article-1",
      content: "Routine paragraph for deterministic scoring.",
      difficulty: "A2",
      difficultyScore: 20,
      lexileApprox: 650,
      difficultyVersion: DIFFICULTY_ALGORITHM_VERSION,
    },
  ]);
  const badSnapshotPath = writeFixture(join(repoDir, "invalid-snapshot.json"), JSON.stringify({ invalid: true }));

  assert.throws(
    () => buildReport(parseArgs([
      "--provider-dbs",
      "--provider-db",
      provider.dbName,
      "--compare-snapshot",
      badSnapshotPath,
    ])),
    /providerDbs array/,
  );
});

test("difficulty eval main handles help and no-input CLI paths", async () => {
  const helpRun = await runDifficultyEvalMain(["--help"]);
  assert.equal(helpRun.code, 0);
  assert.match(helpRun.logs.join("\n"), /Usage:/);

  const noInputRun = await runDifficultyEvalMain([]);
  assert.equal(noInputRun.code, 2);
  assert.match(noInputRun.logs.join("\n"), /Difficulty calibration\/evaluation harness/);
});

test("difficulty eval main writes aggregate outputs and returns non-zero on snapshot drift", async () => {
  const repoDir = createFixtureDir(REPO_FIXTURE_ROOT, "entrypoint-report");
  const provider = createProviderDb([
    {
      id: "article-1",
      content: "This article discusses project governance changes and distributed operations in detail.",
      difficulty: "B2",
      difficultyScore: 38,
      lexileApprox: 900,
      difficultyVersion: DIFFICULTY_ALGORITHM_VERSION,
    },
    {
      id: "article-2",
      content: "Consequently, organizational uncertainty and institutional complexity increase lexical difficulty.",
      difficulty: "C1",
      difficultyScore: 58,
      lexileApprox: 1060,
      difficultyVersion: DIFFICULTY_ALGORITHM_VERSION,
    },
  ]);

  const compareSnapshotPath = writeFixture(
    join(repoDir, "snapshot-array.json"),
    JSON.stringify([
      {
        providerDb: `prisma/provider-dbs/${provider.dbName}`,
        articleCount: 2,
        computed: {
          count: 2,
          score: null,
          lexileLike: null,
          predictedCefr: { A1: 2 },
          predictedOrdinal: {},
          lexileLikeByPredictedCefr: {},
          lexileLikeByPredictedOrdinal: {},
        },
        stored: {
          difficulty: {},
          difficultyVersion: {},
          missingDifficulty: 0,
          missingLexileLike: 0,
          staleVersion: 0,
        },
      },
    ], null, 2),
  );

  const reportPath = join(repoDir, "report.json");
  const snapshotOutPath = join(repoDir, "provider-snapshot.json");

  const run = await runDifficultyEvalMain([
    "--provider-dbs",
    "--provider-db",
    provider.dbName,
    "--compare-snapshot",
    compareSnapshotPath,
    "--drift-threshold",
    "0",
    "--snapshot-out",
    snapshotOutPath,
    "--out",
    reportPath,
  ]);

  assert.equal(run.code, 1);
  assert.ok(existsSync(reportPath));
  assert.ok(existsSync(snapshotOutPath));
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
    providerDbs?: unknown[];
    snapshotComparison?: { exceeded?: unknown[] };
  };
  assert.ok(Array.isArray(report.providerDbs));
  assert.ok((report.snapshotComparison?.exceeded?.length ?? 0) > 0);
  assert.match(run.logs.join("\n"), /Provider DBs: 1/);
  assert.match(run.errors.join("\n"), /Wrote aggregate report/);
});

test("difficulty eval main prints dataset, metric, and vocabulary summaries", async () => {
  const outsideDir = createFixtureDir(OUTSIDE_FIXTURE_ROOT, "main-summary");
  const repoDir = createFixtureDir(REPO_FIXTURE_ROOT, "main-summary");
  const provider = createProviderDb([
    {
      id: "article-1",
      content: "Learners discuss practical management strategy and compare alternatives with supporting examples.",
      difficulty: "B1",
      difficultyScore: 33,
      lexileApprox: 860,
      difficultyVersion: DIFFICULTY_ALGORITHM_VERSION,
    },
  ]);

  const calibrationPath = writeFixture(
    join(outsideDir, "calibration.csv"),
    [
      "text,cefr_level",
      '"The student reads a short article about family life and daily routines.",A2',
      '"The analyst evaluates complex trade-offs between policy interventions and economic risk.",B2',
    ].join("\n"),
  );
  const onestopPath = writeFixture(
    join(outsideDir, "onestop.tsv"),
    [
      "text\tose_level",
      "Learners compare news summaries from multiple viewpoints.\telementary",
      "Researchers synthesize evidence from interdisciplinary studies.\tadvanced",
    ].join("\n"),
  );
  const wordsPath = writeFixture(
    join(outsideDir, "words.csv"),
    [
      "word,cefr",
      "the,A1",
      "institutional,C1",
    ].join("\n"),
  );
  const labelsPath = writeFixture(
    join(repoDir, "provider-labels.csv"),
    [
      "providerDb,articleId,cefr",
      `${provider.dbName},article-1,B1`,
    ].join("\n"),
  );

  const run = await runDifficultyEvalMain([
    "--calibration",
    calibrationPath,
    "--onestop",
    onestopPath,
    "--words-cefr",
    wordsPath,
    "--provider-dbs",
    "--provider-db",
    provider.dbName,
    "--provider-labels",
    labelsPath,
  ]);

  assert.equal(run.code, 0);
  const output = run.logs.join("\n");
  assert.match(output, /Dataset sources:/);
  assert.match(output, /Calibration: count=/);
  assert.match(output, /OneStop ordinal: count=/);
  assert.match(output, /lexileLike correlation=/);
  assert.match(output, /Vocabulary penalty audit: count=/);
});

test("difficulty eval main emits JSON when --json is supplied", async () => {
  const provider = createProviderDb([
    {
      id: "article-1",
      content: "An article with enough content for deterministic scoring and lexical analysis.",
      difficulty: "B1",
      difficultyScore: 32,
      lexileApprox: 840,
      difficultyVersion: DIFFICULTY_ALGORITHM_VERSION,
    },
  ]);

  const run = await runDifficultyEvalMain([
    "--provider-dbs",
    "--provider-db",
    provider.dbName,
    "--json",
  ]);

  assert.equal(run.code, 0);
  assert.match(run.logs.join("\n"), /"algorithmVersion"/);
  assert.doesNotMatch(run.logs.join("\n"), /Difficulty evaluation \(/);
});

test("provider snapshot comparison flags only aggregate CEFR distribution drift", () => {
  const previous = [{
    providerDb: "prisma/provider-dbs/provider.db",
    articleCount: 10,
    computed: {
      count: 10,
      score: null,
      lexileLike: null,
      predictedCefr: { A1: 5, B1: 5 },
      predictedOrdinal: {},
      lexileLikeByPredictedCefr: {},
      lexileLikeByPredictedOrdinal: {},
    },
    stored: { difficulty: {}, difficultyVersion: {}, missingDifficulty: 0, missingLexileLike: 0, staleVersion: 0 },
  }];
  const current = [{
    ...previous[0]!,
    computed: {
      ...previous[0]!.computed,
      predictedCefr: { A1: 1, B1: 9 },
    },
  }];

  const comparison = compareProviderSnapshots(previous, current, 0.2);

  assert.equal(comparison.compared, 1);
  assert.equal(comparison.exceeded.length, 2);
  assert.ok(comparison.exceeded.every((entry) => entry.metric.startsWith("computed.predictedCefr.")));
});
