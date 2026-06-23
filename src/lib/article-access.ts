import { prisma } from "@/lib/prisma";
import type { Article, Prisma } from "@prisma/client";

/**
 * Central article access rules.
 *
 * Public-listable: `status === "published" && ownerId === null`; visible in
 * anonymous metadata, public/library feeds, browse, tags, and unauthenticated
 * lookups.
 * Readable: Admin/System can read any article; an authenticated reader can read
 * public-listable articles plus articles they own; anonymous callers can read
 * only public-listable articles.
 * Editable: Admin/System can edit any article; readers can edit only articles
 * they own. Anonymous callers cannot edit.
 * Admin-visible: only Admin/System can see the back-office article universe.
 * AI-processable: Admin/System can process any article; reader-triggered AI
 * actions are limited to the same article set the reader can read.
 *
 * The context shape intentionally leaves room for tenant/org scoping. When that
 * is introduced, add the tenant predicate in this module so callers inherit it.
 */
export type ArticleAccessContext = {
  userId?: string | null;
  role?: string | null;
  tenantId?: string | null;
  orgId?: string | null;
};

export type ArticleAccessUser = {
  id?: string | null;
  role?: string | null;
};

const DENIED_WHERE: Prisma.ArticleWhereInput = { id: "__readwise_article_access_denied__" };

export const SYSTEM_ARTICLE_CONTEXT: ArticleAccessContext = { role: "System" };

export function articleAccessContext(user?: ArticleAccessUser | null): ArticleAccessContext {
  return { userId: user?.id ?? null, role: user?.role ?? null };
}

export function isArticleOperator(context?: ArticleAccessContext | null): boolean {
  return context?.role === "Admin" || context?.role === "System";
}

export function isPublicListableArticle(article: Pick<Article, "status" | "ownerId">): boolean {
  return article.status === "published" && article.ownerId === null;
}

export function canReadArticle(
  article: Pick<Article, "status" | "ownerId">,
  context?: ArticleAccessContext | null,
): boolean {
  if (isArticleOperator(context)) return true;
  if (context?.userId && article.ownerId === context.userId) return true;
  return isPublicListableArticle(article);
}

export function canEditArticle(
  article: Pick<Article, "ownerId">,
  context?: ArticleAccessContext | null,
): boolean {
  if (isArticleOperator(context)) return true;
  return Boolean(context?.userId && article.ownerId === context.userId);
}

export function canAdminViewArticles(context?: ArticleAccessContext | null): boolean {
  return isArticleOperator(context);
}

export function canAiProcessArticle(
  article: Pick<Article, "status" | "ownerId">,
  context?: ArticleAccessContext | null,
): boolean {
  return canReadArticle(article, context);
}

function andWhere(
  access: Prisma.ArticleWhereInput,
  extra?: Prisma.ArticleWhereInput,
): Prisma.ArticleWhereInput {
  if (!extra || Object.keys(extra).length === 0) return access;
  if (Object.keys(access).length === 0) return extra;
  return { AND: [access, extra] };
}

export function publicListableArticleWhere(
  extra?: Prisma.ArticleWhereInput,
): Prisma.ArticleWhereInput {
  return { ...(extra ?? {}), status: "published", ownerId: null };
}

export function ownedArticleWhere(
  userId: string,
  extra?: Prisma.ArticleWhereInput,
): Prisma.ArticleWhereInput {
  return { ...(extra ?? {}), ownerId: userId };
}

export function readableArticleWhere(
  context?: ArticleAccessContext | null,
  extra?: Prisma.ArticleWhereInput,
): Prisma.ArticleWhereInput {
  if (isArticleOperator(context)) return andWhere({}, extra);
  if (context?.userId) {
    const access = { OR: [{ status: "published", ownerId: null }, { ownerId: context.userId }] };
    if (extra?.OR || extra?.AND) {
      return andWhere(access, extra);
    }
    return { ...(extra ?? {}), ...access };
  }
  return publicListableArticleWhere(extra);
}

export function editableArticleWhere(
  context?: ArticleAccessContext | null,
  extra?: Prisma.ArticleWhereInput,
): Prisma.ArticleWhereInput {
  if (isArticleOperator(context)) return andWhere({}, extra);
  if (context?.userId) return ownedArticleWhere(context.userId, extra);
  return DENIED_WHERE;
}

export function adminVisibleArticleWhere(
  context?: ArticleAccessContext | null,
  extra?: Prisma.ArticleWhereInput,
): Prisma.ArticleWhereInput {
  if (!canAdminViewArticles(context)) return DENIED_WHERE;
  return andWhere({}, extra);
}

export function aiProcessableArticleWhere(
  context?: ArticleAccessContext | null,
  extra?: Prisma.ArticleWhereInput,
): Prisma.ArticleWhereInput {
  return readableArticleWhere(context, extra);
}

type ArticleSelectResult<T extends Prisma.ArticleSelect> = Prisma.ArticleGetPayload<{ select: T }>;

type ArticleFindOptions<T extends Prisma.ArticleSelect> = { select: T };

