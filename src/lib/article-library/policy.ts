/**
 * Article access policy — visibility predicates, Prisma/SQL renderers, and
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
import { isPlatformSuperuser } from "@/lib/rbac";
import {
  ArticleStatus,
  ArticleVisibility,
  ArticleSourceType,
  Prisma,
  type Article,
} from "@prisma/client";

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
  return isPlatformSuperuser(context);
}

type ArticleVisibilityShape = Pick<
  Article,
  "status" | "visibility" | "ownerId" | "organizationId"
>;

type ReadableArticleRule = Readonly<Partial<ArticleVisibilityShape>>;

type ReadableArticlePolicy = {
  unrestricted: boolean;
  anyOf: readonly ReadableArticleRule[];
};

const PUBLIC_LISTABLE_RULE = {
  visibility: ArticleVisibility.PUBLIC,
  status: ArticleStatus.PUBLISHED,
  ownerId: null,
  organizationId: null,
} as const satisfies ReadableArticleRule;

function ownedPrivateRule(userId: string): ReadableArticleRule {
  return { visibility: ArticleVisibility.PRIVATE, ownerId: userId };
}

function organizationReadableRule(orgId: string): ReadableArticleRule {
  return {
    visibility: ArticleVisibility.ORG,
    status: ArticleStatus.PUBLISHED,
    organizationId: orgId,
  };
}

function readableArticlePolicy(
  context?: ArticleAccessContext | null,
): ReadableArticlePolicy {
  if (isArticleOperator(context)) {
    return { unrestricted: true, anyOf: [] };
  }

  const anyOf: ReadableArticleRule[] = [PUBLIC_LISTABLE_RULE];
  if (context?.userId) {
    anyOf.push(ownedPrivateRule(context.userId));
  }
  const orgId = context?.orgId ?? context?.tenantId ?? null;
  if (orgId) {
    anyOf.push(organizationReadableRule(orgId));
  }
  return { unrestricted: false, anyOf };
}

function matchesReadableArticleRule(
  article: Partial<ArticleVisibilityShape>,
  rule: ReadableArticleRule,
): boolean {
  return (
    (rule.status === undefined || article.status === rule.status) &&
    (rule.visibility === undefined || article.visibility === rule.visibility) &&
    (rule.ownerId === undefined || article.ownerId === rule.ownerId) &&
    (rule.organizationId === undefined ||
      article.organizationId === rule.organizationId)
  );
}

function publicListableAccessWhere(): Prisma.ArticleWhereInput {
  return { ...PUBLIC_LISTABLE_RULE };
}

function ownedPrivateAccessWhere(userId: string): Prisma.ArticleWhereInput {
  return { ...ownedPrivateRule(userId) };
}

export function orgScopedArticleWhere(
  orgId: string,
  extra?: Prisma.ArticleWhereInput,
): Prisma.ArticleWhereInput {
  return { ...(extra ?? {}), ...organizationReadableRule(orgId) };
}

export function isPublicListableArticle(article: ArticleVisibilityShape): boolean {
  return matchesReadableArticleRule(article, PUBLIC_LISTABLE_RULE);
}

export function canReadArticle(
  article: ArticleVisibilityShape,
  context?: ArticleAccessContext | null,
): boolean {
  const policy = readableArticlePolicy(context);
  return (
    policy.unrestricted ||
    policy.anyOf.some((rule) => matchesReadableArticleRule(article, rule))
  );
}

export function canEditArticle(
  article: Pick<Article, "visibility" | "ownerId">,
  context?: ArticleAccessContext | null,
): boolean {
  if (isArticleOperator(context)) return true;
  return Boolean(
    context?.userId &&
      matchesReadableArticleRule(article, ownedPrivateRule(context.userId)),
  );
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

function readableArticlePolicyWhere(
  policy: ReadableArticlePolicy,
): Prisma.ArticleWhereInput {
  if (policy.unrestricted) return {};
  const branches = policy.anyOf.map((rule) => ({ ...rule }));
  return branches.length === 1 ? branches[0] : { OR: branches };
}

const ARTICLE_STATUS_SQL_VALUE: Record<ArticleStatus, string> = {
  [ArticleStatus.DRAFT]: "draft",
  [ArticleStatus.PROCESSING]: "processing",
  [ArticleStatus.PUBLISHED]: "published",
  [ArticleStatus.FAILED]: "failed",
  [ArticleStatus.ARCHIVED]: "archived",
};

function readableArticleRuleSql(rule: ReadableArticleRule): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];
  if (rule.status !== undefined) {
    clauses.push(
      Prisma.sql`a.status = ${ARTICLE_STATUS_SQL_VALUE[rule.status]}::"ArticleStatus"`,
    );
  }
  if (rule.visibility !== undefined) {
    clauses.push(Prisma.sql`a.visibility = ${rule.visibility}::"ArticleVisibility"`);
  }
  if (rule.ownerId !== undefined) {
    clauses.push(
      rule.ownerId === null
        ? Prisma.sql`a."ownerId" IS NULL`
        : Prisma.sql`a."ownerId" = ${rule.ownerId}`,
    );
  }
  if (rule.organizationId !== undefined) {
    clauses.push(
      rule.organizationId === null
        ? Prisma.sql`a."organizationId" IS NULL`
        : Prisma.sql`a."organizationId" = ${rule.organizationId}`,
    );
  }
  if (clauses.length === 0) return Prisma.sql`TRUE`;
  return Prisma.sql`(${Prisma.join(clauses, " AND ")})`;
}

export function readableArticleSqlPredicate(
  context?: ArticleAccessContext | null,
): Prisma.Sql {
  const policy = readableArticlePolicy(context);
  if (policy.unrestricted) return Prisma.sql`TRUE`;
  const branches = policy.anyOf.map(readableArticleRuleSql);
  if (branches.length === 1) return branches[0];
  return Prisma.sql`(${Prisma.join(branches, " OR ")})`;
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
  const policy = readableArticlePolicy(context);
  if (policy.unrestricted) return andWhere({}, extra);
  const access = readableArticlePolicyWhere(policy);
  if (policy.anyOf.length > 1 && (extra?.OR || extra?.AND)) {
    return andWhere(access, extra);
  }
  return { ...(extra ?? {}), ...access };
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
