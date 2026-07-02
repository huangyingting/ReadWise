import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { articleHtmlToReaderText } from "@/lib/content-pipeline";
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
} from "@/lib/article-library";
import { normalizeCandidates } from "@/lib/lexical/normalize";
import { wordFrequencyBand, type WordFrequencyBand } from "@/lib/frequency-ranks";
import { DIFFICULTY_ALGORITHM_VERSION } from "@/lib/difficulty-version";

/**
 * Difficulty / English level assessment for articles. Levels reuse the CEFR
 * scale (A1–C2) shared with reader profiles so recommendations can be matched
 * to a reader's self-reported level. Assessment is deterministic and local:
 * a composite of vocabulary frequency, readability, syntax, idioms/domain load,
 * and length. No AI provider is used for CEFR or Lexile-like scoring.
 *
 * CEFR rank/range primitives (`levelRank`, `levelsAtOrBelow`, `isDifficultyLevel`)
 * live in `@/lib/leveling/cefr-primitives`.
 */

export type DifficultyLevel = EnglishLevel;

export const DIFFICULTY_LEVELS = ENGLISH_LEVELS;

export { DIFFICULTY_ALGORITHM_VERSION };

export type DifficultySource = "cache" | "deterministic";
export type DifficultyConfidence = "low" | "medium" | "high";

export type DifficultyResult = {
  articleId: string;
  level: DifficultyLevel;
  score: number;
  lexileApprox: number;
  confidence: DifficultyConfidence;
  version: string;
  source: DifficultySource;
};

type SentenceWords = {
  sentence: string;
  words: string[];
};

export type DeterministicDifficultyMetrics = {
  wordCount: number;
  sentenceCount: number;
  vocabularyScore: number;
  readabilityScore: number;
  syntaxScore: number;
  idiomOrDomainScore: number;
  lengthScore: number;
};

export type DeterministicDifficultyResult = {
  level: DifficultyLevel;
  score: number;
  lexileApprox: number;
  confidence: DifficultyConfidence;
  version: string;
  metrics: DeterministicDifficultyMetrics;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, places = 0): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function scoreFromRange(value: number, easy: number, hard: number): number {
  if (hard === easy) return 0;
  return clamp(((value - easy) / (hard - easy)) * 100, 0, 100);
}

function wordsIn(text: string): string[] {
  return text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) ?? [];
}

function sentenceWords(text: string): SentenceWords[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .map((sentence) => ({ sentence, words: wordsIn(sentence) }))
    .filter((item) => item.words.length > 0);
}

function charCount(words: string[]): number {
  return words.reduce((sum, word) => sum + word.replace(/[^A-Za-z]/g, "").length, 0);
}

function polysyllableCount(words: string[]): number {
  return words.filter((word) => countSyllables(word) >= 3).length;
}

function fleschKincaidGrade(words: string[], sentenceCount: number, syllables: number): number | null {
  if (words.length < 20 || sentenceCount === 0) return null;
  return 0.39 * (words.length / sentenceCount) + 11.8 * (syllables / words.length) - 15.59;
}

function automatedReadabilityIndex(words: string[], sentenceCount: number): number | null {
  if (words.length < 20 || sentenceCount === 0) return null;
  return 4.71 * (charCount(words) / words.length) + 0.5 * (words.length / sentenceCount) - 21.43;
}

function colemanLiauIndex(words: string[], sentenceCount: number): number | null {
  if (words.length < 20 || sentenceCount === 0) return null;
  const lettersPer100Words = (charCount(words) / words.length) * 100;
  const sentencesPer100Words = (sentenceCount / words.length) * 100;
  return 0.0588 * lettersPer100Words - 0.296 * sentencesPer100Words - 15.8;
}

function smogIndex(words: string[], sentenceCount: number): number | null {
  if (words.length < 30 || sentenceCount === 0) return null;
  return 1.043 * Math.sqrt(polysyllableCount(words) * (30 / sentenceCount)) + 3.1291;
}

function lixScore(words: string[], sentenceCount: number): number | null {
  if (words.length < 20 || sentenceCount === 0) return null;
  const longWords = words.filter((word) => word.replace(/[^A-Za-z]/g, "").length > 6).length;
  return words.length / sentenceCount + (longWords * 100) / words.length;
}

