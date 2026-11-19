/**
 * Printable classroom packets for the Reader (#1306).
 *
 * Three modes: `article` (the article only), `worksheet` (article + stored
 * vocabulary + quiz with a bubble sheet and a written response), and
 * `answer-key` (worksheet + the teacher answer key). The answer key is gated
 * to teachers (a membership granting `classroom.manage` in any organization),
 * content staff (`articles.manage`), and platform super-users.
 *
 * Only stored study material is printed — printing never triggers an AI call;
 * an article without a generated quiz or vocabulary simply omits that section.
 * Articles under a non-active rights/takedown state are never printed (the
 * caller gets `restricted: true`), and any `rightsNote` is carried onto the
 * page.
 */
import { isEducator } from "@/lib/classroom/educator";
import {
  articleAccessContextForUser,
  getReadableArticleById,
  type ArticleAccessUser,
} from "@/lib/article-library";
import { sanitizeArticleHtml } from "@/lib/content-pipeline";
import { readCachedQuiz, type QuizQuestion } from "@/lib/quiz";
import { readCachedVocabulary, type VocabularyEntry } from "@/lib/vocabulary/service";
import { articleCitationSource, formatCitation, type Citation } from "@/lib/citations";
import type { PrintMode } from "./print-modes";
import { ORIGINAL_LEVEL, type ReadingLevelKey } from "@/lib/article-levels/levels";
import { getArticleLevelVariant } from "@/lib/article-levels/variants";

/** True for teachers, content staff, and platform super-users. */
export function canPrintAnswerKey(user: { id: string; role?: string | null }): Promise<boolean> {
  return isEducator(user);
}

export type PrintableArticle =
  | { restricted: true; article: { id: string; title: string } }
  | {
      restricted: false;
      article: { id: string; title: string; author: string | null; source: string | null };
      /** Sanitized article HTML (the same sanitizer the Reader renders). */
      bodyHtml: string;
      rightsNote: string | null;
      /** MLA citation printed as the packet's source line. */
      citation: Citation;
      quiz: QuizQuestion[];
      vocabulary: VocabularyEntry[];
    };

/**
 * Loads an article the user may read, prepared for printing in `mode`.
 * Returns null when the article does not exist or is not readable.
 */
export async function loadPrintableArticle(
  articleId: string,
  user: ArticleAccessUser & { id: string },
  mode: PrintMode,
  options: { accessedAt?: Date; level?: ReadingLevelKey } = {},
): Promise<PrintableArticle | null> {
  const article = await getReadableArticleById(articleId, await articleAccessContextForUser(user));
  if (!article) return null;
  if (article.takedownState !== "active") {
    return { restricted: true, article: { id: article.id, title: article.title } };
  }

  // An adapted reading level (#1303) prints its own title, text, and quiz;
  // unknown levels fall back to the original. The citation stays canonical.
  const variant = options.level ? await getArticleLevelVariant(article.id, options.level) : null;
  const levelKey = variant?.levelKey ?? ORIGINAL_LEVEL;
  const includeStudyMaterials = mode === "worksheet" || mode === "answer-key";
  const [quiz, vocabulary] = includeStudyMaterials
    ? await Promise.all([readCachedQuiz(article.id, levelKey), readCachedVocabulary(article.id)])
    : [null, null];

  return {
    restricted: false,
    article: { id: article.id, title: variant?.title ?? article.title, author: article.author, source: article.source },
    bodyHtml: sanitizeArticleHtml(variant?.content ?? article.content),
    rightsNote: article.rightsNote?.trim() || null,
    citation: formatCitation(articleCitationSource(article), "mla", options),
    quiz: quiz ?? [],
    vocabulary: vocabulary ?? [],
  };
}
