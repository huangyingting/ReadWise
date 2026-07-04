/**
 * Article access policy — visibility predicates, Prisma WHERE builders, and
 * single-row fetch helpers (article-library subsystem, REF-040).
 *
 * Public-listable: `visibility === PUBLIC && status === PUBLISHED && ownerId === null`;
 * visible in anonymous metadata, public/library feeds, browse, tags, and
 * unauthenticated lookups.
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
import { prisma } from "@/lib/prisma";
import { hasCapability, CAPABILITIES } from "@/lib/rbac";
import {
  ArticleStatus,
  ArticleVisibility,
  ArticleSourceType,
  type Article,
  type Prisma,
} from "@prisma/client";
import { orgScopedArticleWhere } from "./tenant-integrity";

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
const PUBLIC_LIBRARY_SOURCE_URL_CHUNK_SIZE = 500;

export const SYSTEM_ARTICLE_CONTEXT: ArticleAccessContext = { role: "System" };

export function articleAccessContext(
  user?: ArticleAccessUser | null,
  orgId?: string | null,
): ArticleAccessContext {
  return {
    userId: user?.id ?? null,
    role: user?.role ?? null,
    ...(orgId ? { orgId } : {}),
  };
}

export function isArticleOperator(context?: ArticleAccessContext | null): boolean {
  return hasCapability(context, CAPABILITIES.adminAccess);
}

type ArticleVisibilityShape = Pick<
  Article,
  "status" | "visibility" | "ownerId" | "organizationId"
>;

function isOwnedPrivateArticle(
  article: Pick<Article, "visibility" | "ownerId">,
  userId?: string | null,
): boolean {
  return Boolean(
    userId &&
      article.visibility === ArticleVisibility.PRIVATE &&
      article.ownerId === userId,
  );
}

function publicListableAccessWhere(): Prisma.ArticleWhereInput {
  return {
    visibility: ArticleVisibility.PUBLIC,
    status: ArticleStatus.PUBLISHED,
    ownerId: null,
    organizationId: null,
  };
}

function ownedPrivateAccessWhere(userId: string): Prisma.ArticleWhereInput {
  return { visibility: ArticleVisibility.PRIVATE, ownerId: userId };
}

export function isPublicListableArticle(article: ArticleVisibilityShape): boolean {
  return (
    article.visibility === ArticleVisibility.PUBLIC &&
    article.status === ArticleStatus.PUBLISHED &&
    article.ownerId === null &&
    article.organizationId === null
  );
}

function canReadOrgArticle(
  article: ArticleVisibilityShape,
  orgId?: string | null,
): boolean {
  return Boolean(
    orgId &&
      article.visibility === ArticleVisibility.ORG &&
      article.status === ArticleStatus.PUBLISHED &&
      article.organizationId === orgId,
  );
}

export function canReadArticle(
  article: ArticleVisibilityShape,
  context?: ArticleAccessContext | null,
): boolean {
  if (isArticleOperator(context)) return true;
  if (isOwnedPrivateArticle(article, context?.userId)) {
    return true;
  }
  if (canReadOrgArticle(article, context?.orgId ?? context?.tenantId)) {
    return true;
  }
  return isPublicListableArticle(article);
}

export function canEditArticle(
  article: Pick<Article, "visibility" | "ownerId">,
  context?: ArticleAccessContext | null,
): boolean {
  if (isArticleOperator(context)) return true;
  return isOwnedPrivateArticle(article, context?.userId);
}

export function canAdminViewArticles(context?: ArticleAccessContext | null): boolean {
  return isArticleOperator(context);
}

export function canAiProcessArticle(
  article: ArticleVisibilityShape,
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
  return {
    ...(extra ?? {}),
    ...publicListableAccessWhere(),
  };
}

export function ownedArticleWhere(
  userId: string,
  extra?: Prisma.ArticleWhereInput,
): Prisma.ArticleWhereInput {
  return { ...(extra ?? {}), ...ownedPrivateAccessWhere(userId) };
}

export function publicLibraryArticleWhere(
  extra?: Prisma.ArticleWhereInput,
): Prisma.ArticleWhereInput {
  return {
    ...(extra ?? {}),
    visibility: ArticleVisibility.PUBLIC,
    ownerId: null,
    organizationId: null,
  };
}

export function readableArticleWhere(
  context?: ArticleAccessContext | null,
  extra?: Prisma.ArticleWhereInput,
): Prisma.ArticleWhereInput {
  if (isArticleOperator(context)) return andWhere({}, extra);
  const orgId = context?.orgId ?? context?.tenantId ?? null;
  if (context?.userId || orgId) {
    const accessOr: Prisma.ArticleWhereInput[] = [publicListableAccessWhere()];
    if (context?.userId) {
      accessOr.push(ownedPrivateAccessWhere(context.userId));
    }
    if (orgId) {
      accessOr.push(orgScopedArticleWhere(orgId));
    }
    const access = {
      OR: accessOr,
    };
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

function findFirstMaybeSelected<T extends Prisma.ArticleSelect>(
  where: Prisma.ArticleWhereInput,
  options?: ArticleFindOptions<T>,
): Promise<Article | ArticleSelectResult<T> | null> {
  return options ? findFirstArticle(where, options) : findFirstArticle(where);
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
  return findFirstMaybeSelected(publicListableArticleWhere({ id }), options);
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
  return findFirstMaybeSelected(where, options);
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
  return findFirstMaybeSelected(where, options);
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
  return findFirstMaybeSelected(where, options);
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
  return findFirstMaybeSelected(where, options);
}

export function loadAiProcessableArticleText(
  articleId: string,
  context: ArticleAccessContext | null = SYSTEM_ARTICLE_CONTEXT,
): Promise<{ title: string; content: string } | null> {
  // Operators (Admin/System) bypass visibility filtering and load any article
  // by id directly. Centralizing this short-circuit here lets AI helpers call a
  // single loader instead of wrapping it.
  if (isArticleOperator(context)) {
    return prisma.article.findUnique({
      where: { id: articleId },
      select: { title: true, content: true },
    });
  }
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
    where: publicLibraryArticleWhere({ sourceUrl }),
    select: { id: true },
  });
}

export async function findExistingPublicLibrarySourceUrls(
  sourceUrls: string[],
): Promise<Set<string>> {
  const uniqueSourceUrls = [...new Set(sourceUrls)];
  if (uniqueSourceUrls.length === 0) return new Set();

  const existing = new Set<string>();
  for (let i = 0; i < uniqueSourceUrls.length; i += PUBLIC_LIBRARY_SOURCE_URL_CHUNK_SIZE) {
    const chunk = uniqueSourceUrls.slice(i, i + PUBLIC_LIBRARY_SOURCE_URL_CHUNK_SIZE);
    const articles = await prisma.article.findMany({
      where: publicLibraryArticleWhere({ sourceUrl: { in: chunk } }),
      select: { sourceUrl: true },
    });
    for (const article of articles) {
      if (article.sourceUrl) existing.add(article.sourceUrl);
    }
  }

  return existing;
}

export const ARTICLE_STATUSES = [
  ArticleStatus.DRAFT,
  ArticleStatus.PROCESSING,
  ArticleStatus.PUBLISHED,
  ArticleStatus.FAILED,
  ArticleStatus.ARCHIVED,
] as const;

export const PUBLIC_ARTICLE_CREATE_FIELDS = {
  visibility: ArticleVisibility.PUBLIC,
  sourceType: ArticleSourceType.SCRAPED,
} as const;

export function privateImportedArticleCreateFields(ownerId: string) {
  return {
    visibility: ArticleVisibility.PRIVATE,
    sourceType: ArticleSourceType.IMPORTED,
    ownerId,
  } as const;
}
