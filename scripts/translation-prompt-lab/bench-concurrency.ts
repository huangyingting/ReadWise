/**
 * Benchmarks the local vLLM server at several concurrency levels to find the
 * best `--concurrency` value for `translate.ts`. Fires a fixed number of
 * chunk-sized translation requests per level (using a real recommended
 * prompt + a real sampled chunk of article text when a corpus is given, or
 * synthetic filler text otherwise — never printed), and reports aggregate
 * throughput (completion tokens/sec, requests/sec), latency percentiles, and
 * error counts per level.
 *
 * A single vLLM instance serving one model on one GPU uses continuous
 * batching: throughput generally rises with concurrency up to a
 * GPU/scheduler-bound ceiling, after which added concurrency only adds queue
 * latency without raising throughput (or starts producing timeouts/errors).
 * This script finds that ceiling empirically rather than guessing.
 *
 * Usage:
 *   npm run node-ts -- scripts/translation-prompt-lab/bench-concurrency.ts \
 *     --levels 1,4,8,16,32 --requests-per-level 24 \
 *     [--corpus .translation-lab/corpus.json] \
 *     [--out .translation-lab/bench-concurrency.json]
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mapWithConcurrency } from "./concurrency";
import { recommendedPromptForCategory } from "./prompts";
import type { Corpus } from "./sample";
import { chatCompleteWithRetry } from "./vllm-client";
import { isMain, parseString, parsePositiveInt, runScript, warnUnknown } from "../lib/cli";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DEFAULT_OUT = `${REPO_ROOT}/.translation-lab/bench-concurrency.json`;
const DEFAULT_LEVELS = [1, 4, 8, 16, 32];
const DEFAULT_REQUESTS_PER_LEVEL = 24;
const DEFAULT_MAX_TOKENS = 1024;

/**
 * ~1500-token-ish synthetic English filler used when no `--corpus` is given.
 * Deliberately generic/non-copyrightable text so the benchmark never needs
 * real article content — the point is to measure server throughput under
 * load, not translation quality (that's `evaluate.ts`'s job).
 */
const SYNTHETIC_PARAGRAPH =
  "The committee reviewed quarterly figures and noted steady improvement across " +
  "every region, attributing the gains to better logistics, clearer reporting, " +
  "and closer coordination between local teams and the central office. ";
const SYNTHETIC_CHUNK = SYNTHETIC_PARAGRAPH.repeat(40); // ~6000 chars ≈ 1500 tokens

export type LevelResult = {
  concurrency: number;
  requests: number;
  errors: number;
  totalDurationMs: number;
  totalCompletionTokens: number;
  tokensPerSec: number;
  requestsPerSec: number;
  latencyMsP50: number;
  latencyMsP90: number;
  latencyMsMax: number;
};

export type BenchReport = {
  generatedAt: string;
  model: string;
  maxTokens: number;
  requestsPerLevel: number;
  inputSource: "corpus" | "synthetic";
  levels: LevelResult[];
  bestByThroughput: number | null;
  notes: string[];
};

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

export function loadBenchInput(corpusPath: string | null): { text: string; systemPrompt: string; source: "corpus" | "synthetic" } {
  if (corpusPath && existsSync(corpusPath)) {
    const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as Corpus;
    const article = corpus.articles[0];
    if (article) {
      // Use a representative ~1500-token slice, matching translate.ts's
      // default per-chunk input budget, so the benchmark models real load.
      const maxChars = 1500 * 4;
      return {
        text: article.text.slice(0, maxChars),
        systemPrompt: recommendedPromptForCategory(article.category).systemPrompt,
        source: "corpus",
      };
    }
  }
  return {
    text: SYNTHETIC_CHUNK,
    systemPrompt: recommendedPromptForCategory("world").systemPrompt,
    source: "synthetic",
  };
}

export async function runLevel(
  level: number,
  requestCount: number,
  input: { text: string; systemPrompt: string },
  maxTokens: number,
): Promise<LevelResult> {
  const latencies: number[] = [];
  let errors = 0;
  let totalCompletionTokens = 0;
  const started = Date.now();
  await mapWithConcurrency(
    Array.from({ length: requestCount }, (_, i) => i),
    level,
    async () => {
      try {
        const result = await chatCompleteWithRetry(
          [
            { role: "system", content: input.systemPrompt },
            { role: "user", content: input.text },
          ],
          { maxTokens, temperature: 0.3 },
          2,
        );
        latencies.push(result.durationMs);
        totalCompletionTokens += result.usage?.completionTokens ?? 0;
      } catch {
        errors++;
      }
    },
  );
  const totalDurationMs = Date.now() - started;
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    concurrency: level,
    requests: requestCount,
    errors,
    totalDurationMs,
    totalCompletionTokens,
    tokensPerSec: totalCompletionTokens / (totalDurationMs / 1000),
    requestsPerSec: (requestCount - errors) / (totalDurationMs / 1000),
    latencyMsP50: percentile(sorted, 0.5),
    latencyMsP90: percentile(sorted, 0.9),
    latencyMsMax: sorted.length ? sorted[sorted.length - 1]! : 0,
  };
}