async function findFirstArticle<T extends Prisma.ArticleSelect>(
  where: Prisma.ArticleWhereInput,
  options: ArticleFindOptions<T>,
): Promise<ArticleSelectResult<T> | null>;
async function findFirstArticle(
  where: Prisma.ArticleWhereInput,
): Promise<Article | null>;
async function findFirstArticle<T extends Prisma.ArticleSelect>(
  where: Prisma.ArticleWhereInput,
  options?: ArticleFindOptions<T>,
): Promise<Article | ArticleSelectResult<T> | null> {
  return prisma.article.findFirst({
    where,
    ...(options?.select ? { select: options.select } : {}),
  }) as Promise<Article | ArticleSelectResult<T> | null>;
}

export function getPublicListableArticleById<T extends Prisma.ArticleSelect>(
  id: string,
  options: ArticleFindOptions<T>,
): Promise<ArticleSelectResult<T> | null>;
export function getPublicListableArticleById(id: string): Promise<Article | null>;
export function getPublicListableArticleById<T extends Prisma.ArticleSelect>(
  id: string,
  options?: ArticleFindOptions<T>,
): Promise<Article | ArticleSelectResult<T> | null> {
  return options
    ? findFirstArticle(publicListableArticleWhere({ id }), options)
    : findFirstArticle(publicListableArticleWhere({ id }));
}

export function getReadableArticleById<T extends Prisma.ArticleSelect>(
  id: string,
  context: ArticleAccessContext | null | undefined,
  options: ArticleFindOptions<T>,
): Promise<ArticleSelectResult<T> | null>;
export function getReadableArticleById(
  id: string,
  context?: ArticleAccessContext | null,
): Promise<Article | null>;
export function getReadableArticleById<T extends Prisma.ArticleSelect>(
  id: string,
  context?: ArticleAccessContext | null,
  options?: ArticleFindOptions<T>,
): Promise<Article | ArticleSelectResult<T> | null> {
  const where = readableArticleWhere(context, { id });
  return options ? findFirstArticle(where, options) : findFirstArticle(where);
}

export function getEditableArticleById<T extends Prisma.ArticleSelect>(
  id: string,
  context: ArticleAccessContext | null | undefined,
  options: ArticleFindOptions<T>,
): Promise<ArticleSelectResult<T> | null>;
export function getEditableArticleById(
  id: string,
  context?: ArticleAccessContext | null,
): Promise<Article | null>;
export function getEditableArticleById<T extends Prisma.ArticleSelect>(
  id: string,
  context?: ArticleAccessContext | null,
  options?: ArticleFindOptions<T>,
): Promise<Article | ArticleSelectResult<T> | null> {
  const where = editableArticleWhere(context, { id });
  return options ? findFirstArticle(where, options) : findFirstArticle(where);
}

export function getAdminVisibleArticleById<T extends Prisma.ArticleSelect>(
  id: string,
  context: ArticleAccessContext | null | undefined,
  options: ArticleFindOptions<T>,
): Promise<ArticleSelectResult<T> | null>;
export function getAdminVisibleArticleById(
  id: string,
  context?: ArticleAccessContext | null,
): Promise<Article | null>;
export function getAdminVisibleArticleById<T extends Prisma.ArticleSelect>(
  id: string,
  context?: ArticleAccessContext | null,
  options?: ArticleFindOptions<T>,
): Promise<Article | ArticleSelectResult<T> | null> {
  const where = adminVisibleArticleWhere(context, { id });
  return options ? findFirstArticle(where, options) : findFirstArticle(where);
}

export function getAiProcessableArticleById<T extends Prisma.ArticleSelect>(
  id: string,
  context: ArticleAccessContext | null | undefined,
  options: ArticleFindOptions<T>,
): Promise<ArticleSelectResult<T> | null>;
export function getAiProcessableArticleById(
  id: string,
  context?: ArticleAccessContext | null,
): Promise<Article | null>;
export function getAiProcessableArticleById<T extends Prisma.ArticleSelect>(
  id: string,
  context?: ArticleAccessContext | null,
  options?: ArticleFindOptions<T>,
): Promise<Article | ArticleSelectResult<T> | null> {
  const where = aiProcessableArticleWhere(context, { id });
  return options ? findFirstArticle(where, options) : findFirstArticle(where);
}

export function loadAiProcessableArticleText(
  articleId: string,
  context?: ArticleAccessContext | null,
): Promise<{ title: string; content: string } | null> {
  return getAiProcessableArticleById(articleId, context, {
    select: { title: true, content: true },
  });
}

export function findOwnedArticleBySourceUrl(
  sourceUrl: string,
  userId: string,
): Promise<{ id: string } | null> {
  return prisma.article.findFirst({
    where: ownedArticleWhere(userId, { sourceUrl }),
    select: { id: true },
  });
}

export function findPublicLibraryArticleBySourceUrl(
  sourceUrl: string,
): Promise<{ id: string } | null> {
  return prisma.article.findFirst({
    where: { sourceUrl, ownerId: null },
    select: { id: true },
  });
}
