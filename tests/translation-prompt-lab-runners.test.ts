process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, beforeEach, mock, test } from "node:test";

type Completion = {
  text: string;
  finishReason: string | null;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
  durationMs: number;
};

const chatQueue: Array<Completion | Error> = [];
const chatCalls: Array<{ messages: unknown[]; options: unknown; attempts: number | undefined }> = [];
let chatDelayMs = 0;

before(() => {
  mock.module("../scripts/translation-prompt-lab/vllm-client.ts", {
    namedExports: {
      chatCompleteWithRetry: async (messages: unknown[], options: unknown, attempts?: number) => {
        chatCalls.push({ messages, options, attempts });
        if (chatDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, chatDelayMs));
        const next = chatQueue.shift();
        if (next instanceof Error) throw next;
        return next ?? complete("默认译文");
      },
    },
  });
});

beforeEach(() => {
  chatQueue.length = 0;
  chatCalls.length = 0;
  chatDelayMs = 0;
});

function complete(
  text: string,
  finishReason: string | null = "stop",
  completionTokens = 10,
): Completion {
  return {
    text,
    finishReason,
    usage: { promptTokens: 5, completionTokens, totalTokens: 5 + completionTokens },
    durationMs: 7,
  };
}

function corpusArticle(overrides: Record<string, unknown> = {}) {
  const text = "A source paragraph.";
  return {
    sampleId: "provider:article-1",
    providerDb: "provider",
    category: "world",
    profile: "news",
    text,
    paragraphCount: 1,
    charCount: text.length,
    ...overrides,
  };
}

async function withArgv<T>(args: string[], run: () => Promise<T>): Promise<T> {
  const original = process.argv;
  process.argv = [process.execPath, "translation-lab.ts", ...args];
  try {
    return await run();
  } finally {
    process.argv = original;
  }
}

test("translation runner resolves only real variants and computes bounded helpers", async () => {
  const translate = await import("../scripts/translation-prompt-lab/translate");

  assert.equal(translate.paragraphCount("a\n\n b \n\n"), 2);
  assert.equal(translate.outputTokenBudget(1), 768);
  assert.equal(translate.outputTokenBudget(10_000), 4096);
  assert.equal(translate.resolveVariants("all").length, 8);
  assert.equal(translate.resolveVariants("news/v2-specialized,technical").length, 3);
  assert.deepEqual(translate.resolveVariants("unknown").map((variant) => variant.id), []);
  assert.deepEqual(translate.resolveVariants(", ,").map((variant) => variant.id), []);
});

test("translation runner translates every chunk and fails closed on truncation or provider errors", async () => {
  const translate = await import("../scripts/translation-prompt-lab/translate");
  const { recommendedPrompt } = await import("../scripts/translation-prompt-lab/prompts");
  const variant = recommendedPrompt("news");
  const longText = `${"a".repeat(220)}. ${"b".repeat(220)}.`;
  const article = corpusArticle({ text: longText, charCount: longText.length });
  chatQueue.push(complete("第一部分"), complete("第二部分"), complete("第三部分"));

  const success = await translate.translateOne(article as never, variant, 1);
  assert.equal(success.error, null);
  assert.ok(success.chunkCount >= 2);
  assert.equal(chatCalls.length, success.chunkCount);
  assert.match(String((chatCalls[0]!.messages[0] as { content: string }).content), /one part of a longer article/);

  chatQueue.push(complete("partial", "length"));
  const truncated = await translate.translateOne(corpusArticle() as never, variant, 100);
  assert.equal(truncated.error, "translation_run_failed");
  assert.equal(truncated.translation, null);
  assert.equal(truncated.chunkCount, 0);

  chatQueue.push(new Error("provider unavailable"));
  const failed = await translate.translateOne(corpusArticle() as never, variant, 100);
  assert.equal(failed.error, "translation_run_failed");
});