export async function runBenchmark(
  levels: number[],
  requestsPerLevel: number,
  corpusPath: string | null,
  maxTokens: number = DEFAULT_MAX_TOKENS,
): Promise<BenchReport> {
  const input = loadBenchInput(corpusPath);
  const results: LevelResult[] = [];
  for (const level of levels) {
    console.log(`Benchmarking concurrency=${level} (${requestsPerLevel} requests)...`);
    const result = await runLevel(level, requestsPerLevel, input, maxTokens);
    results.push(result);
    console.log(
      `  concurrency=${level}: ${result.tokensPerSec.toFixed(1)} tok/s, ` +
        `${result.requestsPerSec.toFixed(2)} req/s, p50=${result.latencyMsP50}ms, ` +
        `p90=${result.latencyMsP90}ms, errors=${result.errors}/${result.requests}`,
    );
  }
  const clean = results.filter((r) => r.errors === 0);
  const best = clean.length > 0 ? clean.reduce((a, b) => (b.tokensPerSec > a.tokensPerSec ? b : a)) : null;
  const notes: string[] = [];
  if (clean.length < results.length) {
    notes.push(
      `${results.length - clean.length} level(s) had errors — treat their throughput numbers as unreliable ` +
        `(likely timeouts/queue saturation past the server's real concurrency ceiling).`,
    );
  }
  const withDiminishing = results.find(
    (r, i) => i > 0 && r.errors === 0 && r.tokensPerSec < results[i - 1]!.tokensPerSec * 1.05,
  );
  if (withDiminishing) {
    notes.push(
      `Throughput gains flatten at or before concurrency=${withDiminishing.concurrency} ` +
        `(< 5% improvement over the previous level) — further concurrency mainly adds latency, not throughput.`,
    );
  }
  return {
    generatedAt: new Date().toISOString(),
    model: process.env.VLLM_MODEL ?? "Qwen/Qwen3.6-27B",
    maxTokens,
    requestsPerLevel,
    inputSource: input.source,
    levels: results,
    bestByThroughput: best?.concurrency ?? null,
    notes,
  };
}

export type BenchArgs = {
  levels: number[];
  requestsPerLevel: number;
  corpus: string | null;
  maxTokens: number;
  out: string;
  help: boolean;
};

export function parseArgs(argv: string[]): BenchArgs {
  const levelsRaw = parseString(argv, "--levels");
  const args: BenchArgs = {
    levels: levelsRaw
      ? levelsRaw
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n > 0)
      : DEFAULT_LEVELS,
    requestsPerLevel: parsePositiveInt(argv, "--requests-per-level", DEFAULT_REQUESTS_PER_LEVEL),
    corpus: parseString(argv, "--corpus"),
    maxTokens: parsePositiveInt(argv, "--max-tokens", DEFAULT_MAX_TOKENS),
    out: parseString(argv, "--out") ?? DEFAULT_OUT,
    help: argv.includes("--help") || argv.includes("-h"),
  };
  const known = new Set([
    "--levels",
    "--requests-per-level",
    "--corpus",
    "--max-tokens",
    "--out",
    "--help",
    "-h",
  ]);
  for (let i = 0; i < argv.length; i++) {
    if (known.has(argv[i])) {
      if (argv[i] !== "--help" && argv[i] !== "-h") i++;
      continue;
    }
    warnUnknown(argv[i]);
  }
  return args;
}

export async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: bench-concurrency.ts [--levels 1,4,8,16,32] [--requests-per-level N] " +
        "[--corpus path] [--max-tokens N] [--out path]",
    );
    return 0;
  }
  if (args.levels.length === 0) {
    console.error("No valid concurrency levels parsed from --levels.");
    return 2;
  }
  const report = await runBenchmark(args.levels, args.requestsPerLevel, args.corpus, args.maxTokens);
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(report, null, 2));
  console.log("\n=== Summary ===");
  console.log(
    "concurrency".padEnd(12) +
      "tok/s".padEnd(10) +
      "req/s".padEnd(9) +
      "p50ms".padEnd(9) +
      "p90ms".padEnd(9) +
      "errors",
  );
  for (const r of report.levels) {
    console.log(
      String(r.concurrency).padEnd(12) +
        r.tokensPerSec.toFixed(1).padEnd(10) +
        r.requestsPerSec.toFixed(2).padEnd(9) +
        String(r.latencyMsP50).padEnd(9) +
        String(r.latencyMsP90).padEnd(9) +
        `${r.errors}/${r.requests}`,
    );
  }
  for (const note of report.notes) console.log(`Note: ${note}`);
  console.log(
    report.bestByThroughput !== null
      ? `Recommended --concurrency: ${report.bestByThroughput} (highest error-free throughput)`
      : "No error-free level found — try lower concurrency levels.",
  );
  console.log(`Wrote full report to ${args.out}`);
  return 0;
}

export function runAsCli(importMetaUrl = import.meta.url): void {
  if (isMain(importMetaUrl)) {
    runScript(main, "bench-concurrency failed");
  }
}

runAsCli();
