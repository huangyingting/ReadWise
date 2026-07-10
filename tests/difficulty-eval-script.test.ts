process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertNcDatasetAllowed,
  calibrationRecordFromRow,
  classifyDatasetSource,
  compareProviderSnapshots,
  datasetSourceReport,
  parseArgs,
  parseDelimitedRows,
  scoreCalibration,
  summarizeScoredRecords,
  summarizeVocabularyRecords,
  vocabularyRecordFromRow,
} from "../scripts/difficulty-eval";

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

test("difficulty eval allows OneStopEnglish CC BY-SA without the NC gate", () => {
  const source = classifyDatasetSource("oneStopOrdinal", "../calibration/onestop-ordinal.tsv");

  assert.equal(source.dataset, "OneStopEnglish");
  assert.equal(source.license, "CC BY-SA 4.0");
  assert.equal(source.nonCommercial, false);
  assert.doesNotThrow(() => assertNcDatasetAllowed(source, false));
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
