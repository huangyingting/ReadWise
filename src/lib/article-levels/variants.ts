/**
 * Article reading-level variants (#1303).
 *
 * `Article.content` is the canonical "original" level. Content staff add
 * adapted variants (`ArticleLevel`) by hand or with the optional LEVEL_ADAPT
 * job, which rewrites the article with the AI provider and degrades to
 * "skipped — add the level manually" when AI is unconfigured.
 *
 * Variant text is stored as paragraphs of escaped `<p>` HTML built here from
 * plain text, so editors never author raw HTML. Word count, Lexile-style
 * estimate, and measured CEFR come from the deterministic difficulty scorer.
 * Changing a variant's text clears its level-scoped quiz so questions always
 * match the prose. Article text is never logged.
 *
 * This module holds the database reads and pure text helpers; authoring and AI
 * adaptation live in `./authoring` so readers don't load the AI stack.
 */
import { prisma } from "@/lib/prisma";
import { assignmentLiveWhere, assignmentVisibleToStudentWhere } from "@/lib/classroom/targeting";
import {
  ORIGINAL_LEVEL,
  isArticleLevelKey,
  isReadingLevelKey,
  readingLevelLabel,
  readingLevelRank,
  type ArticleLevelKey,
  type ReadingLevelKey,
} from "./levels";

export const DEFAULT_LANGUAGE = "en";
export const LEVEL_TITLE_MAX_LENGTH = 300;
export const LEVEL_TEXT_MAX_LENGTH = 60_000;

export type ArticleLevelSummary = {
  levelKey: ArticleLevelKey;
  title: string;
  wordCount: number;
  lexileApprox: number | null;
  cefrLevel: string | null;
  source: string;
  updatedAt: Date;
};

export type ArticleLevelVariant = {
  levelKey: ArticleLevelKey;
  title: string;
  content: string;
  wordCount: number;
  lexileApprox: number | null;
  cefrLevel: string | null;
};

export const SUMMARY_SELECT = {
  levelKey: true,
  title: true,
  wordCount: true,
  lexileApprox: true,
  cefrLevel: true,
  source: true,
  updatedAt: true,
} as const;

function byRank<T extends { levelKey: string }>(rows: T[]): Array<T & { levelKey: ArticleLevelKey }> {
  return rows
    .filter((row): row is T & { levelKey: ArticleLevelKey } => isArticleLevelKey(row.levelKey))
    .sort((a, b) => readingLevelRank(a.levelKey) - readingLevelRank(b.levelKey));
}

/** Adapted levels of an article, easiest first. */
export async function listArticleLevels(articleId: string): Promise<ArticleLevelSummary[]> {
  return byRank(
    await prisma.articleLevel.findMany({
      where: { articleId, language: DEFAULT_LANGUAGE },
      select: SUMMARY_SELECT,
    }),
  );
}

export type EditableArticleLevel = ArticleLevelSummary & { text: string };

/** Adapted levels with editable plain text, for the admin article page. */
export async function listEditableArticleLevels(articleId: string): Promise<EditableArticleLevel[]> {
  const rows = await prisma.articleLevel.findMany({
    where: { articleId, language: DEFAULT_LANGUAGE },
    select: { ...SUMMARY_SELECT, content: true },
  });
  return byRank(rows).map(({ content, ...row }) => ({ ...row, text: variantContentToText(content) }));
}

/** Level keys available per article (for pickers), including "original". */
export async function levelKeysForArticles(articleIds: string[]): Promise<Map<string, ReadingLevelKey[]>> {
  const map = new Map<string, ReadingLevelKey[]>();
  if (articleIds.length === 0) return map;
  const rows = await prisma.articleLevel.findMany({
    where: { articleId: { in: articleIds }, language: DEFAULT_LANGUAGE },
    select: { articleId: true, levelKey: true },
  });
  for (const id of articleIds) map.set(id, []);
  for (const row of byRank(rows)) map.get(row.articleId)?.push(row.levelKey);
  for (const [id, keys] of map) map.set(id, keys.length > 0 ? [...keys, ORIGINAL_LEVEL] : []);
  return map;
}