function scoreToLevel(score: number): DifficultyLevel {
  if (score <= 15) return "A1";
  if (score <= 30) return "A2";
  if (score <= 48) return "B1";
  if (score <= 65) return "B2";
  if (score <= 82) return "C1";
  return "C2";
}

/**
 * Difficulty score (0–100, higher = harder) at the centre of a level's band.
 */
function levelToScore(level: DifficultyLevel): number {
  const rank = levelRank(level);
  // 6 bands across 0–100; place each at its band centre.
  return Math.round(((rank + 0.5) / DIFFICULTY_LEVELS.length) * 100);
}

const BAND_PENALTY: Record<WordFrequencyBand, number> = {
  top1k: 2,
  top2k: 12,
  top3k: 24,
  top5k: 38,
  top10k: 58,
  academic: 72,
  rare: 85,
};

const CLAUSE_MARKERS = new Set([
  "although",
  "because",
  "whereas",
  "while",
  "unless",
  "despite",
  "though",
  "which",
  "whose",
  "whom",
  "therefore",
  "however",
  "moreover",
  "nevertheless",
  "nonetheless",
  "consequently",
]);

const IDIOM_OR_PHRASAL_PATTERNS: RegExp[] = [
  /\bcarry out\b/gi,
  /\btake into account\b/gi,
  /\bin spite of\b/gi,
  /\bby and large\b/gi,
  /\bon the brink of\b/gi,
  /\bcome under fire\b/gi,
  /\blook(?:ed|ing)? up to\b/gi,
  /\bbring(?:s|ing)? about\b/gi,
  /\bset(?:s|ting)? out\b/gi,
  /\bpoint(?:s|ed|ing)? out\b/gi,
];

const TECHNICAL_SUFFIX_RE = /(tion|sion|ment|ity|ism|ology|graphy|ative|atory|genic|metric|lysis|cracy)$/i;

function isProperNounLike(word: string, indexInSentence: number): boolean {
  if (indexInSentence === 0) return false;
  if (/^[A-Z]{2,}$/.test(word)) return true;
  return /^[A-Z][a-z]+(?:[A-Z][a-z]+)*$/.test(word);
}

function vocabularyPenalty(word: string, indexInSentence: number): { lemma: string; penalty: number } | null {
  const candidates = normalizeCandidates(word);
  const lemma = candidates[0];
  if (!lemma) return null;
  const band = wordFrequencyBand(word);
  if (band === "rare" && isProperNounLike(word, indexInSentence)) {
    return { lemma, penalty: 24 };
  }
  return { lemma, penalty: BAND_PENALTY[band] };
}

function vocabularyScore(sentences: SentenceWords[]): number {
  const tokenPenalties: number[] = [];
  const unique = new Map<string, number>();

  for (const sentence of sentences) {
    sentence.words.forEach((word, index) => {
      const scored = vocabularyPenalty(word, index);
      if (!scored) return;
      tokenPenalties.push(scored.penalty);
      if (!unique.has(scored.lemma) || scored.penalty > unique.get(scored.lemma)!) {
        unique.set(scored.lemma, scored.penalty);
      }
    });
  }

  if (tokenPenalties.length === 0) return 50;
  const tokenScore = tokenPenalties.reduce((sum, value) => sum + value, 0) / tokenPenalties.length;
  const uniqueValues = [...unique.values()];
  const uniqueScore = uniqueValues.reduce((sum, value) => sum + value, 0) / Math.max(1, uniqueValues.length);
  return round(0.7 * tokenScore + 0.3 * uniqueScore, 1);
}

function readabilityScore(text: string, words: string[], sentenceCount: number): number {
  const syllables = words.reduce((sum, word) => sum + countSyllables(word), 0);
  const scores: number[] = [];
  const ease = fleschReadingEase(text);
  if (ease != null) scores.push(100 - clamp(ease, 0, 100));

  for (const grade of [
    fleschKincaidGrade(words, sentenceCount, syllables),
    automatedReadabilityIndex(words, sentenceCount),
    colemanLiauIndex(words, sentenceCount),
    smogIndex(words, sentenceCount),
  ]) {
    if (grade != null && Number.isFinite(grade)) {
      scores.push(scoreFromRange(grade, 2, 16));
    }
  }

  const lix = lixScore(words, sentenceCount);
  if (lix != null && Number.isFinite(lix)) {
    scores.push(scoreFromRange(lix, 20, 60));
  }

  if (scores.length === 0) return 35;
  return round(scores.reduce((sum, value) => sum + value, 0) / scores.length, 1);
}