test("translation report preserves job order, profile selection, and controlled progress", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "log", (message: string) => logs.push(message));
  const translate = await import("../scripts/translation-prompt-lab/translate");
  const { allVariants } = await import("../scripts/translation-prompt-lab/prompts");
  const articles = [corpusArticle(), corpusArticle({ sampleId: "provider:article-2", profile: "sports", category: "sports" })];
  chatQueue.push(complete("新闻译文"), complete("体育译文"));

  const report = await translate.runTranslations(
    { generatedAt: "now", mode: "per-category", perCategory: 1, maxChars: 100, articles } as never,
    [allVariants().find((variant) => variant.id === "news/v2-specialized")!, allVariants().find((variant) => variant.id === "sports/v2-specialized")!],
    100,
    2,
  );
  assert.equal(report.runs.length, 2);
  assert.equal(report.concurrency, 2);
  assert.match(logs.join("\n"), /1 chunk/);

  const empty = await translate.runTranslations(
    { generatedAt: "now", mode: "per-category", perCategory: 0, maxChars: 0, articles: [] },
    [],
  );
  assert.deepEqual(empty.runs, []);
});

test("translation CLI covers help, missing corpus, invalid variants, success, and controlled errors", async (t) => {
  const logs: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  t.mock.method(console, "log", (message: string) => logs.push(message));
  t.mock.method(console, "error", (message: string) => errors.push(message));
  t.mock.method(console, "warn", (message: string) => warnings.push(message));
  const translate = await import("../scripts/translation-prompt-lab/translate");
  const dir = mkdtempSync(join(tmpdir(), "readwise-translate-main-"));
  const corpusPath = join(dir, "corpus.json");
  const outPath = join(dir, "nested", "runs.json");
  writeFileSync(corpusPath, JSON.stringify({
    generatedAt: "now",
    mode: "per-category",
    perCategory: 1,
    maxChars: 100,
    articles: [corpusArticle()],
  }));

  assert.equal(translate.parseArgs(["--help", "--unknown"]).help, true);
  assert.equal(warnings.length, 1);
  assert.equal(await withArgv(["--help"], () => translate.main()), 0);
  assert.equal(await withArgv(["--corpus", join(dir, "missing.json")], () => translate.main()), 2);
  assert.equal(await withArgv(["--corpus", corpusPath, "--variants", ","], () => translate.main()), 2);

  chatQueue.push(complete("成功译文"));
  assert.equal(
    await withArgv([
      "--corpus", corpusPath,
      "--variants", "news/v2-specialized",
      "--chunk-input-tokens", "50",
      "--concurrency", "1",
      "--out", outPath,
    ], () => translate.main()),
    0,
  );
  assert.equal(existsSync(outPath), true);
  assert.equal((JSON.parse(readFileSync(outPath, "utf8")) as { runs: unknown[] }).runs.length, 1);

  chatQueue.push(new Error("offline"));
  assert.equal(
    await withArgv(["--corpus", corpusPath, "--variants", "news/v2-specialized", "--out", outPath], () => translate.main()),
    1,
  );
  assert.match(logs.join("\n"), /1 error\(s\)/);
  assert.ok(errors.length >= 2);
});

test("evaluation heuristics and judge parser cover bounds and malformed output", async () => {
  const evaluate = await import("../scripts/translation-prompt-lab/evaluate");
  const source = corpusArticle();
  const run = {
    sampleId: source.sampleId,
    providerDb: source.providerDb,
    category: source.category,
    variantId: "news/v2-specialized",
    sourceParagraphCount: 1,
    sourceCharCount: source.charCount,
    chunkCount: 1,
    translation: "```中文```",
    outputParagraphCount: 2,
    outputCharCount: source.charCount * 2,
    error: null,
    durationMs: 1,
  };
  const heuristics = evaluate.computeHeuristics(source as never, run);
  assert.equal(heuristics.nonEmpty, true);
  assert.equal(heuristics.noFences, false);
  assert.equal(heuristics.paragraphMatch, false);
  assert.equal(heuristics.lengthRatioOk, false);

  const empty = evaluate.computeHeuristics(
    { ...source, charCount: 0 } as never,
    { ...run, translation: null, outputCharCount: 0, outputParagraphCount: 1 },
  );
  assert.equal(empty.cjkRatio, 0);
  assert.equal(empty.lengthRatio, 0);

  assert.deepEqual(evaluate.parseJudgeJson('prefix {"adequacy":9,"fluency":"2.4","terminology":"bad","register":0,"issues":[1,2,3,4]} suffix'), {
    adequacy: 5,
    fluency: 2,
    terminology: 0,
    register: 1,
    issues: ["1", "2", "3"],
  });
  assert.throws(() => evaluate.parseJudgeJson("no object"), /no JSON object/);
  assert.match(evaluate.buildJudgeUser(source as never, "译文"), /Chinese translation:\n译文/);

  chatQueue.push(complete('{"adequacy":5,"fluency":4,"terminology":3,"register":2,"issues":[]}'));
  assert.equal((await evaluate.judgeOne(source as never, "译文")).adequacy, 5);
});

