/**
 * Output storage for production article translations — a SEPARATE SQLite
 * database (one per provider db), never the provider-db files themselves
 * (those stay strictly read-only, matching `scripts/difficulty-eval.ts` /
 * `sample.ts`). Schema mirrors the production `Translation` model
 * (`prisma/base.prisma`) plus the extra provenance/QA fields a batch job
 * needs: `contentHash` for idempotent re-runs, `promptVariantId`/`model` for
 * knowing what needs re-translation after a prompt/model change, and
 * `qaFlags` for translations that passed structurally but failed a quality
 * gate and need human review rather than being silently trusted.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openReadWrite, type SqliteDatabase } from "./db";

export type ArticleTranslationRow = {
  providerDb: string;
  articleId: string;
  targetLang: string;
  titleTranslated: string;
  contentTranslated: string;
  sourceBlockCount: number;
  chunkCount: number;
  repairedChunkCount: number;
  contentHash: string;
  model: string;
  promptVariantId: string;
  qaFlags: string[];
  durationMs: number;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ArticleTranslation (
  id TEXT PRIMARY KEY,
  providerDb TEXT NOT NULL,
  articleId TEXT NOT NULL,
  targetLang TEXT NOT NULL,
  titleTranslated TEXT NOT NULL,
  contentTranslated TEXT NOT NULL,
  sourceBlockCount INTEGER NOT NULL,
  chunkCount INTEGER NOT NULL,
  repairedChunkCount INTEGER NOT NULL DEFAULT 0,
  contentHash TEXT NOT NULL,
  model TEXT NOT NULL,
  promptVariantId TEXT NOT NULL,
  qaFlags TEXT NOT NULL DEFAULT '[]',
  durationMs INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ArticleTranslation_unique
  ON ArticleTranslation(providerDb, articleId, targetLang);

CREATE TABLE IF NOT EXISTS ArticleTranslationError (
  id TEXT PRIMARY KEY,
  providerDb TEXT NOT NULL,
  articleId TEXT NOT NULL,
  targetLang TEXT NOT NULL,
  error TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ArticleTranslationError_lookup
  ON ArticleTranslationError(providerDb, articleId, targetLang);
`;

export function openTranslationStore(pathValue: string): SqliteDatabase {
  mkdirSync(dirname(pathValue), { recursive: true });
  const db = openReadWrite(pathValue);
  db.exec(SCHEMA);
  return db;
}

/** Existing translation's contentHash, if any — used for idempotent skip. */
export function getExistingHash(
  db: SqliteDatabase,
  providerDb: string,
  articleId: string,
  targetLang: string,
): string | null {
  const row = db
    .prepare(
      "SELECT contentHash FROM ArticleTranslation WHERE providerDb = ? AND articleId = ? AND targetLang = ?",
    )
    .get(providerDb, articleId, targetLang) as { contentHash: string } | undefined;
  return row?.contentHash ?? null;
}

export function upsertTranslation(db: SqliteDatabase, row: ArticleTranslationRow): void {
  db.prepare(
    `INSERT INTO ArticleTranslation
       (id, providerDb, articleId, targetLang, titleTranslated, contentTranslated,
        sourceBlockCount, chunkCount, repairedChunkCount, contentHash, model,
        promptVariantId, qaFlags, durationMs, updatedAt)
     VALUES (@id, @providerDb, @articleId, @targetLang, @titleTranslated, @contentTranslated,
             @sourceBlockCount, @chunkCount, @repairedChunkCount, @contentHash, @model,
             @promptVariantId, @qaFlags, @durationMs, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(providerDb, articleId, targetLang) DO UPDATE SET
       titleTranslated = excluded.titleTranslated,
       contentTranslated = excluded.contentTranslated,
       sourceBlockCount = excluded.sourceBlockCount,
       chunkCount = excluded.chunkCount,
       repairedChunkCount = excluded.repairedChunkCount,
       contentHash = excluded.contentHash,
       model = excluded.model,
       promptVariantId = excluded.promptVariantId,
       qaFlags = excluded.qaFlags,
       durationMs = excluded.durationMs,
       updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  ).run({
    id: `${row.providerDb}:${row.articleId}:${row.targetLang}`,
    providerDb: row.providerDb,
    articleId: row.articleId,
    targetLang: row.targetLang,
    titleTranslated: row.titleTranslated,
    contentTranslated: row.contentTranslated,
    sourceBlockCount: row.sourceBlockCount,
    chunkCount: row.chunkCount,
    repairedChunkCount: row.repairedChunkCount,
    contentHash: row.contentHash,
    model: row.model,
    promptVariantId: row.promptVariantId,
    qaFlags: JSON.stringify(row.qaFlags),
    durationMs: row.durationMs,
  });
}

export function recordError(
  db: SqliteDatabase,
  providerDb: string,
  articleId: string,
  targetLang: string,
  error: string,
): void {
  db.prepare(
    "INSERT INTO ArticleTranslationError (id, providerDb, articleId, targetLang, error) VALUES (?, ?, ?, ?, ?)",
  ).run(`${providerDb}:${articleId}:${targetLang}:${Date.now()}`, providerDb, articleId, targetLang, error);
}

export function ensureParentDirExists(pathValue: string): void {
  if (!existsSync(dirname(pathValue))) mkdirSync(dirname(pathValue), { recursive: true });
}
