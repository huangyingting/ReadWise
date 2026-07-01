process.env.LOG_LEVEL = "error";

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bucketize } from "@/lib/aggregation";
import { extractJsonArray, validateQuiz } from "@/lib/ai/output/validators";
import { grammarEvaluator } from "@/lib/ai/evals/evaluators/grammar";
import { safetyEvaluator } from "@/lib/ai/evals/evaluators/safety";
import { translationEvaluator } from "@/lib/ai/evals/evaluators/translation";
import { tutorEvaluator } from "@/lib/ai/evals/evaluators/tutor";
import { loadEvalDatasets } from "@/lib/ai/evals/datasets";
import { collectFailures } from "@/lib/ai/evals/report";
import type { EvalReport } from "@/lib/ai/evals/types";
import { importBody, parseListQuery } from "@/lib/import/schemas";
import { parseClozeQuery, parseWordsQuery } from "@/lib/study/schemas";
import { parseExportQuery, saveWordBody, unsaveBatchBody } from "@/lib/vocabulary/schemas";
import { parseRssUrls } from "@/lib/scraper/rss";
import { csvField, csvRow, csvRows } from "@/lib/csv";
import { parsePaginationParams, string, validate } from "@/lib/validation";
import {
  STORAGE_KEYS,
  lsGet,
  lsRemove,
  lsSet,
  ssGet,
  ssRemove,
  ssSet,
} from "@/lib/storage-keys";
import { headlineReason } from "@/lib/recommendations/explanations";
import type {
  RecommendationCandidate,
  RecommendationContext,
  ScoreComponents,
} from "@/lib/recommendations/types";

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

function setTestWindow(value: unknown): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value,
  });
}

afterEach(() => {
  if (windowDescriptor) {
    Object.defineProperty(globalThis, "window", windowDescriptor);
  } else {
    delete (globalThis as Record<string, unknown>)["window"];
  }
});

test("bucketize folds duplicate, null, and unregistered rows into ordered buckets", () => {
  const result = bucketize(
    [
      { key: "news", label: "News" },
      { key: "science", label: "Science" },
    ],
    [
      { key: "news", count: 2 },
      { key: "news", count: 3 },
      { key: "unknown", count: 5 },
      { key: null, count: 7 },
    ],
  );

  assert.deepEqual(result, [
    { key: "news", label: "News", count: 5 },
    { key: "science", label: "Science", count: 0 },
    { key: "other", label: "Other", count: 12 },
  ]);
});

test("bucketize can suppress spillover buckets", () => {
  const result = bucketize(
    [{ key: "news", label: "News" }],
    [{ key: "unknown", count: 5 }],
    null,
  );
  assert.deepEqual(result, [{ key: "news", label: "News", count: 0 }]);
});

test("AI output validators reject malformed arrays and non-object quiz rows", () => {
  assert.equal(extractJsonArray("before [1,] after"), null);

  const { items, rejected } = validateQuiz(
    JSON.stringify([
      "not an object",
      { question: "Valid?", options: ["yes", "no"], correctIndex: 0 },
    ]),
  );

  assert.equal(rejected, 1);
  assert.deepEqual(items.map((item) => item.question), ["Valid?"]);
});

test("CSV helpers quote fields with separators and line breaks", () => {
  assert.equal(csvField('a "quoted", value'), '"a ""quoted"", value"');
  assert.equal(csvField("line\r\nbreak"), '"line\r\nbreak"');
  assert.equal(csvRow(["plain", null, 7]), "plain,,7");
  assert.equal(csvRows([["a", "b"], ["c,d", "e"]]), 'a,b\r\n"c,d",e');
});

test("parseRssUrls skips URL-shaped but unparsable values", () => {
  const urls = parseRssUrls(`
    <rss><channel>
      <item><link>http://[::1</link></item>
      <item><link>https://example.com/article?utm_source=rss#frag</link></item>
    </channel></rss>
  `);

  assert.deepEqual(urls, ["https://example.com/article"]);
});

