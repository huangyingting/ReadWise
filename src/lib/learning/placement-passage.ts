/**
 * Placement passage selection (#806).
 *
 * @server-only — reads Prisma. Picks a short public-library article keyed to a
 * self-reported seed level (`A2` | `B1` | `B2`) that has at least
 * {@link MIN_PLACEMENT_QUESTIONS} existing quiz questions, so the cold-start
 * placement can reuse curated content with NO new content table.
 *
 * The passage + question text returned here is SENT to the client to render and
 * self-score; it is NEVER persisted. Only structured counts come back through
 * `POST /api/placement` (see {@link computePlacementScore}).
 */

import { prisma } from "@/lib/prisma";
import { publicListableArticleWhere } from "@/lib/article-library";
import { parseStringArray } from "@/lib/learning/primitives";
import type { PlacementSeedLevel } from "@/lib/learning/placement";

/** Minimum quiz questions an article needs to back a placement passage. */
export const MIN_PLACEMENT_QUESTIONS = 3;
/** Maximum questions surfaced to the learner (roadmap: 3–5). */
export const MAX_PLACEMENT_QUESTIONS = 5;
/** Candidate articles scanned per seed level before giving up. */
const PASSAGE_CANDIDATE_LIMIT = 12;

/** One multiple-choice question rendered during placement (text NOT stored). */
export type PlacementQuestionDto = {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
};

/** A renderable placement passage with its self-scoring questions. */
export type PlacementPassage = {
  articleId: string;
  seedLevel: PlacementSeedLevel;
  title: string;
  excerpt: string | null;
  wordCount: number;
  questions: PlacementQuestionDto[];
};

/** Coerce a stored `options` Json blob into a clean string array. */
function parseOptions(raw: unknown): string[] {
  return parseStringArray(raw).filter((o) => o.length > 0);
}

/**
 * Selects a placement passage for the given seed level, or `null` when the
 * public library has no eligible article (graceful fallback — the UI then
 * simply skips placement). Scans the freshest candidates at the seed difficulty
 * and returns the first with enough valid quiz questions.
 */
export async function loadPlacementPassage(
  seedLevel: PlacementSeedLevel,
): Promise<PlacementPassage | null> {
  const candidates = await prisma.article.findMany({
    where: publicListableArticleWhere({ difficulty: seedLevel }),
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: PASSAGE_CANDIDATE_LIMIT,
    select: {
      id: true,
      title: true,
      excerpt: true,
      wordCount: true,
    },
  });
  if (candidates.length === 0) return null;

  for (const article of candidates) {
    const questionRows = await prisma.quizQuestion.findMany({
      where: { articleId: article.id },
      orderBy: { createdAt: "asc" },
      take: MAX_PLACEMENT_QUESTIONS,
      select: { id: true, question: true, options: true, correctIndex: true },
    });

    const questions: PlacementQuestionDto[] = questionRows
      .map((q) => ({
        id: q.id,
        question: q.question,
        options: parseOptions(q.options),
        correctIndex: q.correctIndex,
      }))
      .filter(
        (q) => q.options.length >= 2 && q.correctIndex >= 0 && q.correctIndex < q.options.length,
      );

    if (questions.length >= MIN_PLACEMENT_QUESTIONS) {
      return {
        articleId: article.id,
        seedLevel,
        title: article.title,
        excerpt: article.excerpt,
        wordCount: article.wordCount ?? 0,
        questions,
      };
    }
  }

  return null;
}