function syntaxScore(text: string, sentences: SentenceWords[], words: string[]): number {
  if (sentences.length === 0 || words.length === 0) return 35;
  const sentenceLengths = sentences.map((sentence) => sentence.words.length);
  const avgSentenceLength = sentenceLengths.reduce((sum, value) => sum + value, 0) / sentenceLengths.length;
  const longSentenceRatio = sentenceLengths.filter((value) => value >= 25).length / sentenceLengths.length;
  const lowerWords = words.map((word) => normalizeCandidates(word)[0] ?? word.toLowerCase());
  const clauseMarkerDensity = lowerWords.filter((word) => CLAUSE_MARKERS.has(word)).length / words.length;
  const passiveLikeDensity = (text.match(/\b(?:is|are|was|were|be|been|being)\s+[a-z]+ed\b/gi) ?? []).length / words.length;
  const punctuationDensity = (text.match(/[;:—–()]/g) ?? []).length / Math.max(1, words.length);

  return round(
    0.4 * scoreFromRange(avgSentenceLength, 8, 32) +
      0.25 * clamp(longSentenceRatio * 220, 0, 100) +
      0.2 * clamp(clauseMarkerDensity * 900, 0, 100) +
      0.1 * clamp(passiveLikeDensity * 1200, 0, 100) +
      0.05 * clamp(punctuationDensity * 650, 0, 100),
    1,
  );
}

function idiomOrDomainScore(text: string, sentences: SentenceWords[], wordCount: number): number {
  if (wordCount === 0) return 0;
  const idiomHits = IDIOM_OR_PHRASAL_PATTERNS.reduce(
    (sum, pattern) => sum + (text.match(pattern) ?? []).length,
    0,
  );
  let technicalHits = 0;
  for (const sentence of sentences) {
    sentence.words.forEach((word, index) => {
      const band = wordFrequencyBand(word);
      const lemma = normalizeCandidates(word)[0] ?? "";
      if (
        !isProperNounLike(word, index) &&
        (band === "academic" || (band === "rare" && TECHNICAL_SUFFIX_RE.test(lemma)))
      ) {
        technicalHits += 1;
      }
    });
  }
  return round(clamp((idiomHits / wordCount) * 1800 + (technicalHits / wordCount) * 550, 0, 100), 1);
}

function lengthScore(wordCount: number): number {
  if (wordCount < 80) return 10;
  return round(scoreFromRange(wordCount, 250, 1800), 1);
}

function confidenceFor(wordCount: number, sentenceCount: number, score: number): DifficultyConfidence {
  if (wordCount < 120 || sentenceCount < 4) return "low";
  const nearestBoundaryDistance = Math.min(...[15, 30, 48, 65, 82].map((boundary) => Math.abs(score - boundary)));
  if (wordCount >= 500 && sentenceCount >= 12 && nearestBoundaryDistance >= 4) return "high";
  return "medium";
}

/**
 * Deterministic composite difficulty. `score` is a 0–100 ReadWise learner
 * difficulty measure (higher = harder). `lexileApprox` is a Lexile-like reading
 * complexity estimate, not an official Lexile measure.
 */
export function deterministicDifficulty(content: string): DeterministicDifficultyResult {
  const text = articleHtmlToReaderText(content);
  const sentences = sentenceWords(text);
  const words = sentences.flatMap((sentence) => sentence.words);
  const sentenceCount = sentences.length;
  const wordCount = words.length;

  const vocab = vocabularyScore(sentences);
  const readability = readabilityScore(text, words, sentenceCount);
  const syntax = syntaxScore(text, sentences, words);
  const idiomOrDomain = idiomOrDomainScore(text, sentences, wordCount);
  const length = lengthScore(wordCount);

  const score = Math.round(
    0.45 * vocab +
      0.25 * readability +
      0.2 * syntax +
      0.05 * idiomOrDomain +
      0.05 * length,
  );
  const lexileComplexity = 0.45 * readability + 0.4 * vocab + 0.15 * syntax;
  const lexileApprox = clamp(Math.round((200 + 14 * lexileComplexity) / 10) * 10, 200, 1600);

  return {
    level: scoreToLevel(score),
    score,
    lexileApprox,
    confidence: confidenceFor(wordCount, sentenceCount, score),
    version: DIFFICULTY_ALGORITHM_VERSION,
    metrics: {
      wordCount,
      sentenceCount,
      vocabularyScore: vocab,
      readabilityScore: readability,
      syntaxScore: syntax,
      idiomOrDomainScore: idiomOrDomain,
      lengthScore: length,
    },
  };
}