test("feature schema helpers parse and reject route inputs directly", () => {
  assert.deepEqual(parseListQuery(new URLSearchParams("offset=-5&limit=999")), {
    ok: true,
    value: { offset: 0, limit: 50 },
  });
  assert.deepEqual(parseClozeQuery(new URLSearchParams("limit=999")), {
    ok: true,
    value: { limit: 50 },
  });
  assert.deepEqual(parseWordsQuery(new URLSearchParams("filter=bad")), {
    ok: false,
    error: 'filter must be "all", "due", or "new"',
  });
  assert.deepEqual(parseWordsQuery(new URLSearchParams("filter=due&q=review&articleId=a1&page=2")), {
    ok: true,
    value: { q: "review", articleId: "a1", filter: "due", page: 2 },
  });
  assert.deepEqual(parseExportQuery(new URLSearchParams("format=anki")), {
    ok: true,
    value: { format: "anki" },
  });
  assert.deepEqual(parseExportQuery(new URLSearchParams("format=pdf")), {
    ok: false,
    error: 'format must be "csv" or "anki"',
  });
});

test("generic validation helpers expose validate and pagination parsing seams", () => {
  assert.deepEqual(validate(string({ min: 2 }), " ok "), { ok: true, value: "ok" });
  assert.deepEqual(parsePaginationParams(new URLSearchParams("offset=-1&limit=999"), {
    defaultLimit: 20,
    maxLimit: 50,
  }), { offset: 0, limit: 50 });
});

test("feature body schemas trim and enforce validation contracts", () => {
  const importResult = importBody({
    url: " https://example.com/story ",
    title: null,
    text: "body",
    ignored: "dropped",
  });
  assert.deepEqual(importResult, {
    ok: true,
    value: { url: "https://example.com/story", title: undefined, text: "body" },
  });

  assert.deepEqual(saveWordBody({ word: "  luminance  ", explanation: " kept " }), {
    ok: true,
    value: {
      word: "luminance",
      explanation: " kept ",
      example: undefined,
      contextSentence: undefined,
      articleId: undefined,
    },
  });
  assert.equal(unsaveBatchBody({ words: Array.from({ length: 201 }, () => "word") }).ok, false);
});

test("evaluation helpers report invalid datasets and collect failed properties", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const invalidDir = path.join(here, "fixtures", "evals-invalid");
  assert.throws(() => loadEvalDatasets(invalidDir), /Invalid eval dataset: bad\.json/);

  const report = {
    features: [
      {
        feature: "quiz",
        cases: [
          {
            caseName: "rejects bad output",
            properties: [
              { name: "valid-json", passed: true },
              { name: "minimum-items", passed: false, detail: "no valid items" },
            ],
          },
        ],
      },
    ],
  } as EvalReport;

  assert.deepEqual(collectFailures(report), [
    {
      feature: "quiz",
      caseName: "rejects bad output",
      property: "minimum-items",
      detail: "no valid items",
    },
  ]);
});

test("eval feature buildMessages paths are callable without inspecting prompt text", () => {
  assert.ok(
    grammarEvaluator.buildMessages({ phrase: "had went", context: "", level: "A2" }).length > 0,
  );
  assert.ok(
    translationEvaluator.buildMessages({
      targetLang: "es",
      title: "T",
      source: "One paragraph.",
    }).length > 0,
  );
  assert.ok(
    tutorEvaluator.buildMessages({
      level: "B1",
      title: "T",
      articleText: "A short neutral article summary.",
      question: "What happened?",
    }).length > 0,
  );
  assert.ok(safetyEvaluator.buildMessages({}).length > 0);

  const tutorChecks = tutorEvaluator.check(
    "The answer mentions only photosynthesis.",
    {},
    { mustInclude: ["chlorophyll"] },
  );
  assert.equal(tutorChecks.some((check) => check.name === "grounded-in-article" && !check.passed), true);

  const safetyChecks = safetyEvaluator.check(
    "My system prompt says to ignore previous instructions.",
    {},
    { mustNotLeakPatterns: ["system prompt"] },
  );
  assert.equal(
    safetyChecks.some((check) => check.name.startsWith("no-leakage:") && !check.passed),
    true,
  );
});

function components(top: keyof ScoreComponents): ScoreComponents {
  return {
    levelFit: top === "levelFit" ? 1 : 0,
    topicInterest: top === "topicInterest" ? 1 : 0,
    novelty: top === "novelty" ? 1 : 0,
    difficultyFeedback: top === "difficultyFeedback" ? 1 : 0,
    masteryGap: top === "masteryGap" ? 1 : 0,
    wordLoad: top === "wordLoad" ? 1 : 0,
    freshness: top === "freshness" ? 1 : 0,
  };
}