test("evaluation run handles missing samples, judge failures, and absent translations", async (t) => {
  const logs: string[] = [];
  const warnings: string[] = [];
  t.mock.method(console, "log", (message: string) => logs.push(message));
  t.mock.method(console, "warn", (message: string) => warnings.push(message));
  const evaluate = await import("../scripts/translation-prompt-lab/evaluate");
  const source = corpusArticle();
  const baseRun = {
    sampleId: source.sampleId,
    providerDb: source.providerDb,
    category: source.category,
    variantId: "news/v2-specialized",
    sourceParagraphCount: 1,
    sourceCharCount: source.charCount,
    chunkCount: 1,
    translation: "中文译文",
    outputParagraphCount: 1,
    outputCharCount: 4,
    error: null,
    durationMs: 1,
  };
  chatQueue.push(
    complete('{"adequacy":5,"fluency":4,"terminology":3,"register":2,"issues":[]}'),
    new Error("judge offline"),
  );
  const evaluated = await evaluate.evaluateRuns(
    { generatedAt: "now", mode: "per-category", perCategory: 1, maxChars: 100, articles: [source] } as never,
    { generatedAt: "now", model: "model", chunkInputTokens: 100, concurrency: 1, runs: [
      { ...baseRun, sampleId: "missing" },
      baseRun,
      { ...baseRun, variantId: "news/v1-baseline" },
      { ...baseRun, variantId: "news/no-output", translation: null },
    ] },
  );
  assert.equal(evaluated.length, 3);
  assert.equal(evaluated[0]!.judge?.adequacy, 5);
  assert.equal(evaluated[1]!.judgeError, "translation_judge_failed");
  assert.match(evaluated[2]!.judgeError!, /no translation/);
  assert.equal(warnings.length, 1);
  assert.match(logs.join("\n"), /judged/);

  const summaries = evaluate.summarizeByVariant(evaluated);
  assert.deepEqual(summaries.map((summary) => summary.variantId), [
    "news/no-output",
    "news/v1-baseline",
    "news/v2-specialized",
  ]);
  assert.equal(summaries[0]!.meanOverall, 0);
  assert.equal(summaries[2]!.meanOverall, 3.5);
  evaluate.printSummaryTable(summaries);
  assert.match(logs.join("\n"), /overall/);
});

test("evaluation CLI covers help, missing inputs, and output writing", async (t) => {
  const logs: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  t.mock.method(console, "log", (message: string) => logs.push(message));
  t.mock.method(console, "error", (message: string) => errors.push(message));
  t.mock.method(console, "warn", (message: string) => warnings.push(message));
  const evaluate = await import("../scripts/translation-prompt-lab/evaluate");
  const dir = mkdtempSync(join(tmpdir(), "readwise-evaluate-main-"));
  const corpusPath = join(dir, "corpus.json");
  const translationsPath = join(dir, "translations.json");
  const detailPath = join(dir, "nested", "detail.json");
  const summaryPath = join(dir, "nested", "summary.json");
  const source = corpusArticle();
  writeFileSync(corpusPath, JSON.stringify({ generatedAt: "now", mode: "per-category", perCategory: 1, maxChars: 100, articles: [source] }));
  writeFileSync(translationsPath, JSON.stringify({ generatedAt: "now", model: "model", chunkInputTokens: 100, concurrency: 1, runs: [{
    sampleId: source.sampleId,
    providerDb: source.providerDb,
    category: source.category,
    variantId: "news/v2-specialized",
    sourceParagraphCount: 1,
    sourceCharCount: source.charCount,
    chunkCount: 1,
    translation: "中文译文",
    outputParagraphCount: 1,
    outputCharCount: 4,
    error: null,
    durationMs: 1,
  }] }));

  assert.equal(evaluate.parseArgs(["--help", "--unknown"]).help, true);
  assert.equal(warnings.length, 1);
  assert.equal(await withArgv(["--help"], () => evaluate.main()), 0);
  assert.equal(await withArgv(["--corpus", "missing", "--translations", "also-missing"], () => evaluate.main()), 2);

  chatQueue.push(complete('{"adequacy":5,"fluency":5,"terminology":5,"register":5,"issues":[]}'));
  assert.equal(await withArgv([
    "--corpus", corpusPath,
    "--translations", translationsPath,
    "--detail-out", detailPath,
    "--summary-out", summaryPath,
  ], () => evaluate.main()), 0);
  assert.equal(existsSync(detailPath), true);
  assert.equal(existsSync(summaryPath), true);
  assert.match(logs.join("\n"), /Wrote aggregate summary/);
  assert.equal(errors.length, 1);
});

