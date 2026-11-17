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
import type { Article } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  CAPABILITIES,
  MEMBERSHIP_ROLES,
  membershipHasCapability,
  roleHasCapability,
} from "@/lib/rbac";
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

/** Membership roles that make someone a teacher for answer-key purposes. */
const TEACHING_MEMBERSHIP_ROLES = MEMBERSHIP_ROLES.filter((role) =>
  membershipHasCapability(role, CAPABILITIES.classroomManage),
);

/** True for teachers, content staff, and platform super-users. */
export async function canPrintAnswerKey(user: { id: string; role?: string | null }): Promise<boolean> {
  if (
    roleHasCapability(user.role, CAPABILITIES.articlesManage) ||
    roleHasCapability(user.role, CAPABILITIES.platformSuperuser)
  ) {
    return true;
  }
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, role: { in: [...TEACHING_MEMBERSHIP_ROLES] } },
    select: { id: true },
  });
  return membership !== null;
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
  options: { accessedAt?: Date } = {},
): Promise<PrintableArticle | null> {
  const article = await getReadableArticleById(articleId, await articleAccessContextForUser(user));
  if (!article) return null;
  if (article.takedownState !== "active") {
    return { restricted: true, article: { id: article.id, title: article.title } };
  }

  const includeStudyMaterials = mode !== "article";
  const [quiz, vocabulary] = includeStudyMaterials
    ? await Promise.all([readCachedQuiz(article.id), readCachedVocabulary(article.id)])
    : [null, null];

  return {
    restricted: false,
    article: { id: article.id, title: article.title, author: article.author, source: article.source },
    bodyHtml: sanitizeArticleHtml(article.content),
    rightsNote: article.rightsNote?.trim() || null,
    citation: formatCitation(articleCitationSource(article), "mla", options),
    quiz: quiz ?? [],
    vocabulary: vocabulary ?? [],
  };
}
