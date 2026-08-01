/**
 * Production batch translator for provider-db articles → Simplified Chinese.
 *
 * Reads articles from ONE provider db (read-only — see `db.ts`), translates
 * title + body using the lab's recommended, category-specialized prompt
 * (`prompts.ts`), and writes results incrementally to a separate output
 * SQLite database (`store.ts`) so the source db is never mutated and a
 * crashed/interrupted run can simply be re-invoked (idempotent via a content
 * hash — unchanged articles are skipped unless `--force`).
 *
 * Long articles are translated in multiple HTML-block-aligned batches (see
 * `html-blocks.ts`) so no article is skipped or truncated for exceeding a
 * single request's practical output budget, and the result is guaranteed to
 * have the same paragraph count/order as `splitHtmlParagraphs` — i.e. it's a
 * drop-in value for `Translation.content` / `alignParagraphs`.
 *
 * Privacy: only aggregate counts, article ids, categories, and timings are
 * logged — never article titles or body text (matches the convention in
 * `scripts/difficulty-eval.ts` / `sample.ts`).
 *
 * Usage:
 *   npm run node-ts -- scripts/translation-prompt-lab/translate-articles.ts \
 *     --db workinprogress [--lang zh-CN] [--limit N] [--category tech,science] \
 *     [--concurrency 32] [--force] [--dry-run] [--out-dir prisma/provider-db-translations]
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openReadOnly } from "./db";
import { translateArticleBlocks } from "./html-blocks";
import { splitTranslationParagraphs } from "@/lib/bilingual";
import { mapWithConcurrency } from "./concurrency";
import { recommendedPromptForCategory } from "./prompts";
import { getExistingHash, openTranslationStore, recordError, upsertTranslation } from "./store";
import { chatCompleteWithRetry } from "./vllm-client";
import { isMain, parseFlag, parsePositiveInt, parseString, runScript, warnUnknown } from "../lib/cli";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const PROVIDER_DB_DIR = join(REPO_ROOT, "prisma", "provider-dbs");
const DEFAULT_OUT_DIR = join(REPO_ROOT, "prisma", "provider-db-translations");
const DEFAULT_LANG = "zh-CN";

/**
 * Production temperature. Lower than the lab's default (0.3) — a batch
 * translation job should be reproducible and factually conservative, not
 * creative; the lab used a higher temperature to intentionally surface
 * variance during prompt evaluation, which is the wrong choice once a
 * prompt has actually been selected for production use.
 */
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_CONCURRENCY = 32; // see docs/ai/provider-db-translation-prompts.md concurrency benchmark

type ArticleRow = { id: string; title: string; content: string; category: string | null };

export function contentHash(title: string, content: string): string {
  return createHash("sha256").update(title).update("\u0000").update(content).digest("hex");
}

export async function translateTitle(title: string, systemPrompt: string, temperature: number): Promise<string> {
  if (!title.trim()) return "";
  const result = await chatCompleteWithRetry(
    [
      {
        role: "system",
        content:
          "Translate ONLY this article title into Simplified Chinese (zh-CN), using the same " +
          "terminology/register conventions below. Output just the translated title — no quotes, " +
          "no commentary, no markdown. " +
          systemPrompt,
      },
      { role: "user", content: title },
    ],
    { temperature, maxTokens: 256 },
  );
  return result.text.trim();
}

