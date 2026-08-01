/**
 * Runs prompt variants against a sampled corpus via the local vLLM server.
 *
 * Privacy/content note: reads/writes article text and model output to the
 * gitignored `.translation-lab/` scratch directory. Console output is
 * aggregate-only (counts, timings, errors) — never article text or
 * translations.
 *
 * Usage:
 *   npm run node-ts -- scripts/translation-prompt-lab/translate.ts \
 *     --corpus .translation-lab/corpus.json \
 *     --variants all \
 *     --out .translation-lab/translations.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chunkArticleText } from "./chunk";
import { mapWithConcurrency } from "./concurrency";
import { allVariants, variantById, variantsForProfile, type PromptVariant } from "./prompts";
import { ALL_PROFILES, type TranslationProfile } from "./categories";
import type { Corpus, SampledArticle } from "./sample";
import { chatCompleteWithRetry } from "./vllm-client";
import { isMain, parseString, parsePositiveInt, runScript, warnUnknown } from "../lib/cli";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DEFAULT_CORPUS = `${REPO_ROOT}/.translation-lab/corpus.json`;
const DEFAULT_OUT = `${REPO_ROOT}/.translation-lab/translations.json`;

/**
 * Default number of (article, variant) jobs translated concurrently. vLLM's
 * continuous batching means concurrent requests generally raise aggregate
 * throughput up to some server/GPU-bound ceiling — see
 * `bench-concurrency.ts` for empirically finding the best value for a given
 * server/model rather than guessing.
 *
 * Measured on this deployment (Qwen/Qwen3.6-27B-FP8, single A100 80GB,
 * localhost:8000) via `translation-lab:bench-concurrency`: throughput scaled
 * cleanly from 176 tok/s @4 → 224 @8 → 450 @16 → 681 @32 tok/s with zero
 * errors at every level, then flattened at 64 (661 tok/s, ~same as 32) while
 * p50 latency nearly doubled (7.4s → 11.2s) — i.e. 32 is the throughput
 * ceiling for this server; going higher only adds queueing latency. 4 is
 * kept as the conservative *default* here (safe for ad hoc lab runs against
 * whatever model/GPU happens to be deployed), but batch/production runs on
 * this specific deployment should pass `--concurrency 32`.
 */
const DEFAULT_CONCURRENCY = 4;

/**
 * Input-token budget per chunk. Mirrors the production translation feature's
 * budget (`FEATURE_CONTEXT.translation.maxInputTokens` in
 * `src/lib/ai/chunking.ts`) rather than the model's much larger 262144-token
 * context window: chunking here is about bounding OUTPUT reliability per
 * call, not working around input context limits (see `chunk.ts`).
 */
const DEFAULT_CHUNK_INPUT_TOKENS = 1500;

const PART_TRANSLATION_NOTE =
  " You are translating one part of a longer article that has been split " +
  "into sequential parts. Translate this part faithfully on its own: do not " +
  "add an introduction, conclusion, summary, or any reference to other " +
  "parts.";

export type TranslationRun = {
  sampleId: string;
  providerDb: string;
  category: string;
  variantId: string;
  sourceParagraphCount: number;
  sourceCharCount: number;
  chunkCount: number;
  translation: string | null;
  outputParagraphCount: number;
  outputCharCount: number;
  error: string | null;
  durationMs: number;
};

export type RunReport = {
  generatedAt: string;
  model: string;
  chunkInputTokens: number;
  concurrency: number;
  runs: TranslationRun[];
};

export function paragraphCount(text: string): number {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean).length;
}

/**
 * Output-token budget for one chunk. Sized off the INPUT chunk length with
 * generous headroom rather than trusting the char-count length ratio we
 * measured for whole articles (~0.3, i.e. Chinese output has fewer raw
 * characters than the English source) — that ratio is about characters, not
 * tokens, and the Qwen tokenizer spends roughly one token per 1-2 CJK
 * characters, not the ~4 chars/token heuristic used for the English input
 * estimate. Under-budgeting here is what causes truncated
 * (`finish_reason: "length"`) output.
 */
export function outputTokenBudget(chunkCharCount: number): number {
  return Math.min(4096, Math.max(768, chunkCharCount + 256));
}

export async function translateOne(
  article: SampledArticle,
  variant: PromptVariant,
  chunkInputTokens: number,
): Promise<TranslationRun> {
  const started = Date.now();
  const base: Pick<TranslationRun, "sampleId" | "providerDb" | "category" | "variantId" | "sourceParagraphCount" | "sourceCharCount"> = {
    sampleId: article.sampleId,
    providerDb: article.providerDb,
    category: article.category,
    variantId: variant.id,
    sourceParagraphCount: article.paragraphCount,
    sourceCharCount: article.charCount,
  };
  try {
    const chunks = chunkArticleText(article.text, chunkInputTokens);
    const isPart = chunks.length > 1;
    const system = isPart ? variant.systemPrompt + PART_TRANSLATION_NOTE : variant.systemPrompt;
    const parts: string[] = [];
    for (const chunk of chunks) {
      const result = await chatCompleteWithRetry(
        [
          { role: "system", content: system },
          { role: "user", content: chunk.text },
        ],
        { maxTokens: outputTokenBudget(chunk.charCount) },
      );
      // Any chunk failing/truncating → the whole run fails; never stitch a
      // partial translation (mirrors the production `translateChunks`
      // never-cache-a-partial-translation rule in src/lib/translation.ts).
      if (result.finishReason === "length") {
        throw new Error(
          `chunk ${chunk.index + 1}/${chunk.total} hit the output token cap ` +
            `(finish_reason: length) — increase outputTokenBudget or shrink chunkInputTokens`,
        );
      }
      parts.push(result.text.trim());
    }
    const translation = parts.join("\n\n");
    return {
      ...base,
      chunkCount: chunks.length,
      translation,
      outputParagraphCount: paragraphCount(translation),
      outputCharCount: translation.length,
      error: null,
      durationMs: Date.now() - started,
    };
  } catch {
    return {
      ...base,
      chunkCount: 0,
      translation: null,
      outputParagraphCount: 0,
      outputCharCount: 0,
      error: "translation_run_failed",
      durationMs: Date.now() - started,
    };
  }
}