test("benchmark helpers cover corpus fallback, errors, percentiles, and report notes", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "log", (message: string) => logs.push(message));
  const bench = await import("../scripts/translation-prompt-lab/bench-concurrency");
  assert.equal(bench.percentile([], 0.5), 0);
  assert.equal(bench.percentile([1, 2, 3], 0.9), 3);
  assert.equal(bench.loadBenchInput("missing").source, "synthetic");

  const dir = mkdtempSync(join(tmpdir(), "readwise-bench-"));
  const corpusPath = join(dir, "corpus.json");
  writeFileSync(corpusPath, JSON.stringify({ articles: [corpusArticle({ text: "x".repeat(7000) })] }));
  const input = bench.loadBenchInput(corpusPath);
  assert.equal(input.source, "corpus");
  assert.equal(input.text.length, 6000);

  chatDelayMs = 2;
  chatQueue.push(complete("ok", "stop", 20), new Error("overloaded"));
  const level = await bench.runLevel(2, 2, input, 50);
  assert.equal(level.requests, 2);
  assert.equal(level.errors, 1);
  assert.equal(level.totalCompletionTokens, 20);
  assert.equal(level.latencyMsP50, 7);

  chatQueue.push(complete("ok", "stop", 10), new Error("overloaded"));
  const report = await bench.runBenchmark([1, 2], 1, null, 25);
  assert.equal(report.levels.length, 2);
  assert.equal(report.bestByThroughput, 1);
  assert.ok(report.notes.some((note) => /had errors/.test(note)));
  assert.match(logs.join("\n"), /Benchmarking concurrency=1/);

  const empty = await bench.runBenchmark([], 1, null);
  assert.equal(empty.bestByThroughput, null);
});

test("benchmark CLI covers parsing, help, invalid levels, report output, and no-clean recommendation", async (t) => {
  const logs: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  t.mock.method(console, "log", (message: string) => logs.push(message));
  t.mock.method(console, "error", (message: string) => errors.push(message));
  t.mock.method(console, "warn", (message: string) => warnings.push(message));
  const bench = await import("../scripts/translation-prompt-lab/bench-concurrency");
  const dir = mkdtempSync(join(tmpdir(), "readwise-bench-main-"));
  const outPath = join(dir, "nested", "report.json");

  const parsed = bench.parseArgs(["--levels", "1,bad,-2,4", "--requests-per-level", "2", "--unknown"]);
  assert.deepEqual(parsed.levels, [1, 4]);
  assert.equal(warnings.length, 1);
  assert.equal(await withArgv(["--help"], () => bench.main()), 0);
  assert.equal(await withArgv(["--levels", "bad"], () => bench.main()), 2);

  chatQueue.push(complete("ok", "stop", 10));
  assert.equal(await withArgv([
    "--levels", "1",
    "--requests-per-level", "1",
    "--max-tokens", "25",
    "--out", outPath,
  ], () => bench.main()), 0);
  assert.equal(existsSync(outPath), true);
  assert.match(logs.join("\n"), /Recommended --concurrency: 1/);
  assert.equal(errors.length, 1);
});