/** One adapted variant, or null when the article has no such level. */
export async function getArticleLevelVariant(
  articleId: string,
  levelKey: ReadingLevelKey,
): Promise<ArticleLevelVariant | null> {
  if (!isArticleLevelKey(levelKey)) return null;
  const row = await prisma.articleLevel.findUnique({
    where: { articleId_levelKey_language: { articleId, levelKey, language: DEFAULT_LANGUAGE } },
    select: { levelKey: true, title: true, content: true, wordCount: true, lexileApprox: true, cefrLevel: true },
  });
  return row ? { ...row, levelKey } : null;
}

/** True when the article can be read at `levelKey` ("original" always exists). */
export async function articleHasLevel(articleId: string, levelKey: string): Promise<boolean> {
  if (levelKey === ORIGINAL_LEVEL) return true;
  if (!isArticleLevelKey(levelKey)) return false;
  return (await getArticleLevelVariant(articleId, levelKey)) !== null;
}

/**
 * The level a learner must read at, when one of their live assignments of the
 * article locks it (targeting and publish state apply). Locks to levels that no
 * longer exist are ignored.
 */
export async function lockedLevelFor(
  userId: string,
  articleId: string,
  available: ReadonlySet<ReadingLevelKey>,
): Promise<ReadingLevelKey | null> {
  const rows = await prisma.assignment.findMany({
    where: {
      articleId,
      lockedLevelKey: { not: null },
      classroom: { archivedAt: null, members: { some: { userId, role: "Student" } } },
      AND: [assignmentVisibleToStudentWhere(userId), assignmentLiveWhere(new Date())],
    },
    select: { lockedLevelKey: true },
    orderBy: { createdAt: "asc" },
  });
  for (const row of rows) {
    if (isReadingLevelKey(row.lockedLevelKey) && available.has(row.lockedLevelKey)) return row.lockedLevelKey;
  }
  return null;
}

export type ReaderLevelOption = { levelKey: ReadingLevelKey; label: string; recommended: boolean };

export type ReaderLevelState = {
  level: ReadingLevelKey;
  /** True when a teacher's assignment fixes the level. */
  locked: boolean;
  /** Empty for single-level articles. */
  options: ReaderLevelOption[];
  variant: ArticleLevelVariant | null;
};

/**
 * Resolves the reader's level for an article: a teacher lock wins, then the
 * requested `?level=`, then the original text. Recommends the level matching
 * the learner's profile CEFR level when one exists.
 */
export async function resolveReaderLevel(input: {
  articleId: string;
  userId: string;
  requested: unknown;
}): Promise<ReaderLevelState> {
  const levels = await listArticleLevels(input.articleId);
  if (levels.length === 0) return { level: ORIGINAL_LEVEL, locked: false, options: [], variant: null };
  const profile = await prisma.profile.findUnique({ where: { userId: input.userId }, select: { englishLevel: true } });

  const available = new Set<ReadingLevelKey>([...levels.map((level) => level.levelKey), ORIGINAL_LEVEL]);
  const locked = await lockedLevelFor(input.userId, input.articleId, available);
  const requested = isReadingLevelKey(input.requested) && available.has(input.requested) ? input.requested : ORIGINAL_LEVEL;
  const level = locked ?? requested;
  const options: ReaderLevelOption[] = [
    ...levels.map((row) => ({
      levelKey: row.levelKey as ReadingLevelKey,
      label: readingLevelLabel(row.levelKey, row.lexileApprox),
      recommended: row.levelKey === profile?.englishLevel,
    })),
    { levelKey: ORIGINAL_LEVEL, label: readingLevelLabel(ORIGINAL_LEVEL), recommended: false },
  ];
  return {
    level,
    locked: locked !== null,
    options,
    variant: level === ORIGINAL_LEVEL ? null : await getArticleLevelVariant(input.articleId, level),
  };
}

// ---------------------------------------------------------------------------
// Variant text (pure)
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function unescapeHtml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
}

/** Splits plain text on blank lines into trimmed, non-empty paragraphs. */
export function textToParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Escaped `<p>` HTML for paragraphs. */
export function paragraphsToHtml(paragraphs: string[]): string {
  return paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n");
}

/** The editable plain text of stored variant HTML (paragraphs separated by blank lines). */
export function variantContentToText(content: string): string {
  const paragraphs = [...content.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((match) => unescapeHtml(match[1]));
  return paragraphs.join("\n\n");
}