export function resolveVariants(spec: string): PromptVariant[] {
  if (spec === "all") return allVariants();
  const ids = spec.split(",").map((s) => s.trim()).filter(Boolean);
  const resolved: PromptVariant[] = [];
  for (const id of ids) {
    const byId = variantById(id);
    if (byId) {
      resolved.push(byId);
      continue;
    }
    // Allow known bare profile names ("news") to mean all variants for that
    // profile. Unknown values must not manufacture an invalid prompt whose
    // systemPrompt is undefined.
    if (ALL_PROFILES.includes(id as TranslationProfile)) {
      resolved.push(...variantsForProfile(id as TranslationProfile));
    }
  }
  return resolved;
}

export async function runTranslations(
  corpus: Corpus,
  variants: PromptVariant[],
  chunkInputTokens: number = DEFAULT_CHUNK_INPUT_TOKENS,
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<RunReport> {
  const variantsByProfile = new Map<string, PromptVariant[]>();
  for (const v of variants) {
    variantsByProfile.set(v.profile, [...(variantsByProfile.get(v.profile) ?? []), v]);
  }
  const jobs: Array<{ article: SampledArticle; variant: PromptVariant }> = [];
  for (const article of corpus.articles) {
    const applicable = variantsByProfile.get(article.profile) ?? [];
    for (const variant of applicable) jobs.push({ article, variant });
  }
  let done = 0;
  const total = jobs.length;
  const runs = await mapWithConcurrency(
    jobs,
    concurrency,
    ({ article, variant }) => translateOne(article, variant, chunkInputTokens),
    (run, { article, variant }) => {
      done++;
      const status = run.error
        ? `ERROR: ${run.error}`
        : `${run.durationMs}ms (${run.chunkCount} chunk${run.chunkCount === 1 ? "" : "s"})`;
      console.log(`[${done}/${total}] ${article.providerDb}/${article.category} × ${variant.id} — ${status}`);
    },
  );
  return {
    generatedAt: new Date().toISOString(),
    model: process.env.VLLM_MODEL ?? "Qwen/Qwen3.6-27B",
    chunkInputTokens,
    concurrency,
    runs,
  };
}

export type TranslateArgs = {
  corpus: string;
  variants: string;
  out: string;
  chunkInputTokens: number;
  concurrency: number;
  help: boolean;
};

export function parseArgs(argv: string[]): TranslateArgs {
  const args: TranslateArgs = {
    corpus: parseString(argv, "--corpus") ?? DEFAULT_CORPUS,
    variants: parseString(argv, "--variants") ?? "all",
    out: parseString(argv, "--out") ?? DEFAULT_OUT,
    chunkInputTokens: parsePositiveInt(argv, "--chunk-input-tokens", DEFAULT_CHUNK_INPUT_TOKENS),
    concurrency: parsePositiveInt(argv, "--concurrency", DEFAULT_CONCURRENCY),
    help: argv.includes("--help") || argv.includes("-h"),
  };
  const known = new Set([
    "--corpus",
    "--variants",
    "--out",
    "--chunk-input-tokens",
    "--concurrency",
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
      "Usage: translate.ts [--corpus path] [--variants all|<id,id,...>|<profile>] [--out path] " +
        "[--chunk-input-tokens N] [--concurrency N]",
    );
    return 0;
  }
  if (!existsSync(args.corpus)) {
    console.error(`Corpus not found at ${args.corpus}. Run sample.ts first.`);
    return 2;
  }
  const corpus = JSON.parse(readFileSync(args.corpus, "utf8")) as Corpus;
  const variants = resolveVariants(args.variants);
  if (variants.length === 0) {
    console.error(`No prompt variants matched "${args.variants}".`);
    return 2;
  }
  const report = await runTranslations(corpus, variants, args.chunkInputTokens, args.concurrency);
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(report, null, 2));
  const errorCount = report.runs.filter((r) => r.error).length;
  console.log(`Wrote ${report.runs.length} run(s) (${errorCount} error(s)) to ${args.out}`);
  return errorCount > 0 ? 1 : 0;
}

export function runAsCli(importMetaUrl = import.meta.url): void {
  if (isMain(importMetaUrl)) {
    runScript(main, "translate failed");
  }
}

runAsCli();
