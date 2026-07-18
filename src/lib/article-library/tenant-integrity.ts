import {
  ArticleVisibility,
  type Article,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ArticleOrganizationOperation = "create" | "update" | "read" | "delete";

export type ArticleOrganizationScope = Pick<
  Article,
  "id" | "visibility" | "organizationId"
>;

export type ArticleOrganizationIntegrityReason =
  | "org_visibility_without_org"
  | "org_reference_without_org_visibility"
  | "org_reference_mismatch"
  | "org_reference_orphaned";

export type ArticleOrganizationIntegrityIssue = {
  articleId: string;
  operation: ArticleOrganizationOperation;
  reason: ArticleOrganizationIntegrityReason;
  organizationId: string | null;
};

type OrganizationLookupClient = {
  organization: {
    findUnique(args: {
      where: { id: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
};

type IntegrityScanClient = {
  article: {
    findMany(args: {
      where: Prisma.ArticleWhereInput;
      select: { id: true; visibility: true; organizationId: true };
    }): Promise<ArticleOrganizationScope[]>;
  };
  organization: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true };
    }): Promise<Array<{ id: string }>>;
  };
};

function articleIdOf(article: ArticleOrganizationScope): string {
  return article.id || "unknown";
}

function issue(
  article: ArticleOrganizationScope,
  operation: ArticleOrganizationOperation,
  reason: ArticleOrganizationIntegrityReason,
): ArticleOrganizationIntegrityIssue {
  return {
    articleId: articleIdOf(article),
    operation,
    reason,
    organizationId: article.organizationId ?? null,
  };
}

export function isOrganizationScopedArticle(
  article: Pick<Article, "visibility" | "organizationId">,
): boolean {
  return article.visibility === ArticleVisibility.ORG || article.organizationId !== null;
}

export function articleOrganizationIntegrityIssues(
  article: ArticleOrganizationScope,
  operation: ArticleOrganizationOperation,
  expectedOrgId?: string | null,
): ArticleOrganizationIntegrityIssue[] {
  const issues: ArticleOrganizationIntegrityIssue[] = [];
  const organizationId = article.organizationId ?? null;

  if (article.visibility === ArticleVisibility.ORG && !organizationId) {
    issues.push(issue(article, operation, "org_visibility_without_org"));
  }
  if (organizationId && article.visibility !== ArticleVisibility.ORG) {
    issues.push(issue(article, operation, "org_reference_without_org_visibility"));
  }
  if (organizationId && expectedOrgId && organizationId !== expectedOrgId) {
    issues.push(issue(article, operation, "org_reference_mismatch"));
  }

  return issues;
}

export async function validateArticleOrganizationIntegrity(
  article: ArticleOrganizationScope,
  operation: ArticleOrganizationOperation,
  opts: {
    expectedOrgId?: string | null;
    client?: OrganizationLookupClient;
  } = {},
): Promise<ArticleOrganizationIntegrityIssue[]> {
  const issues = articleOrganizationIntegrityIssues(article, operation, opts.expectedOrgId);
  if (issues.length > 0) return issues;

  const organizationId = article.organizationId ?? null;
  if (!organizationId) return [];

  const client = opts.client ?? prisma;
  const org = await client.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  return org ? [] : [issue(article, operation, "org_reference_orphaned")];
}

export type OrganizationAssignableArticleResult =
  | {
      ok: true;
      article: ArticleOrganizationScope;
    }
  | {
      ok: false;
      status: 404 | 409;
      reason: "article_not_found" | ArticleOrganizationIntegrityReason;
    };

export async function getOrganizationAssignableArticle(
  articleId: string,
  orgId: string,
): Promise<OrganizationAssignableArticleResult> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { id: true, visibility: true, organizationId: true },
  });
  if (!article) {
    return { ok: false, status: 404, reason: "article_not_found" };
  }

  const issues = await validateArticleOrganizationIntegrity(article, "read", {
    expectedOrgId: orgId,
  });
  const first = issues[0];
  if (!first) return { ok: true, article };

  return {
    ok: false,
    status: first.reason === "org_reference_mismatch" ? 404 : 409,
    reason: first.reason,
  };
}

export async function findArticleOrganizationIntegrityIssues(
  client: IntegrityScanClient = prisma,
): Promise<ArticleOrganizationIntegrityIssue[]> {
  const scopedArticles = await client.article.findMany({
    where: {
      OR: [
        { visibility: ArticleVisibility.ORG },
        { organizationId: { not: null } },
      ],
    },
    select: { id: true, visibility: true, organizationId: true },
  });

  const issues = scopedArticles.flatMap((article) =>
    articleOrganizationIntegrityIssues(article, "read"),
  );
  const orgIds = [
    ...new Set(
      scopedArticles
        .map((article) => article.organizationId)
        .filter((orgId): orgId is string => Boolean(orgId)),
    ),
  ];
  if (orgIds.length === 0) return issues;

  const existing = await client.organization.findMany({
    where: { id: { in: orgIds } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((org) => org.id));
  for (const article of scopedArticles) {
    if (article.organizationId && !existingIds.has(article.organizationId)) {
      issues.push(issue(article, "read", "org_reference_orphaned"));
    }
  }
  return issues;
}