/** Heuristic QA gate — mirrors evaluate.ts's checks, flags rather than blocks. */
export function qaFlags(content: string, sourceCharCount: number, sourceBlockCount: number): string[] {
  const flags: string[] = [];
  if (!content.trim()) flags.push("empty-output");
  if (/```/.test(content)) flags.push("markdown-fence");
  // Non-whitespace-based ratio (matches evaluate.ts's formula) with a lower
  // threshold than the lab's 0.7 — production articles legitimately include
  // preserved Greek/Latin scientific terms, formulas, and numerals per the
  // untranslatable-content rule, which pulls the ratio down for dense
  // technical articles without indicating any real quality problem
  // (observed directly: a correctly-translated lab-grown-diamonds article
  // scored 0.42 purely from correctly preserved chemical/scientific
  // notation). 0.3 still reliably catches a genuinely wrong all-English or
  // untranslated response.
  const nonWhitespace = content.replace(/\s+/g, "");
  const cjk = nonWhitespace.length ? (nonWhitespace.match(/[\u4e00-\u9fff]/g)?.length ?? 0) / nonWhitespace.length : 0;
  if (cjk < 0.3) flags.push("low-cjk-ratio");
  const ratio = sourceCharCount > 0 ? content.length / sourceCharCount : 0;
  if (ratio > 0 && (ratio < 0.1 || ratio > 1.2)) flags.push("length-ratio-out-of-range");
  // Defense-in-depth: translateArticleBlocks() guarantees this by construction
  // (see html-blocks.ts's EMPTY_BLOCK_PLACEHOLDER), but a mismatch here would
  // mean alignParagraphs()/BilingualBody positionally mispairs paragraphs —
  // must never be silently trusted if it ever happens.
  if (splitTranslationParagraphs(content).length !== sourceBlockCount) flags.push("block-count-mismatch");
  return flags;
}

export type RunOptions = {
  providerDb: string;
  lang: string;
  limit: number | null;
  categories: string[] | null;
  articleIds: string[] | null;
  concurrency: number;
  force: boolean;
  dryRun: boolean;
  outDir: string;
};

export type RunStats = {
  total: number;
  translated: number;
  skippedUnchanged: number;
  errors: number;
  flagged: number;
  repairedChunks: number;
};

export async function runTranslateArticles(options: RunOptions): Promise<RunStats> {
  const dbPath = join(PROVIDER_DB_DIR, `${options.providerDb}.db`);
  if (!existsSync(dbPath)) {
    throw new Error(`Provider db not found: ${dbPath}`);
  }
  const source = openReadOnly(dbPath);
  const outPath = join(options.outDir, `${options.providerDb}.${options.lang}.sqlite`);
  const store = options.dryRun ? null : openTranslationStore(outPath);

  try {
    const categoryFilter =
      options.categories && options.categories.length > 0
        ? `AND category IN (${options.categories.map(() => "?").join(",")})`
        : "";
    const idFilter =
      options.articleIds && options.articleIds.length > 0
        ? `AND id IN (${options.articleIds.map(() => "?").join(",")})`
        : "";
    const sql = `SELECT id, title, content, category FROM Article WHERE content IS NOT NULL ${categoryFilter} ${idFilter} ORDER BY id`;
    const rows = source
      .prepare(sql)
      .all(...(options.categories ?? []), ...(options.articleIds ?? [])) as ArticleRow[];
    const limited = options.limit ? rows.slice(0, options.limit) : rows;

    const stats: RunStats = { total: limited.length, translated: 0, skippedUnchanged: 0, errors: 0, flagged: 0, repairedChunks: 0 };
    let done = 0;
    const reportProgress = () => {
      done++;
      if (done % 25 === 0 || done === limited.length) {
        console.log(
          `[${done}/${limited.length}] translated=${stats.translated} skipped=${stats.skippedUnchanged} ` +
            `errors=${stats.errors} flagged=${stats.flagged} repairedChunks=${stats.repairedChunks}`,
        );
      }
    };

    await mapWithConcurrency(
      limited,
      options.concurrency,
      async (row) => {
        const hash = contentHash(row.title, row.content);
        if (!options.force && store) {
          const existing = getExistingHash(store, options.providerDb, row.id, options.lang);
          if (existing === hash) {
            stats.skippedUnchanged++;
            reportProgress();
            return;
          }
        }
        if (options.dryRun) {
          stats.translated++;
          reportProgress();
          return;
        }
        const started = Date.now();
        const prompt = recommendedPromptForCategory(row.category);
        // Under sustained high concurrency the local vLLM server occasionally
        // times out or transiently truncates a response for a specific
        // article (confirmed directly: an article that failed at
        // concurrency 32 succeeded immediately, unchanged, at concurrency 1
        // — i.e. GPU-load contention, not a genuine content/prompt problem).
        // Retrying the whole article a bounded number of times, with a short
        // backoff, resolves this class of failure automatically instead of
        // requiring a manual `--article-id --force` re-run after every batch.
        const maxArticleAttempts = 2;
        let lastErr: unknown;
        for (let attempt = 1; attempt <= maxArticleAttempts; attempt++) {
          try {
            const [titleTranslated, bodyResult] = await Promise.all([
              translateTitle(row.title, prompt.systemPrompt, DEFAULT_TEMPERATURE),
              translateArticleBlocks(row.content, prompt.systemPrompt, {
                temperature: DEFAULT_TEMPERATURE,
              }),
            ]);
            const flags = qaFlags(bodyResult.content, row.content.length, bodyResult.sourceBlockCount);
            if (bodyResult.suspiciousBlockCount > 0) flags.push("suspicious-untranslated-block");
            if (flags.length > 0) stats.flagged++;
            if (bodyResult.repairedChunkCount > 0) stats.repairedChunks += bodyResult.repairedChunkCount;
            upsertTranslation(store!, {
              providerDb: options.providerDb,
              articleId: row.id,
              targetLang: options.lang,
              titleTranslated,
              contentTranslated: bodyResult.content,
              sourceBlockCount: bodyResult.sourceBlockCount,
              chunkCount: bodyResult.chunkCount,
              repairedChunkCount: bodyResult.repairedChunkCount,
              contentHash: hash,
              model: process.env.VLLM_MODEL ?? "Qwen/Qwen3.6-27B-FP8",
              promptVariantId: prompt.id,
              qaFlags: flags,
              durationMs: Date.now() - started,
            });
            stats.translated++;
            lastErr = undefined;
            break;
          } catch (err) {
            lastErr = err;
            if (attempt < maxArticleAttempts) {
              await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
            }
          }
        }
        if (lastErr) {
          stats.errors++;
          recordError(store!, options.providerDb, row.id, options.lang, lastErr instanceof Error ? lastErr.message : String(lastErr));
        }
        reportProgress();
      },
    );

    return stats;
  } finally {
    source.close();
    store?.close();
  }
}

export type TranslateArticlesArgs = {
  db: string | null;
  lang: string;
  limit: number | null;
  categories: string[] | null;
  articleIds: string[] | null;
  concurrency: number;
  force: boolean;
  dryRun: boolean;
  outDir: string;
  help: boolean;
};

export function parseArgs(argv: string[]): TranslateArticlesArgs {
  const categoriesRaw = parseString(argv, "--category");
  const articleIdsRaw = parseString(argv, "--article-id");
  const limitRaw = parseString(argv, "--limit");
  const args: TranslateArticlesArgs = {
    db: parseString(argv, "--db"),
    lang: parseString(argv, "--lang") ?? DEFAULT_LANG,
    limit: limitRaw ? Math.max(1, Number(limitRaw) || 0) || null : null,
    categories: categoriesRaw ? categoriesRaw.split(",").map((s) => s.trim()).filter(Boolean) : null,
    articleIds: articleIdsRaw ? articleIdsRaw.split(",").map((s) => s.trim()).filter(Boolean) : null,
    concurrency: parsePositiveInt(argv, "--concurrency", DEFAULT_CONCURRENCY),
    force: parseFlag(argv, "--force"),
    dryRun: parseFlag(argv, "--dry-run"),
    outDir: parseString(argv, "--out-dir") ?? DEFAULT_OUT_DIR,
    help: parseFlag(argv, "--help", "-h"),
  };
  const known = new Set([
    "--db",
    "--lang",
    "--limit",
    "--category",
    "--article-id",
    "--concurrency",
    "--force",
    "--dry-run",
    "--out-dir",
    "--help",
    "-h",
  ]);
  const valueFlags = new Set(["--db", "--lang", "--limit", "--category", "--article-id", "--concurrency", "--out-dir"]);
  for (let i = 0; i < argv.length; i++) {
    if (known.has(argv[i])) {
      if (valueFlags.has(argv[i])) i++;
      continue;
    }
    warnUnknown(argv[i]);
  }
  return args;
}

export async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.db) {
    console.log(
      "Usage: translate-articles.ts --db <name> [--lang zh-CN] [--limit N] [--category a,b] " +
        "[--article-id id1,id2] [--concurrency 32] [--force] [--dry-run] [--out-dir path]",
    );
    return args.db ? 0 : 2;
  }
  const stats = await runTranslateArticles({
    providerDb: args.db,
    lang: args.lang,
    limit: args.limit,
    categories: args.categories,
    articleIds: args.articleIds,
    concurrency: args.concurrency,
    force: args.force,
    dryRun: args.dryRun,
    outDir: args.outDir,
  });
  console.log(
    `Done. total=${stats.total} translated=${stats.translated} skipped=${stats.skippedUnchanged} ` +
      `errors=${stats.errors} flagged=${stats.flagged} repairedChunks=${stats.repairedChunks}`,
  );
  return stats.errors > 0 ? 1 : 0;
}

export function runAsCli(importMetaUrl = import.meta.url): void {
  if (isMain(importMetaUrl)) {
    runScript(main, "translate-articles failed");
  }
}

runAsCli();