/** Backwards-compatible name used by existing import paths. */
export function heuristicDifficulty(content: string): DeterministicDifficultyResult {
  return deterministicDifficulty(content);
}

/** Extracts the first valid CEFR level token from arbitrary model output. */
export function parseLevel(raw: string): DifficultyLevel | null {
  const match = raw.toUpperCase().match(/\b([ABC][12])\b/);
  if (match && isDifficultyLevel(match[1])) {
    return match[1];
  }
  return null;
}

/**
 * Assesses difficulty for the given text. This path is deterministic only;
 * global AI configuration must never affect article difficulty metadata.
 */
export async function assessDifficulty(
  title: string,
  content: string,
): Promise<DeterministicDifficultyResult & { source: "deterministic" }> {
  void title;
  return { ...deterministicDifficulty(content), source: "deterministic" };
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
      lexileApprox: true,
      difficultyVersion: true,
    } satisfies Prisma.ArticleSelect;
  const article = isArticleOperator(context)
    ? await prisma.article.findUnique({ where: { id: articleId }, select })
    : await getAiProcessableArticleById(articleId, context, { select });
  if (!article) {
    return null;
  }

  if (
    isDifficultyLevel(article.difficulty) &&
    article.lexileApprox != null &&
    article.difficultyVersion === DIFFICULTY_ALGORITHM_VERSION
  ) {
    return {
      articleId,
      level: article.difficulty,
      score: article.difficultyScore ?? levelToScore(article.difficulty),
      lexileApprox: article.lexileApprox,
      confidence: "medium",
      version: article.difficultyVersion,
      source: "cache",
    };
  }

  const assessed = await assessDifficulty(article.title, article.content);
  await prisma.article.update({
    where: { id: articleId },
    data: {
      difficulty: assessed.level,
      difficultyScore: assessed.score,
      lexileApprox: assessed.lexileApprox,
      difficultyVersion: assessed.version,
    },
  });
  return { articleId, ...assessed };
}

type ArticleLike = {
  id: string;
  title: string;
  content: string;
  difficulty: string | null;
  difficultyScore: number | null;
  lexileApprox?: number | null;
  difficultyVersion?: string | null;
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
    if (
      isDifficultyLevel(article.difficulty) &&
      article.lexileApprox != null &&
      article.difficultyVersion === DIFFICULTY_ALGORITHM_VERSION
    ) {
      map.set(article.id, {
        articleId: article.id,
        level: article.difficulty,
        score: article.difficultyScore ?? levelToScore(article.difficulty),
        lexileApprox: article.lexileApprox,
        confidence: "medium",
        version: article.difficultyVersion,
        source: "cache",
      });
      continue;
    }
    const assessed = deterministicDifficulty(article.content);
    article.difficulty = assessed.level;
    article.difficultyScore = assessed.score;
    article.lexileApprox = assessed.lexileApprox;
    article.difficultyVersion = assessed.version;
    map.set(article.id, {
      articleId: article.id,
      level: assessed.level,
      score: assessed.score,
      lexileApprox: assessed.lexileApprox,
      confidence: assessed.confidence,
      version: assessed.version,
      source: "deterministic",
    });
    writes.push(
      prisma.article.update({
        where: { id: article.id },
        data: {
          difficulty: assessed.level,
          difficultyScore: assessed.score,
          lexileApprox: assessed.lexileApprox,
          difficultyVersion: assessed.version,
        },
      }),
    );
  }

  if (writes.length > 0) {
    await Promise.all(writes);
  }
  return map;
}
