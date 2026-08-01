/**
 * Samples real article excerpts from `prisma/provider-dbs/*.db` for the
 * translation prompt lab.
 *
 * Privacy/content note: this script reads copyrighted provider article text.
 * It writes a working corpus to `.translation-lab/` (gitignored, never
 * committed) and prints ONLY aggregate counts to the console — never article
 * titles, excerpts, or content.
 *
 * Usage:
 *   npm run node-ts -- scripts/translation-prompt-lab/sample.ts \
 *     --per-category 2 --max-chars 1600 --out .translation-lab/corpus.json
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { articleHtmlToReaderBlocks } from "@/lib/content-pipeline";
import { ALL_CATEGORIES, profileForCategory, type ArticleCategory } from "./categories";
import { isMain, parsePositiveInt, parseString, runScript, warnUnknown } from "../lib/cli";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const PROVIDER_DB_DIR = join(REPO_ROOT, "prisma", "provider-dbs");
const DEFAULT_OUT = join(REPO_ROOT, ".translation-lab", "corpus.json");

type SqliteDatabase = {
  prepare: (sql: string) => { all: (...params: unknown[]) => unknown[] };
  close: () => void;
};

type ArticleRow = {
  id: string;
  title: string;
  content: string;
  category: string | null;
};

export type SampledArticle = {
  /** Synthetic id: `<providerDb>:<articleId>` — never the real title/URL. */
  sampleId: string;
  providerDb: string;
  category: ArticleCategory | "uncategorized";
  profile: string;
  /** Plain-text excerpt (HTML stripped, truncated at a paragraph boundary). */
  text: string;
  paragraphCount: number;
  charCount: number;
};

export type Corpus = {
  generatedAt: string;
  mode: "per-category" | "longest";
  perCategory: number;
  maxChars: number;
  articles: SampledArticle[];
};

export function openSqlite(pathValue: string): SqliteDatabase {
  const require = createRequire(import.meta.url);
  const Database = require("better-sqlite3") as new (
    path: string,
    options?: { readonly?: boolean; fileMustExist?: boolean },
  ) => SqliteDatabase;
  return new Database(pathValue, { readonly: true, fileMustExist: true });
}

export function providerDbFiles(providerDbDir = PROVIDER_DB_DIR): string[] {
  if (!existsSync(providerDbDir)) return [];
  return readdirSync(providerDbDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extname(entry.name) === ".db")
    .map((entry) => join(providerDbDir, entry.name))
    .sort();
}

/** Truncates plain text to at most `maxChars`, cutting at the last full paragraph. */
export function truncateAtParagraph(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text.trim();
  const slice = text.slice(0, maxChars);
  const lastParagraphBreak = slice.lastIndexOf("\n\n");
  if (lastParagraphBreak > maxChars * 0.4) {
    return slice.slice(0, lastParagraphBreak).trim();
  }
  // No paragraph break early enough (the leading paragraph alone exceeds
  // maxChars) — fall back to the last sentence boundary so we never hand the
  // model (or the judge) a mid-word/mid-sentence fragment.
  const lastSentenceBreak = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf(".\n"),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("! "),
  );
  if (lastSentenceBreak > maxChars * 0.3) {
    return slice.slice(0, lastSentenceBreak + 1).trim();
  }
  return slice.trim();
}

export function paragraphCount(text: string): number {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean).length;
}

/**
 * `articleHtmlToReaderText` (used elsewhere in the app for TTS/highlight
 * anchoring) joins reader blocks with a single space, discarding paragraph
 * boundaries entirely — verified directly against real provider content:
 * zero `\n` characters in its output regardless of how many `<p>` tags the
 * source had. That's fine for word-offset-based features, but wrong for
 * translation, where a real paragraph structure both drives sensible
 * chunking and is something the prompts explicitly ask the model to
 * preserve. This lab uses the lower-level `articleHtmlToReaderBlocks` API
 * and rejoins its `blocks` (one per rendered reader block, in DOM order)
 * with `\n\n` to reconstruct real paragraph breaks.
 */
export function readerParagraphText(html: string): string {
  return articleHtmlToReaderBlocks(html).blocks.join("\n\n");
}

/**
 * Samples up to `perCategory` articles per category from one provider db.
 * Uses a deterministic offset (hash of db name) so repeated runs are stable
        const plain = readerParagraphText(row.content);
 */
export function sampleFromDb(pathValue: string, perCategory: number, maxChars: number): SampledArticle[] {
  const providerDb = pathValue.split("/").pop()!.replace(/\.db$/, "");
  const db = openSqlite(pathValue);
  const out: SampledArticle[] = [];
  try {
    for (const category of ALL_CATEGORIES) {
      const rows = db
        .prepare(
          `SELECT id, title, content, category FROM Article
           WHERE category = ? AND content IS NOT NULL AND length(content) > 400
           ORDER BY id LIMIT ?`,
        )
        .all(category, perCategory) as ArticleRow[];
      for (const row of rows) {
        const plain = readerParagraphText(row.content);
        if (!plain || plain.length < 200) continue;
        const text = truncateAtParagraph(plain, maxChars);
        out.push({
          sampleId: `${providerDb}:${row.id}`,
          providerDb,
          category: category as ArticleCategory,
          profile: profileForCategory(category),
          text,
          paragraphCount: paragraphCount(text),
          charCount: text.length,
        });
      }
    }
  } finally {
    db.close();
  }
  return out;
}

