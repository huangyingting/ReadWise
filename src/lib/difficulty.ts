import { prisma } from "@/lib/prisma";
import { chatComplete, isAiConfigured } from "@/lib/ai";
import type { Prisma } from "@prisma/client";
import { htmlToPlainText } from "@/lib/content-pipeline";
import { boundedSampleForFeature } from "@/lib/ai/chunking";
import { renderPrompt, promptModelParams, activePromptVersion } from "@/lib/ai/prompts";
import {
  ENGLISH_LEVELS,
  levelRank,
  levelsAtOrBelow,
  isDifficultyLevel,
  type EnglishLevel,
} from "@/lib/leveling/cefr-primitives";
import {
  getAiProcessableArticleById,
  isArticleOperator,
  SYSTEM_ARTICLE_CONTEXT,
  type ArticleAccessContext,
} from "@/lib/article-access";

/**
 * Difficulty / English level assessment for articles. Levels reuse the CEFR
 * scale (A1–C2) shared with reader profiles so recommendations can be matched
 * to a reader's self-reported level. Assessment prefers the AI provider when
 * configured and degrades gracefully to a deterministic readability heuristic.
 *
 * CEFR rank/range primitives (`levelRank`, `levelsAtOrBelow`, `isDifficultyLevel`)
 * live in `@/lib/leveling/cefr-primitives` and are re-exported here for
 * backward compatibility.
 */

export type DifficultyLevel = EnglishLevel;

export const DIFFICULTY_LEVELS = ENGLISH_LEVELS;

// Re-export shared CEFR primitives so existing callers continue to work.
export { levelRank, levelsAtOrBelow, isDifficultyLevel };

export type DifficultySource = "cache" | "ai" | "heuristic";

export type DifficultyResult = {
  articleId: string;
  level: DifficultyLevel;
  score: number;
  source: DifficultySource;
};

/** Rough syllable count for a single word using vowel-group heuristics. */
function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) {
    return 0;
  }
  if (w.length <= 3) {
    return 1;
  }
  const groups = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "")
    .match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/**
 * Flesch Reading Ease for a block of plain text. Higher means easier to read.
 * Returns null when there isn't enough text to score reliably.
 */
export function fleschReadingEase(text: string): number | null {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? [];
  if (words.length < 20 || sentences.length === 0) {
    return null;
  }
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const wordsPerSentence = words.length / sentences.length;
  const syllablesPerWord = syllables / words.length;
  return 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;
}

/** Maps a Flesch Reading Ease value to a CEFR level (lower ease = harder). */
function easeToLevel(ease: number): DifficultyLevel {
  if (ease >= 90) return "A1";
  if (ease >= 80) return "A2";
  if (ease >= 70) return "B1";
  if (ease >= 60) return "B2";
  if (ease >= 50) return "C1";
  return "C2";
}

/**
 * Deterministic readability-based difficulty. `score` is a 0–100 difficulty
 * measure (higher = harder), the inverse of clamped reading ease.
 */
export function heuristicDifficulty(
  content: string,
): { level: DifficultyLevel; score: number } {
  const text = htmlToPlainText(content);
  const ease = fleschReadingEase(text);
  if (ease == null) {
    // Not enough text to judge; assume a middle-of-the-road level.
    return { level: "B1", score: 50 };
  }
  const clamped = Math.min(100, Math.max(0, ease));
  return { level: easeToLevel(clamped), score: Math.round(100 - clamped) };
}

/** Difficulty score (0–100, higher = harder) at the centre of a level's band. */
function levelToScore(level: DifficultyLevel): number {
  const rank = levelRank(level);
  // 6 bands across 0–100; place each at its band centre.
  return Math.round(((rank + 0.5) / DIFFICULTY_LEVELS.length) * 100);
}

/** Extracts the first valid CEFR level token from arbitrary model output. */
export function parseLevel(raw: string): DifficultyLevel | null {
  const match = raw.toUpperCase().match(/\b([ABC][12])\b/);
  if (match && isDifficultyLevel(match[1])) {
    return match[1];
  }
  return null;
}

