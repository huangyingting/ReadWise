/**
 * Privacy-safe CEFR/Lexile-like calibration and drift harness.
 *
 * Reads user-supplied calibration corpora and provider SQLite DBs locally, but
 * reports aggregate metrics only. Never print article text, titles, excerpts, or
 * vocabulary examples from this script.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { deterministicDifficulty, DIFFICULTY_ALGORITHM_VERSION } from "@/lib/difficulty";
import { ENGLISH_LEVELS, isDifficultyLevel, levelRank, type EnglishLevel } from "@/lib/leveling/cefr-primitives";
import { wordFrequencyBand, type WordFrequencyBand } from "@/lib/frequency-ranks";
import { isMain, runScript, warnUnknown } from "./lib/cli";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PROVIDER_DB_DIR = join(REPO_ROOT, "prisma", "provider-dbs");
const VOCABULARY_BAND_PENALTY: Record<WordFrequencyBand, number> = {
  top1k: 2,
  top2k: 12,
  top3k: 24,
  top5k: 38,
  top10k: 58,
  academic: 72,
  rare: 85,
};
const WORD_FREQUENCY_BANDS: WordFrequencyBand[] = [
  "top1k",
  "top2k",
  "top3k",
  "top5k",
  "top10k",
  "academic",
  "rare",
];
const ORDINAL_LABELS = ["elementary", "intermediate", "advanced"] as const;
const METADATA_COLUMNS = [
  "dataset",
  "dataset_name",
  "datasetname",
  "dataset_id",
  "source",
  "source_name",
  "corpus",
  "license",
  "licence",
  "rights",
  "terms",
];
const NC_DATASET_RULES = [
  {
    dataset: "UniversalCEFR/elg_cefr_en",
    license: "CC BY-NC-SA 4.0/non-commercial terms (verify local copy)",
    patterns: [/\buniversal[-_\s]?cefr\b/i, /\belg[-_\s]?cefr[-_\s]?en\b/i],
  },
  {
    dataset: "Cambridge CEFR dataset",
    license: "Cambridge non-commercial/academic-use terms (verify local copy)",
    patterns: [/\bcambridge\b/i],
  },
  {
    dataset: "CEFR-SP",
    license: "non-commercial/CC BY-NC-style terms (verify local copy)",
    patterns: [/\bcefr[-_\s]?sp\b/i],
  },
  {
    dataset: "CC BY-NC dataset",
    license: "CC BY-NC/CC BY-NC-SA non-commercial terms",
    patterns: [/\bcc[-_\s]?by[-_\s]?nc(?:[-_\s]?sa)?\b/i, /\bby[-_\s]?nc(?:[-_\s]?sa)?\b/i],
  },
  {
    dataset: "Non-commercial dataset",
    license: "non-commercial terms",
    patterns: [/\bnon[-_\s]?commercial\b/i, /\bnoncommercial\b/i],
  },
];

type OrdinalLabel = (typeof ORDINAL_LABELS)[number];
type AnyLabel = EnglishLevel | OrdinalLabel;
type NumericRecord = Record<string, number>;
type ConfusionMatrix = Record<string, Record<string, number>>;
type PlainRow = Record<string, string>;
type SQLiteDatabase = {
  prepare: (sql: string) => {
    all: (...params: unknown[]) => unknown[];
    get: (...params: unknown[]) => unknown;
  };
  close: () => void;
};

type Args = {
  calibration: string | null;
  onestop: string | null;
  wordsCefr: string | null;
  enableNc: boolean;
  providerDbs: boolean;
  providerDbNames: string[];
  providerLimit: number | null;
  providerLabels: string | null;
  json: boolean;
  out: string | null;
  snapshotOut: string | null;
  compareSnapshot: string | null;
  driftThreshold: number;
  help: boolean;
};

type CalibrationRecord = {
  text: string;
  label?: EnglishLevel;
  ordinalLabel?: OrdinalLabel;
};

type ProviderLabelRecord = {
  providerDb: string;
  articleId: string;
  label?: EnglishLevel;
  ordinalLabel?: OrdinalLabel;
};

type VocabularyRecord = {
  word: string;
  label: EnglishLevel;
};

type DatasetKind = "calibration" | "oneStopOrdinal" | "vocabularyPenaltyAudit";

type DatasetSource = {
  kind: DatasetKind;
  dataset: string;
  license: string;
  nonCommercial: boolean;
  requiresEnableNc: boolean;
  detection: string[];
};

type DatasetSourceReport = {
  kind: DatasetKind;
  dataset: string;
  license: string;
  nonCommercial: boolean;
  gate: "not-required" | "--enable-nc";
  detection: string[];
};

type ScoredRecord = {
  predictedLevel: EnglishLevel;
  predictedOrdinal: OrdinalLabel;
  score: number;
  lexileApprox: number;
  label?: EnglishLevel;
  ordinalLabel?: OrdinalLabel;
};

type MetricSummary = {
  count: number;
  score: DistributionSummary | null;
  lexileLike: DistributionSummary | null;
  predictedCefr: NumericRecord;
  predictedOrdinal: NumericRecord;
  cefr?: LabelMetrics;
  ordinal?: LabelMetrics;
  lexileLikeByLabel?: Record<string, DistributionSummary>;
  lexileLikeByPredictedCefr: Record<string, DistributionSummary>;
  lexileLikeByPredictedOrdinal: Record<string, DistributionSummary>;
  lexileLikeCorrelationByLabel?: CorrelationSummary | null;
};

type LabelMetrics = {
  count: number;
  exact: number;
  exactRate: number;
  withinOne: number;
  withinOneRate: number;
  confusion: ConfusionMatrix;
};

type DistributionSummary = {
  min: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  max: number;
  average: number;
};

type CorrelationSummary = {
  pearson: number | null;
  spearman: number | null;
  monotonicAdjacentPairs: number;
  adjacentPairs: number;
  monotonicityRate: number | null;
};

type ProviderDbSummary = {
  providerDb: string;
  articleCount: number;
  computed: MetricSummary;
  stored: {
    difficulty: NumericRecord;
    difficultyVersion: NumericRecord;
    missingDifficulty: number;
    missingLexileLike: number;
    staleVersion: number;
    storedScoreDelta?: DistributionSummary | null;
  };
  labeled?: MetricSummary;
};

type SnapshotComparison = {
  compared: number;
  threshold: number;
  exceeded: Array<{
    providerDb: string;
    metric: string;
    previous: number;
    current: number;
    delta: number;
  }>;
};

type Report = {
  generatedAt: string;
  algorithmVersion: string;
  datasetSources: DatasetSourceReport[];
  notes: string[];
  calibration?: MetricSummary;
  oneStopOrdinal?: MetricSummary;
  providerDbs?: ProviderDbSummary[];
  vocabularyPenaltyAudit?: ReturnType<typeof summarizeVocabularyRecords>;
  snapshotComparison?: SnapshotComparison;
};

function defaultArgs(): Args {
  return {
    calibration: null,
    onestop: null,
    wordsCefr: null,
    enableNc: false,
    providerDbs: false,
    providerDbNames: [],
    providerLimit: null,
    providerLabels: null,
    json: false,
    out: null,
    snapshotOut: null,
    compareSnapshot: null,
    driftThreshold: 0.1,
    help: false,
  };
}

function nextValue(argv: string[], index: number): string | null {
  return argv[index + 1] ?? null;
}

export function parseArgs(argv: string[]): Args {
  const args = defaultArgs();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--calibration":
        args.calibration = nextValue(argv, i);
        i++;
        break;
      case "--onestop":
        args.onestop = nextValue(argv, i);
        i++;
        break;
      case "--words-cefr":
        args.wordsCefr = nextValue(argv, i);
        i++;
        break;
      case "--enable-nc":
        args.enableNc = true;
        break;
      case "--provider-dbs":
        args.providerDbs = true;
        break;
      case "--provider-db":
        args.providerDbs = true;
        args.providerDbNames.push(basename(nextValue(argv, i) ?? ""));
        i++;
        break;
      case "--provider-limit":
        args.providerLimit = Math.trunc(Math.max(1, Number(nextValue(argv, i)) || 0)) || null;
        i++;
        break;
      case "--provider-labels":
        args.providerLabels = nextValue(argv, i);
        i++;
        break;
      case "--json":
        args.json = true;
        break;
      case "--out":
        args.out = nextValue(argv, i);
        i++;
        break;
      case "--snapshot-out":
        args.snapshotOut = nextValue(argv, i);
        i++;
        break;
      case "--compare-snapshot":
        args.compareSnapshot = nextValue(argv, i);
        i++;
        break;
      case "--drift-threshold":
        args.driftThreshold = Math.max(0, Number(nextValue(argv, i)) || args.driftThreshold);
        i++;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        if (arg.startsWith("-")) warnUnknown(arg);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`Difficulty calibration/evaluation harness

Usage:
  npm run difficulty:eval -- --calibration <outside-repo.jsonl|csv|tsv>
  npm run difficulty:eval -- --onestop <outside-repo.jsonl|csv|tsv>
  npm run difficulty:eval -- --provider-dbs
  npm run difficulty:eval -- --provider-dbs --provider-labels <labels.csv>
  npm run difficulty:eval -- --provider-db workinprogress.db --provider-limit 25
  npm run difficulty:eval -- --words-cefr <outside-repo.csv|tsv|jsonl|sqlite>
  npm run difficulty:eval -- --calibration <outside-repo-universalcefr.jsonl> --enable-nc

Options:
  --json                         Print full aggregate JSON report.
  --out <path>                   Write aggregate JSON report.
  --snapshot-out <path>          Write provider aggregate snapshot JSON.
  --compare-snapshot <path>      Compare provider aggregate drift to a snapshot.
  --drift-threshold <fraction>   Distribution delta threshold, default 0.1.
  --enable-nc                    Opt in to NC/CC-BY-NC/CC-BY-NC-SA datasets.
  --provider-db <name>           Limit provider evaluation to one DB basename.
  --provider-limit <count>       Limit rows per provider DB for smoke checks.

Privacy:
  Calibration and vocabulary inputs must live outside this repo. Reports contain
  counts, percentiles, confusion matrices, correlations, and provider DB names
  only; no text, titles, excerpts, article IDs, or word examples are printed.
  OneStopEnglish is treated as CC BY-SA and allowed by default.
  UniversalCEFR/elg_cefr_en, Cambridge, CEFR-SP, CC BY-NC, CC BY-NC-SA, and
  other non-commercial datasets are rejected unless --enable-nc is present;
  aggregate reports mark such sources with nonCommercial=true and license
  metadata.
`);
}

function assertExistingFile(pathValue: string, label: string): string {
  const absolute = resolve(pathValue);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error(`${label} must point to an existing file.`);
  }
  return absolute;
}

function assertOutsideRepo(pathValue: string, label: string): string {
  const absolute = assertExistingFile(pathValue, label);
  const rel = relative(REPO_ROOT, absolute);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    throw new Error(`${label} must be outside the repository to avoid committing source corpus data.`);
  }
  return absolute;
}

function metadataText(rows: PlainRow[] | undefined): string {
  if (!rows) return "";
  const values: string[] = [];
  for (const row of rows) {
    const normalized = new Map(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]));
    for (const column of METADATA_COLUMNS) {
      const value = normalized.get(column);
      if (value) values.push(value);
    }
  }
  return values.join(" ");
}

function defaultDatasetSource(kind: DatasetKind): DatasetSource {
  if (kind === "oneStopOrdinal") {
    return {
      kind,
      dataset: "OneStopEnglish",
      license: "CC BY-SA 4.0",
      nonCommercial: false,
      requiresEnableNc: false,
      detection: ["mode:onestop"],
    };
  }
  if (kind === "vocabularyPenaltyAudit") {
    return {
      kind,
      dataset: "User-supplied Words-CEFR vocabulary",
      license: "unspecified",
      nonCommercial: false,
      requiresEnableNc: false,
      detection: ["mode:words-cefr"],
    };
  }
  return {
    kind,
    dataset: "User-supplied calibration corpus",
    license: "unspecified",
    nonCommercial: false,
    requiresEnableNc: false,
    detection: ["mode:calibration"],
  };
}

function ncMatches(text: string): Array<{ dataset: string; license: string; detection: string }> {
  const matches: Array<{ dataset: string; license: string; detection: string }> = [];
  for (const rule of NC_DATASET_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      matches.push({ dataset: rule.dataset, license: rule.license, detection: rule.dataset });
    }
  }
  return matches;
}

export function classifyDatasetSource(kind: DatasetKind, pathValue: string, rows?: PlainRow[]): DatasetSource {
  const source = defaultDatasetSource(kind);
  const searchable = `${pathValue} ${metadataText(rows)}`;
  const matches = ncMatches(searchable);
  if (matches.length === 0) return source;
  const primary = matches[0]!;
  return {
    ...source,
    dataset: primary.dataset,
    license: primary.license,
    nonCommercial: true,
    requiresEnableNc: true,
    detection: [...source.detection, ...matches.map((match) => `nc:${match.detection}`)],
  };
}

export function assertNcDatasetAllowed(source: DatasetSource, enableNc: boolean): void {
  if (source.requiresEnableNc && !enableNc) {
    throw new Error(
      `${source.kind} source "${source.dataset}" is marked non-commercial (${source.license}). ` +
        "Re-run with --enable-nc only after confirming local use is permitted; aggregate reports will mark nonCommercial=true.",
    );
  }
}

export function datasetSourceReport(source: DatasetSource): DatasetSourceReport {
  return {
    kind: source.kind,
    dataset: source.dataset,
    license: source.license,
    nonCommercial: source.nonCommercial,
    gate: source.requiresEnableNc ? "--enable-nc" : "not-required",
    detection: source.detection,
  };
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

export function parseDelimitedRows(raw: string, delimiter: "," | "\t"): PlainRow[] {
  const records = splitDelimitedRecords(raw.replace(/^\uFEFF/, "")).filter((record) => record.trim().length > 0);
  if (records.length === 0) return [];
  const headers = parseCsvLine(records[0]!, delimiter).map((header) => header.trim());
  return records.slice(1).map((record) => {
    const values = parseCsvLine(record, delimiter);
    const row: PlainRow = {};
    headers.forEach((header, index) => {
      row[header] = values[index]?.trim() ?? "";
    });
    return row;
  });
}

function splitDelimitedRecords(raw: string): string[] {
  const records: string[] = [];
  let record = "";
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]!;
    if (char === '"' && quoted && raw[i + 1] === '"') {
      record += char + raw[i + 1];
      i++;
      continue;
    }
    if (char === '"') quoted = !quoted;
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && raw[i + 1] === "\n") i++;
      records.push(record);
      record = "";
    } else {
      record += char;
    }
  }
  if (record.length > 0) records.push(record);
  return records;
}

function rowsFromJson(raw: string): PlainRow[] {
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) return parsed.filter(isPlainRecord).map(stringifyRecord);
  if (isPlainRecord(parsed)) return [stringifyRecord(parsed)];
  return [];
}

function rowsFromJsonl(raw: string): PlainRow[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown)
    .filter(isPlainRecord)
    .map(stringifyRecord);
}

function readRows(pathValue: string): PlainRow[] {
  const raw = readFileSync(pathValue, "utf8");
  const ext = extname(pathValue).toLowerCase();
  if (ext === ".jsonl" || ext === ".ndjson") return rowsFromJsonl(raw);
  if (ext === ".json") return rowsFromJson(raw);
  if (ext === ".tsv") return parseDelimitedRows(raw, "\t");
  return parseDelimitedRows(raw, ",");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringifyRecord(row: Record<string, unknown>): PlainRow {
  const out: PlainRow = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value == null ? "" : String(value);
  }
  return out;
}

function firstString(row: PlainRow, names: string[]): string | null {
  const normalized = new Map(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]));
  for (const name of names) {
    const value = normalized.get(name.toLowerCase());
    if (value && value.trim()) return value.trim();
  }
  return null;
}

function normalizeCefr(value: string | null): EnglishLevel | null {
  const token = value?.trim().toUpperCase().match(/\b([ABC][12])\+?\b/)?.[1];
  return isDifficultyLevel(token) ? token : null;
}

function normalizeOrdinal(value: string | null): OrdinalLabel | null {
  const token = value?.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!token) return null;
  if (["elementary", "beginner", "low"].includes(token)) return "elementary";
  if (["intermediate", "mid", "medium"].includes(token)) return "intermediate";
  if (["advanced", "high"].includes(token)) return "advanced";
  return null;
}

function levelToOrdinal(level: EnglishLevel): OrdinalLabel {
  const rank = levelRank(level);
  if (rank <= 1) return "elementary";
  if (rank <= 3) return "intermediate";
  return "advanced";
}

function ordinalRank(label: OrdinalLabel): number {
  return ORDINAL_LABELS.indexOf(label);
}

function labelRank(label: AnyLabel): number {
  return isDifficultyLevel(label) ? levelRank(label) : ordinalRank(label);
}

function calibrationRecordFromRow(row: PlainRow, ordinalOnly = false): CalibrationRecord | null {
  const text = firstString(row, [
    "text",
    "content",
    "article_text",
    "articleText",
    "body",
    "html",
    "contentHtml",
    "passage",
  ]);
  if (!text) return null;
  const labelValue = firstString(row, ["cefr", "level", "label", "difficulty", "cefr_level", "cefrLevel"]);
  const ordinalValue = firstString(row, ["ordinal", "ordinal_label", "ose_level", "oseLevel", "onestop", "level", "label"]);
  const label = ordinalOnly ? null : normalizeCefr(labelValue);
  const ordinalLabel = normalizeOrdinal(ordinalValue ?? labelValue);
  return {
    text,
    ...(label ? { label } : {}),
    ...(ordinalLabel ? { ordinalLabel } : {}),
  };
}

function providerLabelFromRow(row: PlainRow): ProviderLabelRecord | null {
  const providerDb = firstString(row, ["providerDb", "provider_db", "db", "database", "providerDbPath"]);
  const articleId = firstString(row, ["articleId", "article_id", "id"]);
  if (!providerDb || !articleId) return null;
  const labelValue = firstString(row, ["cefr", "level", "label", "difficulty", "cefrLevel"]);
  const ordinalValue = firstString(row, ["ordinal", "ordinal_label", "oseLevel", "onestop"]);
  const label = normalizeCefr(labelValue);
  const ordinalLabel = normalizeOrdinal(ordinalValue ?? labelValue);
  return {
    providerDb: basename(providerDb),
    articleId,
    ...(label ? { label } : {}),
    ...(ordinalLabel ? { ordinalLabel } : {}),
  };
}

function vocabularyRecordFromRow(row: PlainRow): VocabularyRecord | null {
  const word = firstString(row, ["word", "lemma", "headword", "item"]);
  const label = normalizeCefr(firstString(row, ["cefr", "level", "label", "cefr_level", "cefrLevel"]));
  if (!word || !label) return null;
  return { word, label };
}

function scoreCalibration(records: CalibrationRecord[]): ScoredRecord[] {
  return records.map((record) => {
    const assessed = deterministicDifficulty(record.text);
    return {
      predictedLevel: assessed.level,
      predictedOrdinal: levelToOrdinal(assessed.level),
      score: assessed.score,
      lexileApprox: assessed.lexileApprox,
      ...(record.label ? { label: record.label } : {}),
      ...(record.ordinalLabel ? { ordinalLabel: record.ordinalLabel } : {}),
    };
  });
}

function increment(record: NumericRecord, key: string, by = 1): void {
  record[key] = (record[key] ?? 0) + by;
}

function sorted(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = (sortedValues.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sortedValues[low]!;
  return sortedValues[low]! + (sortedValues[high]! - sortedValues[low]!) * (index - low);
}

function summarizeDistribution(values: number[]): DistributionSummary | null {
  if (values.length === 0) return null;
  const data = sorted(values);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    min: round(data[0]!),
    p10: round(percentile(data, 0.1)),
    p25: round(percentile(data, 0.25)),
    p50: round(percentile(data, 0.5)),
    p75: round(percentile(data, 0.75)),
    p90: round(percentile(data, 0.9)),
    max: round(data[data.length - 1]!),
    average: round(average),
  };
}

function round(value: number, places = 3): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function confusionFor<T extends AnyLabel>(
  rows: ScoredRecord[],
  labels: readonly T[],
  actual: (row: ScoredRecord) => T | undefined,
  predicted: (row: ScoredRecord) => T,
): LabelMetrics | undefined {
  const matrix: ConfusionMatrix = Object.fromEntries(labels.map((label) => [label, {}]));
  let count = 0;
  let exact = 0;
  let withinOne = 0;
  for (const row of rows) {
    const actualLabel = actual(row);
    if (!actualLabel) continue;
    const predictedLabel = predicted(row);
    count++;
    if (actualLabel === predictedLabel) exact++;
    if (Math.abs(labelRank(actualLabel) - labelRank(predictedLabel)) <= 1) withinOne++;
    increment(matrix[actualLabel]!, predictedLabel);
  }
  if (count === 0) return undefined;
  return {
    count,
    exact,
    exactRate: round(exact / count),
    withinOne,
    withinOneRate: round(withinOne / count),
    confusion: matrix,
  };
}

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length < 2 || xs.length !== ys.length) return null;
  const xAvg = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const yAvg = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let numerator = 0;
  let xDen = 0;
  let yDen = 0;
  xs.forEach((x, index) => {
    const xd = x - xAvg;
    const yd = ys[index]! - yAvg;
    numerator += xd * yd;
    xDen += xd * xd;
    yDen += yd * yd;
  });
  const denominator = Math.sqrt(xDen * yDen);
  return denominator === 0 ? null : round(numerator / denominator);
}

function ranks(values: number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const out = new Array<number>(values.length);
  for (let i = 0; i < indexed.length; i++) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1]!.value === indexed[i]!.value) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[indexed[k]!.index] = rank;
    i = j;
  }
  return out;
}

function correlationByLabel(rows: ScoredRecord[]): CorrelationSummary | null {
  const labeled = rows.filter((row) => row.label || row.ordinalLabel);
  if (labeled.length < 2) return null;
  const labelRanks = labeled.map((row) => labelRank(row.label ?? row.ordinalLabel!));
  const lexiles = labeled.map((row) => row.lexileApprox);
  const medians = new Map<number, number>();
  for (const rankValue of [...new Set(labelRanks)].sort((a, b) => a - b)) {
    medians.set(
      rankValue,
      summarizeDistribution(labeled.filter((row) => labelRank(row.label ?? row.ordinalLabel!) === rankValue).map((row) => row.lexileApprox))!
        .p50,
    );
  }
  const orderedMedians = [...medians.entries()].sort(([a], [b]) => a - b).map(([, value]) => value);
  let monotonicAdjacentPairs = 0;
  for (let i = 1; i < orderedMedians.length; i++) {
    if (orderedMedians[i]! >= orderedMedians[i - 1]!) monotonicAdjacentPairs++;
  }
  const adjacentPairs = Math.max(0, orderedMedians.length - 1);
  return {
    pearson: pearson(labelRanks, lexiles),
    spearman: pearson(ranks(labelRanks), ranks(lexiles)),
    monotonicAdjacentPairs,
    adjacentPairs,
    monotonicityRate: adjacentPairs === 0 ? null : round(monotonicAdjacentPairs / adjacentPairs),
  };
}

export function summarizeScoredRecords(rows: ScoredRecord[]): MetricSummary {
  const predictedCefr: NumericRecord = {};
  const predictedOrdinal: NumericRecord = {};
  for (const row of rows) {
    increment(predictedCefr, row.predictedLevel);
    increment(predictedOrdinal, row.predictedOrdinal);
  }
  const byLabel: Record<string, DistributionSummary> = {};
  for (const label of [...ENGLISH_LEVELS, ...ORDINAL_LABELS]) {
    const values = rows
      .filter((row) => row.label === label || row.ordinalLabel === label)
      .map((row) => row.lexileApprox);
    const summary = summarizeDistribution(values);
    if (summary) byLabel[label] = summary;
  }
  const byPredictedCefr: Record<string, DistributionSummary> = {};
  for (const level of ENGLISH_LEVELS) {
    const summary = summarizeDistribution(rows.filter((row) => row.predictedLevel === level).map((row) => row.lexileApprox));
    if (summary) byPredictedCefr[level] = summary;
  }
  const byPredictedOrdinal: Record<string, DistributionSummary> = {};
  for (const level of ORDINAL_LABELS) {
    const summary = summarizeDistribution(rows.filter((row) => row.predictedOrdinal === level).map((row) => row.lexileApprox));
    if (summary) byPredictedOrdinal[level] = summary;
  }
  return {
    count: rows.length,
    score: summarizeDistribution(rows.map((row) => row.score)),
    lexileLike: summarizeDistribution(rows.map((row) => row.lexileApprox)),
    predictedCefr,
    predictedOrdinal,
    cefr: confusionFor(rows, ENGLISH_LEVELS, (row) => row.label, (row) => row.predictedLevel),
    ordinal: confusionFor(rows, ORDINAL_LABELS, (row) => row.ordinalLabel, (row) => row.predictedOrdinal),
    lexileLikeByLabel: Object.keys(byLabel).length > 0 ? byLabel : undefined,
    lexileLikeByPredictedCefr: byPredictedCefr,
    lexileLikeByPredictedOrdinal: byPredictedOrdinal,
    lexileLikeCorrelationByLabel: correlationByLabel(rows),
  };
}

function calibrationRecordsFromRows(rows: PlainRow[], ordinalOnly = false): CalibrationRecord[] {
  return rows
    .map((row) => calibrationRecordFromRow(row, ordinalOnly))
    .filter((row): row is CalibrationRecord => row !== null);
}

function openSqlite(pathValue: string): SQLiteDatabase {
  const require = createRequire(import.meta.url);
  const Database = require("better-sqlite3") as new (
    path: string,
    options?: { readonly?: boolean; fileMustExist?: boolean },
  ) => SQLiteDatabase;
  return new Database(pathValue, { readonly: true, fileMustExist: true });
}

function providerDbFiles(names: string[] = []): string[] {
  if (!existsSync(PROVIDER_DB_DIR)) return [];
  const allowed = new Set(names.filter(Boolean));
  return readdirSync(PROVIDER_DB_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extname(entry.name) === ".db")
    .filter((entry) => allowed.size === 0 || allowed.has(entry.name))
    .map((entry) => join(PROVIDER_DB_DIR, entry.name))
    .sort();
}

function readProviderLabels(pathValue: string | null): Map<string, Map<string, ProviderLabelRecord>> {
  const out = new Map<string, Map<string, ProviderLabelRecord>>();
  if (!pathValue) return out;
  for (const row of readRows(assertExistingFile(pathValue, "--provider-labels"))) {
    const record = providerLabelFromRow(row);
    if (!record) continue;
    if (!out.has(record.providerDb)) out.set(record.providerDb, new Map());
    out.get(record.providerDb)!.set(record.articleId, record);
  }
  return out;
}

function scoreProviderDb(
  pathValue: string,
  labels: Map<string, ProviderLabelRecord> | undefined,
  limit: number | null,
): ProviderDbSummary {
  const db = openSqlite(pathValue);
  try {
    const rows = db.prepare(
      `SELECT id, content, difficulty, difficultyScore, lexileApprox, difficultyVersion
       FROM Article
       WHERE content IS NOT NULL AND length(content) > 0
       ${limit ? `LIMIT ${limit}` : ""}`,
    ).all() as Array<{
      id: string;
      content: string;
      difficulty: string | null;
      difficultyScore: number | null;
      lexileApprox: number | null;
      difficultyVersion: string | null;
    }>;
    const scored: ScoredRecord[] = [];
    const labeled: ScoredRecord[] = [];
    const storedDifficulty: NumericRecord = {};
    const difficultyVersion: NumericRecord = {};
    const scoreDeltas: number[] = [];
    let missingDifficulty = 0;
    let missingLexileLike = 0;
    let staleVersion = 0;

    for (const row of rows) {
      const assessed = deterministicDifficulty(row.content);
      const predicted: ScoredRecord = {
        predictedLevel: assessed.level,
        predictedOrdinal: levelToOrdinal(assessed.level),
        score: assessed.score,
        lexileApprox: assessed.lexileApprox,
      };
      scored.push(predicted);
      const label = labels?.get(row.id);
      if (label) {
        labeled.push({
          ...predicted,
          ...(label.label ? { label: label.label } : {}),
          ...(label.ordinalLabel ? { ordinalLabel: label.ordinalLabel } : {}),
        });
      }
      if (isDifficultyLevel(row.difficulty)) {
        increment(storedDifficulty, row.difficulty);
      } else {
        missingDifficulty++;
      }
      if (row.difficultyVersion) increment(difficultyVersion, row.difficultyVersion);
      if (row.difficultyVersion !== DIFFICULTY_ALGORITHM_VERSION) staleVersion++;
      if (row.lexileApprox == null) missingLexileLike++;
      if (typeof row.difficultyScore === "number") scoreDeltas.push(Math.abs(row.difficultyScore - assessed.score));
    }

    return {
      providerDb: `prisma/provider-dbs/${basename(pathValue)}`,
      articleCount: rows.length,
      computed: summarizeScoredRecords(scored),
      stored: {
        difficulty: storedDifficulty,
        difficultyVersion,
        missingDifficulty,
        missingLexileLike,
        staleVersion,
        storedScoreDelta: summarizeDistribution(scoreDeltas),
      },
      ...(labeled.length > 0 ? { labeled: summarizeScoredRecords(labeled) } : {}),
    };
  } finally {
    db.close();
  }
}

function sqliteRowsForVocabulary(pathValue: string): PlainRow[] {
  const db = openSqlite(pathValue);
  try {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all() as Array<{ name: string }>;
    for (const { name } of tables) {
      const columns = db.prepare(`PRAGMA table_info(${JSON.stringify(name)})`).all() as Array<{ name: string }>;
      const names = columns.map((column) => column.name);
      const wordColumn = names.find((column) => ["word", "lemma", "headword", "item"].includes(column.toLowerCase()));
      const labelColumn = names.find((column) => ["cefr", "level", "label", "cefr_level", "cefrlevel"].includes(column.toLowerCase()));
      if (!wordColumn || !labelColumn) continue;
      return db.prepare(
        `SELECT ${JSON.stringify(wordColumn)} AS word, ${JSON.stringify(labelColumn)} AS cefr FROM ${JSON.stringify(name)}`,
      ).all() as PlainRow[];
    }
    return [];
  } finally {
    db.close();
  }
}

function readVocabularyRecords(pathValue: string): VocabularyRecord[] {
  const ext = extname(pathValue).toLowerCase();
  const rows = [".db", ".sqlite", ".sqlite3"].includes(ext)
    ? sqliteRowsForVocabulary(pathValue)
    : readRows(pathValue);
  return rows.map(vocabularyRecordFromRow).filter((row): row is VocabularyRecord => row !== null);
}

function vocabularyRecordsFromRows(rows: PlainRow[]): VocabularyRecord[] {
  return rows.map(vocabularyRecordFromRow).filter((row): row is VocabularyRecord => row !== null);
}

function expectedBandCeiling(label: EnglishLevel): number {
  // Conservative monotone target: easier CEFR labels should usually sit in
  // lower-penalty bands, harder labels may use progressively rarer words.
  return levelRank(label) + 1;
}

export function summarizeVocabularyRecords(records: VocabularyRecord[]) {
  const byCefr: NumericRecord = {};
  const byBand: NumericRecord = {};
  const matrix: ConfusionMatrix = Object.fromEntries(ENGLISH_LEVELS.map((level) => [level, {}]));
  let withinExpectedCeiling = 0;
  const penaltyByLevel: Record<string, number[]> = {};
  const ranksForCorrelation: number[] = [];
  const penaltiesForCorrelation: number[] = [];

  for (const record of records) {
    const band = wordFrequencyBand(record.word);
    const penalty = VOCABULARY_BAND_PENALTY[band];
    const bandRank = WORD_FREQUENCY_BANDS.indexOf(band);
    increment(byCefr, record.label);
    increment(byBand, band);
    increment(matrix[record.label]!, band);
    if (bandRank <= expectedBandCeiling(record.label)) withinExpectedCeiling++;
    if (!penaltyByLevel[record.label]) penaltyByLevel[record.label] = [];
    penaltyByLevel[record.label]!.push(penalty);
    ranksForCorrelation.push(levelRank(record.label));
    penaltiesForCorrelation.push(penalty);
  }

  const penaltyByCefr: Record<string, DistributionSummary> = {};
  for (const [level, values] of Object.entries(penaltyByLevel)) {
    const summary = summarizeDistribution(values);
    if (summary) penaltyByCefr[level] = summary;
  }

  return {
    count: records.length,
    byCefr,
    byFrequencyBand: byBand,
    cefrByFrequencyBand: matrix,
    withinExpectedFrequencyCeiling: withinExpectedCeiling,
    withinExpectedFrequencyCeilingRate: records.length === 0 ? null : round(withinExpectedCeiling / records.length),
    penaltyByCefr,
    penaltyCorrelationByCefr: {
      pearson: pearson(ranksForCorrelation, penaltiesForCorrelation),
      spearman: pearson(ranks(ranksForCorrelation), ranks(penaltiesForCorrelation)),
    },
  };
}

function providerDistributionFractions(summary: ProviderDbSummary): NumericRecord {
  const out: NumericRecord = {};
  const total = Math.max(1, summary.computed.count);
  for (const level of ENGLISH_LEVELS) {
    out[level] = (summary.computed.predictedCefr[level] ?? 0) / total;
  }
  return out;
}

export function compareProviderSnapshots(
  previous: ProviderDbSummary[],
  current: ProviderDbSummary[],
  threshold: number,
): SnapshotComparison {
  const previousByDb = new Map(previous.map((summary) => [summary.providerDb, summary]));
  const exceeded: SnapshotComparison["exceeded"] = [];
  let compared = 0;
  for (const currentSummary of current) {
    const previousSummary = previousByDb.get(currentSummary.providerDb);
    if (!previousSummary) continue;
    compared++;
    const before = providerDistributionFractions(previousSummary);
    const after = providerDistributionFractions(currentSummary);
    for (const level of ENGLISH_LEVELS) {
      const delta = round(after[level]! - before[level]!);
      if (Math.abs(delta) > threshold) {
        exceeded.push({
          providerDb: currentSummary.providerDb,
          metric: `computed.predictedCefr.${level}`,
          previous: round(before[level]!),
          current: round(after[level]!),
          delta,
        });
      }
    }
  }
  return { compared, threshold, exceeded };
}

function readSnapshot(pathValue: string): ProviderDbSummary[] {
  const parsed = JSON.parse(readFileSync(assertExistingFile(pathValue, "--compare-snapshot"), "utf8")) as unknown;
  if (Array.isArray(parsed)) return parsed as ProviderDbSummary[];
  if (isPlainRecord(parsed) && Array.isArray(parsed.providerDbs)) return parsed.providerDbs as ProviderDbSummary[];
  throw new Error("--compare-snapshot must contain a providerDbs array or a provider summary array.");
}

function buildReport(args: Args): Report {
  const report: Report = {
    generatedAt: new Date().toISOString(),
    algorithmVersion: DIFFICULTY_ALGORITHM_VERSION,
    datasetSources: [],
    notes: [
      "CEFR labels are heuristic/hybrid-calibrated; v4 uses opt-in NC A1-C2 labels plus OneStopEnglish-style three-level ordinal anchors.",
      "lexileApprox is Lexile-like and is not an official Lexile measure.",
      "Outputs are aggregate only; raw text, titles, excerpts, article IDs, and word examples are intentionally omitted.",
      "NC/CC-BY-NC/CC-BY-NC-SA datasets are disabled unless --enable-nc is present and are marked in datasetSources.",
    ],
  };

  if (args.calibration) {
    const pathValue = assertOutsideRepo(args.calibration, "--calibration");
    assertNcDatasetAllowed(classifyDatasetSource("calibration", pathValue), args.enableNc);
    const rows = readRows(pathValue);
    const source = classifyDatasetSource("calibration", pathValue, rows);
    assertNcDatasetAllowed(source, args.enableNc);
    report.datasetSources.push(datasetSourceReport(source));
    const records = calibrationRecordsFromRows(rows);
    report.calibration = summarizeScoredRecords(scoreCalibration(records));
  }
  if (args.onestop) {
    const pathValue = assertOutsideRepo(args.onestop, "--onestop");
    assertNcDatasetAllowed(classifyDatasetSource("oneStopOrdinal", pathValue), args.enableNc);
    const rows = readRows(pathValue);
    const source = classifyDatasetSource("oneStopOrdinal", pathValue, rows);
    assertNcDatasetAllowed(source, args.enableNc);
    report.datasetSources.push(datasetSourceReport(source));
    const records = calibrationRecordsFromRows(rows, true);
    report.oneStopOrdinal = summarizeScoredRecords(scoreCalibration(records));
  }
  if (args.wordsCefr) {
    const pathValue = assertOutsideRepo(args.wordsCefr, "--words-cefr");
    assertNcDatasetAllowed(classifyDatasetSource("vocabularyPenaltyAudit", pathValue), args.enableNc);
    const ext = extname(pathValue).toLowerCase();
    if ([".db", ".sqlite", ".sqlite3"].includes(ext)) {
      const source = classifyDatasetSource("vocabularyPenaltyAudit", pathValue);
      assertNcDatasetAllowed(source, args.enableNc);
      report.datasetSources.push(datasetSourceReport(source));
      report.vocabularyPenaltyAudit = summarizeVocabularyRecords(readVocabularyRecords(pathValue));
    } else {
      const rows = readRows(pathValue);
      const source = classifyDatasetSource("vocabularyPenaltyAudit", pathValue, rows);
      assertNcDatasetAllowed(source, args.enableNc);
      report.datasetSources.push(datasetSourceReport(source));
      report.vocabularyPenaltyAudit = summarizeVocabularyRecords(vocabularyRecordsFromRows(rows));
    }
  }
  if (args.providerDbs) {
    const labels = readProviderLabels(args.providerLabels);
    report.providerDbs = providerDbFiles(args.providerDbNames).map((pathValue) =>
      scoreProviderDb(pathValue, labels.get(basename(pathValue)), args.providerLimit),
    );
  }
  if (args.compareSnapshot) {
    report.snapshotComparison = compareProviderSnapshots(readSnapshot(args.compareSnapshot), report.providerDbs ?? [], args.driftThreshold);
  }
  return report;
}

function printMetricSummary(name: string, summary: MetricSummary | undefined): void {
  if (!summary) return;
  console.log(`${name}: count=${summary.count}`);
  console.log(`  predicted CEFR=${JSON.stringify(summary.predictedCefr)}`);
  console.log(`  score=${JSON.stringify(summary.score)} lexileLike=${JSON.stringify(summary.lexileLike)}`);
  if (summary.cefr) {
    console.log(`  CEFR exact=${summary.cefr.exactRate} withinOne=${summary.cefr.withinOneRate}`);
  }
  if (summary.ordinal) {
    console.log(`  ordinal exact=${summary.ordinal.exactRate} withinOne=${summary.ordinal.withinOneRate}`);
  }
  if (summary.lexileLikeCorrelationByLabel) {
    console.log(`  lexileLike correlation=${JSON.stringify(summary.lexileLikeCorrelationByLabel)}`);
  }
}

function printConsoleReport(report: Report): void {
  console.log(`Difficulty evaluation (${report.algorithmVersion}) — ${report.generatedAt}`);
  for (const note of report.notes) console.log(`- ${note}`);
  if (report.datasetSources.length > 0) {
    console.log("Dataset sources:");
    for (const source of report.datasetSources) {
      console.log(
        `  ${source.kind}: dataset=${source.dataset} license=${source.license} ` +
          `nonCommercial=${source.nonCommercial} gate=${source.gate}`,
      );
    }
  }
  printMetricSummary("Calibration", report.calibration);
  printMetricSummary("OneStop ordinal", report.oneStopOrdinal);
  if (report.providerDbs) {
    console.log(`Provider DBs: ${report.providerDbs.length}`);
    for (const provider of report.providerDbs) {
      console.log(
        `  ${provider.providerDb}: articles=${provider.articleCount} ` +
          `computed=${JSON.stringify(provider.computed.predictedCefr)} ` +
          `stored=${JSON.stringify(provider.stored.difficulty)} stale=${provider.stored.staleVersion}`,
      );
      if (provider.labeled) printMetricSummary("  labels", provider.labeled);
    }
  }
  if (report.vocabularyPenaltyAudit) {
    console.log(`Vocabulary penalty audit: count=${report.vocabularyPenaltyAudit.count}`);
    console.log(`  by CEFR=${JSON.stringify(report.vocabularyPenaltyAudit.byCefr)}`);
    console.log(`  by frequency band=${JSON.stringify(report.vocabularyPenaltyAudit.byFrequencyBand)}`);
    console.log(`  agreement=${report.vocabularyPenaltyAudit.withinExpectedFrequencyCeilingRate}`);
  }
  if (report.snapshotComparison) {
    console.log(
      `Snapshot comparison: compared=${report.snapshotComparison.compared} ` +
        `exceeded=${report.snapshotComparison.exceeded.length}`,
    );
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }
  if (!args.calibration && !args.onestop && !args.wordsCefr && !args.providerDbs) {
    printHelp();
    return 2;
  }
  const report = buildReport(args);
  if (args.snapshotOut) {
    writeFileSync(args.snapshotOut, JSON.stringify(report.providerDbs ?? [], null, 2));
    console.error(`Wrote aggregate provider snapshot to ${args.snapshotOut}`);
  }
  if (args.out) {
    writeFileSync(args.out, JSON.stringify(report, null, 2));
    console.error(`Wrote aggregate report to ${args.out}`);
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printConsoleReport(report);
  }
  return report.snapshotComparison && report.snapshotComparison.exceeded.length > 0 ? 1 : 0;
}

export {
  buildReport,
  calibrationRecordFromRow,
  providerDbFiles,
  providerLabelFromRow,
  readVocabularyRecords,
  scoreCalibration,
  summarizeDistribution,
  vocabularyRecordFromRow,
};

if (isMain(import.meta.url)) {
  runScript(main, "difficulty evaluation failed");
}