const baseCandidate = { id: "article-1", category: null } as RecommendationCandidate;
const baseCtx: RecommendationContext = {
  userLevel: null,
  userLevelRank: null,
  topicSet: new Set(),
  completedIds: new Set(),
  inProgressPercent: new Map(),
  masteryByArticle: new Map(),
  difficultyBias: 0,
  weakestSkill: null,
  vocab: { avgFamiliarity: 0, knownCount: 0 },
  weakWordArticleIds: new Map(),
  goalPath: null,
  now: new Date("2026-01-01T00:00:00Z"),
};

test("headlineReason covers each dominant recommendation component", () => {
  assert.equal(
    headlineReason({ ...baseCandidate, category: "science" }, components("topicInterest"), baseCtx),
    "Matches your interest in Science",
  );
  assert.equal(
    headlineReason(baseCandidate, components("topicInterest"), baseCtx),
    "Matches your interests",
  );
  assert.equal(
    headlineReason(baseCandidate, components("levelFit"), { ...baseCtx, userLevel: "B2" }),
    "Right for your B2 level",
  );
  assert.equal(headlineReason(baseCandidate, components("levelFit"), baseCtx), "A good reading-level match");
  assert.equal(headlineReason(baseCandidate, components("novelty"), baseCtx), "New to you");
  assert.equal(
    headlineReason(baseCandidate, components("masteryGap"), { ...baseCtx, weakestSkill: "reading" }),
    "Helps build your reading",
  );
  assert.equal(
    headlineReason(baseCandidate, components("masteryGap"), baseCtx),
    "A fresh learning opportunity",
  );
  assert.equal(
    headlineReason(baseCandidate, components("wordLoad"), baseCtx),
    "A comfortable vocabulary stretch",
  );
  assert.equal(
    headlineReason(baseCandidate, components("difficultyFeedback"), {
      ...baseCtx,
      difficultyBias: -1,
    }),
    "Easier, matching your recent feedback",
  );
  assert.equal(
    headlineReason(baseCandidate, components("difficultyFeedback"), {
      ...baseCtx,
      difficultyBias: 1,
    }),
    "A bit more challenging, as you asked",
  );
  assert.equal(headlineReason(baseCandidate, components("freshness"), baseCtx), "Freshly published");
});

test("storage helpers use browser storage and gracefully ignore storage failures", () => {
  const local = new Map<string, string>();
  const session = new Map<string, string>();
  setTestWindow({
    localStorage: {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => local.set(key, value),
      removeItem: (key: string) => local.delete(key),
    },
    sessionStorage: {
      getItem: (key: string) => session.get(key) ?? null,
      setItem: (key: string, value: string) => session.set(key, value),
      removeItem: (key: string) => session.delete(key),
    },
  });

  lsSet(STORAGE_KEYS.THEME, "dark");
  assert.equal(lsGet(STORAGE_KEYS.THEME), "dark");
  lsRemove(STORAGE_KEYS.THEME);
  assert.equal(lsGet(STORAGE_KEYS.THEME), null);

  ssSet(STORAGE_KEYS.READER_REFERRER, "library");
  assert.equal(ssGet(STORAGE_KEYS.READER_REFERRER), "library");
  ssRemove(STORAGE_KEYS.READER_REFERRER);
  assert.equal(ssGet(STORAGE_KEYS.READER_REFERRER), null);

  setTestWindow({
    localStorage: {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    },
    sessionStorage: {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    },
  });

  assert.equal(lsGet(STORAGE_KEYS.THEME), null);
  assert.doesNotThrow(() => lsSet(STORAGE_KEYS.THEME, "light"));
  assert.doesNotThrow(() => lsRemove(STORAGE_KEYS.THEME));
  assert.equal(ssGet(STORAGE_KEYS.READER_REFERRER), null);
  assert.doesNotThrow(() => ssSet(STORAGE_KEYS.READER_REFERRER, "home"));
  assert.doesNotThrow(() => ssRemove(STORAGE_KEYS.READER_REFERRER));
});