async function aiAssessLevel(
  title: string,
  content: string,
): Promise<DifficultyLevel | null> {
  const source = boundedSampleForFeature(htmlToPlainText(content), "difficulty");
  const completion = await chatComplete(
    renderPrompt("difficulty", { title, source }),
    {
      maxOutputTokens: promptModelParams("difficulty").maxOutputTokens,
      feature: "difficulty",
      promptVersion: activePromptVersion("difficulty"),
    },
  );
  if (!completion) {
    return null;
  }
  return parseLevel(completion);
}

/**
 * Assesses difficulty for the given text. Uses the AI provider when configured
 * (keeping the deterministic readability score for fine-grained ordering), and
 * falls back to the heuristic otherwise.
 */
export async function assessDifficulty(
  title: string,
  content: string,
): Promise<{ level: DifficultyLevel; score: number; source: DifficultySource }> {
  const heuristic = heuristicDifficulty(content);
  if (isAiConfigured()) {
    const aiLevel = await aiAssessLevel(title, content);
    if (aiLevel) {
      return { level: aiLevel, score: levelToScore(aiLevel), source: "ai" };
    }
  }
  return { ...heuristic, source: "heuristic" };
}

/**
 * Returns the stored difficulty for an article, assessing and persisting it on
 * a miss. The AI provider is used when available (per-article), otherwise the
 * deterministic heuristic is used and cached. Returns null for missing articles.
 */
export async function getOrCreateArticleDifficulty(
  articleId: string,
  context: ArticleAccessContext | null = SYSTEM_ARTICLE_CONTEXT,
): Promise<DifficultyResult | null> {
  const select = {
      id: true,
      title: true,
      content: true,
      difficulty: true,
      difficultyScore: true,
    } satisfies Prisma.ArticleSelect;
  const article = isArticleOperator(context)
    ? await prisma.article.findUnique({ where: { id: articleId }, select })
    : await getAiProcessableArticleById(articleId, context, { select });
  if (!article) {
    return null;
  }

  if (isDifficultyLevel(article.difficulty)) {
    return {
      articleId,
      level: article.difficulty,
      score: article.difficultyScore ?? levelToScore(article.difficulty),
      source: "cache",
    };
  }

  const assessed = await assessDifficulty(article.title, article.content);
  await prisma.article.update({
    where: { id: articleId },
    data: { difficulty: assessed.level, difficultyScore: assessed.score },
  });
  return { articleId, ...assessed };
}

type ArticleLike = {
  id: string;
  title: string;
  content: string;
  difficulty: string | null;
  difficultyScore: number | null;
};

/**
 * Ensures every article in the list has a stored difficulty, filling any gaps
 * with the deterministic heuristic (no AI, so this stays cheap for listings).
 * Mutates the passed objects in place so callers can render immediately, and
 * returns a map of articleId → result. Heavier AI assessment happens lazily on
 * the single-article reader view via `getOrCreateArticleDifficulty`.
 */
export async function ensureArticleDifficulties(
  articles: ArticleLike[],
): Promise<Map<string, DifficultyResult>> {
  const map = new Map<string, DifficultyResult>();
  const writes: Promise<unknown>[] = [];

  for (const article of articles) {
    if (isDifficultyLevel(article.difficulty)) {
      map.set(article.id, {
        articleId: article.id,
        level: article.difficulty,
        score: article.difficultyScore ?? levelToScore(article.difficulty),
        source: "cache",
      });
      continue;
    }
    const heuristic = heuristicDifficulty(article.content);
    article.difficulty = heuristic.level;
    article.difficultyScore = heuristic.score;
    map.set(article.id, {
      articleId: article.id,
      level: heuristic.level,
      score: heuristic.score,
      source: "heuristic",
    });
    writes.push(
      prisma.article.update({
        where: { id: article.id },
        data: { difficulty: heuristic.level, difficultyScore: heuristic.score },
      }),
    );
  }

  if (writes.length > 0) {
    await Promise.all(writes);
  }
  return map;
}