export function buildCorpus(perCategory: number, maxChars: number, dbFilter: string | null): Corpus {
  const files = providerDbFiles().filter((f) => !dbFilter || f.includes(dbFilter));
  const articles: SampledArticle[] = [];
  for (const file of files) {
    articles.push(...sampleFromDb(file, perCategory, maxChars));
  }
  return { generatedAt: new Date().toISOString(), mode: "per-category", perCategory, maxChars, articles };
}

/**
 * Selects the N longest articles across every provider db (any category),
 * with NO truncation — for stress-testing `translate.ts`'s chunking (see
 * `chunk.ts`) against real long-tail content instead of the ~1-2k char
 * excerpts the per-category sampler produces.
 */
export function buildLongestCorpus(n: number, dbFilter: string | null): Corpus {
  const files = providerDbFiles().filter((f) => !dbFilter || f.includes(dbFilter));
  type Candidate = { providerDb: string; row: ArticleRow; htmlLen: number };
  const candidates: Candidate[] = [];
  for (const file of files) {
    const providerDb = file.split("/").pop()!.replace(/\.db$/, "");
    const db = openSqlite(file);
    try {
      const rows = db
        .prepare(
          `SELECT id, title, content, category FROM Article
           WHERE content IS NOT NULL ORDER BY length(content) DESC LIMIT ?`,
        )
        .all(n) as ArticleRow[];
      for (const row of rows) candidates.push({ providerDb, row, htmlLen: row.content.length });
    } finally {
      db.close();
    }
  }
  candidates.sort((a, b) => b.htmlLen - a.htmlLen);
  const articles: SampledArticle[] = candidates.slice(0, n).map(({ providerDb, row }) => {
    const text = readerParagraphText(row.content).trim();
    const category = (row.category ?? "world") as ArticleCategory;
    return {
      sampleId: `${providerDb}:${row.id}`,
      providerDb,
      category,
      profile: profileForCategory(row.category),
      text,
      paragraphCount: paragraphCount(text),
      charCount: text.length,
    };
  });
  return { generatedAt: new Date().toISOString(), mode: "longest", perCategory: 0, maxChars: -1, articles };
}

export function summarize(corpus: Corpus): void {
  const byCategory = new Map<string, number>();
  const byDb = new Map<string, number>();
  const charCounts: number[] = [];
  for (const a of corpus.articles) {
    byCategory.set(a.category, (byCategory.get(a.category) ?? 0) + 1);
    byDb.set(a.providerDb, (byDb.get(a.providerDb) ?? 0) + 1);
    charCounts.push(a.charCount);
  }
  console.log(`Sampled ${corpus.articles.length} article excerpts from ${byDb.size} provider db(s) (mode: ${corpus.mode}).`);
  console.log("By category:", Object.fromEntries(byCategory));
  if (charCounts.length > 0) {
    console.log(
      `Char counts — min ${Math.min(...charCounts)}, max ${Math.max(...charCounts)}, ` +
        `mean ${Math.round(charCounts.reduce((a, b) => a + b, 0) / charCounts.length)}`,
    );
  }
}

export type SampleArgs = {
  perCategory: number;
  maxChars: number;
  longest: number | null;
  out: string;
  db: string | null;
  help: boolean;
};

export function parseArgs(argv: string[]): SampleArgs {
  const args: SampleArgs = {
    perCategory: parsePositiveInt(argv, "--per-category", 2),
    maxChars: parsePositiveInt(argv, "--max-chars", 1600),
    longest: argv.includes("--longest") ? parsePositiveInt(argv, "--longest", 3) : null,
    out: parseString(argv, "--out") ?? DEFAULT_OUT,
    db: parseString(argv, "--db"),
    help: argv.includes("--help") || argv.includes("-h"),
  };
  const known = new Set(["--per-category", "--max-chars", "--longest", "--out", "--db", "--help", "-h"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (known.has(arg)) {
      if (arg !== "--help" && arg !== "-h") i++; // skip its value
      continue;
    }
    warnUnknown(arg);
  }
  return args;
}

export async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: sample.ts [--per-category N] [--max-chars N] [--db name] [--out path]\n" +
        "       sample.ts --longest N [--db name] [--out path]  (untruncated, for chunking stress tests)",
    );
    return 0;
  }
  const corpus = args.longest
    ? buildLongestCorpus(args.longest, args.db)
    : buildCorpus(args.perCategory, args.maxChars, args.db);
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(corpus, null, 2));
  summarize(corpus);
  console.log(`Wrote corpus (article text — do not commit) to ${args.out}`);
  return 0;
}

export function runAsCli(importMetaUrl = import.meta.url): void {
  if (isMain(importMetaUrl)) {
    runScript(main, "sample failed");
  }
}

runAsCli();
