/**
 * Annotation and saved-word article-ID lookup for the search subsystem.
 *
 * Queries the requesting user's highlights and saved-word vocabulary to find
 * article IDs that should be included in (or boosted within) search results.
 */
import { prisma } from "@/lib/prisma";
import { highlightTextWhere, savedWordTextWhere } from "@/lib/search/query";

export type AnnotationArticleIds = {
  highlightIds: string[];
  savedWordIds: string[];
};

const emptyAnnotationArticleIds = (): AnnotationArticleIds => ({
  highlightIds: [],
  savedWordIds: [],
});

const unique = <T>(values: T[]): T[] => [...new Set(values)];

const isPresent = <T>(value: T | null | undefined): value is T => value != null;

/**
 * Returns article IDs matched by the user's highlights and saved vocabulary.
 * Returns empty arrays when no userId is provided (anonymous sessions).
 */
export async function userAnnotationArticleIds(
  userId: string | null | undefined,
  terms: string[],
  take: number,
): Promise<AnnotationArticleIds> {
  if (!userId) return emptyAnnotationArticleIds();
  const [highlightMatches, vocabMatches] = await Promise.all([
    prisma.highlight.findMany({
      where: { userId, ...highlightTextWhere(terms) },
      select: { articleId: true },
      distinct: ["articleId"],
      take,
    }),
    prisma.savedWord.findMany({
      where: { userId, articleId: { not: null }, ...savedWordTextWhere(terms) },
      select: { articleId: true },
      take,
    }),
  ]);
  return {
    highlightIds: unique(highlightMatches.map(({ articleId }) => articleId)),
    savedWordIds: unique(vocabMatches.map(({ articleId }) => articleId).filter(isPresent)),
  };
}
