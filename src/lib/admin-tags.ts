import { prisma } from "@/lib/prisma";
import { slugifyTag } from "@/lib/tags";
import { recordAuditFromRequest, type AuditRequestInput } from "@/lib/audit";
import { publicListableArticleWhere } from "@/lib/article-access";
import { TagScope } from "@prisma/client";

/** Page size for the admin tag listing. */
export const ADMIN_TAGS_PAGE_SIZE = 20;

export type AdminTagRow = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  articleCount: number;
  publishedCount: number;
};

export type AdminTagSearch = {
  tags: AdminTagRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  query: string;
};

export type ListTagsOpts = {
  query?: string;
  page?: number;
  pageSize?: number;
};

/**
 * Lists global public tags for the admin area. Private user/import tags are
 * intentionally excluded from this tool so they cannot leak into global tag
 * management. Matches the query (case insensitively via
 * SQLite LIKE) against name and slug, and includes usage counts: total articles
 * carrying the tag plus how many of those are published. Paginated, ordered by
 * total usage (most-used first), then alphabetically.
 */
export async function listAdminTags(
  opts: ListTagsOpts = {},
): Promise<AdminTagSearch> {
  const query = (opts.query ?? "").trim();
  const pageSize = opts.pageSize ?? ADMIN_TAGS_PAGE_SIZE;
  const page = Math.max(1, opts.page ?? 1);

  const where = query
    ? {
        scope: TagScope.PUBLIC,
        OR: [
          { name: { contains: query } },
          { slug: { contains: query } },
        ],
      }
    : { scope: TagScope.PUBLIC };

  const [total, rows] = await Promise.all([
    prisma.tag.count({ where }),
    prisma.tag.findMany({
      where,
      orderBy: [{ articles: { _count: "desc" } }, { name: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        _count: { select: { articles: true } },
      },
    }),
  ]);

  const ids = rows.map((r) => r.id);
  const publishedGroups = ids.length
    ? await prisma.articleTag.groupBy({
        by: ["tagId"],
        where: { tagId: { in: ids }, article: publicListableArticleWhere() },
        _count: { _all: true },
      })
    : [];
  const publishedByTag = new Map(
    publishedGroups.map((g) => [g.tagId, g._count._all]),
  );

  const tags: AdminTagRow[] = rows.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    createdAt: t.createdAt,
    articleCount: t._count.articles,
    publishedCount: publishedByTag.get(t.id) ?? 0,
  }));

  return {
    tags,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    query,
  };
}

export type DeleteTagResult =
  | { ok: true; articleCount: number }
  | { ok: false; error: string; status: number };
type DeleteTagSuccess = Extract<DeleteTagResult, { ok: true }>;

export type RenameTagResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: string; status: number };
type RenameTagSuccess = Extract<RenameTagResult, { ok: true }>;
type AuditFactory<T> = (result: T) => AuditRequestInput;

/**
 * Renames a tag, recomputing its slug via {@link slugifyTag}. If the new slug
 * would collide with a DIFFERENT existing tag, returns a 409 error (the admin
 * should use Merge instead). Allows same-slug updates (case-only changes).
 */
export async function renameTag(
  id: string,
  newName: string,
  audit?: AuditFactory<RenameTagSuccess>,
): Promise<RenameTagResult> {
  const trimmed = newName.trim();
  if (!trimmed) return { ok: false, error: "Name is required", status: 400 };

  const tag = await prisma.tag.findFirst({
    where: { id, scope: TagScope.PUBLIC },
    select: { id: true, slug: true, namespace: true, scope: true },
  });
  if (!tag) return { ok: false, error: "Not found", status: 404 };

  const newSlug = slugifyTag(trimmed);
  const collision = await prisma.tag.findFirst({
    where: { slug: newSlug, scope: tag.scope, namespace: tag.namespace, NOT: { id } },
    select: { id: true, name: true },
  });
  if (collision) {
    return {
      ok: false,
      error: `A tag with slug "${newSlug}" already exists — use Merge to combine them`,
      status: 409,
    };
  }

  return prisma.$transaction(async (tx) => {
    const changed = tag.slug !== newSlug;
    await tx.tag.update({ where: { id }, data: { name: trimmed, slug: newSlug } });
    const result = { ok: true, changed } as const;
    if (audit) {
      await recordAuditFromRequest(audit(result), tx);
    }
    return result;
  });
}

export type MergeTagsResult =
  | { ok: true; moved: number }
  | { ok: false; error: string; status: number };
type MergeTagsSuccess = Extract<MergeTagsResult, { ok: true }>;

/**
 * Merges `sourceId` into `targetId`. All `ArticleTag` links on the source that
 * don't already exist on the target are re-pointed to the target; duplicates are
 * silently skipped. The source tag is then deleted (its remaining ArticleTag rows
 * are cascade-deleted). Runs in a single DB transaction.
 */
export async function mergeTags(
  sourceId: string,
  targetId: string,
  audit?: AuditFactory<MergeTagsSuccess>,
): Promise<MergeTagsResult> {
  if (sourceId === targetId) {
    return { ok: false, error: "Cannot merge a tag into itself", status: 400 };
  }

  const [source, target] = await Promise.all([
    prisma.tag.findFirst({ where: { id: sourceId, scope: TagScope.PUBLIC }, select: { id: true } }),
    prisma.tag.findFirst({ where: { id: targetId, scope: TagScope.PUBLIC }, select: { id: true } }),
  ]);
  if (!source) return { ok: false, error: "Source tag not found", status: 404 };
  if (!target) return { ok: false, error: "Target tag not found", status: 404 };

  const moved = await prisma.$transaction(async (tx) => {
    // Collect article ids linked to source
    const sourceLinks = await tx.articleTag.findMany({
      where: { tagId: sourceId },
      select: { articleId: true },
    });

    // Collect article ids already linked to target (to skip duplicates)
    const targetArticleIds = new Set(
      (
        await tx.articleTag.findMany({
          where: { tagId: targetId },
          select: { articleId: true },
        })
      ).map((r) => r.articleId),
    );

    const toCreate = sourceLinks
      .map((r) => r.articleId)
      .filter((aid) => !targetArticleIds.has(aid));

    if (toCreate.length) {
      await tx.articleTag.createMany({
        data: toCreate.map((articleId) => ({ articleId, tagId: targetId })),
      });
    }

    // Delete source — cascades its remaining ArticleTag rows
    await tx.tag.delete({ where: { id: sourceId } });

    if (audit) {
      await recordAuditFromRequest(audit({ ok: true, moved: toCreate.length }), tx);
    }

    return toCreate.length;
  });

  return { ok: true, moved };
}



/**
 * Deletes a tag. The schema cascades remove its ArticleTag join rows, so
 * articles simply lose the tag (their content is untouched). Returns a
 * structured error when the tag does not exist.
 */
export async function deleteTag(
  id: string,
  audit?: AuditFactory<DeleteTagSuccess>,
): Promise<DeleteTagResult> {
  const tag = await prisma.tag.findFirst({
    where: { id, scope: TagScope.PUBLIC },
    select: { id: true, _count: { select: { articles: true } } },
  });
  if (!tag) {
    return { ok: false, error: "Not found", status: 404 };
  }

  return prisma.$transaction(async (tx) => {
    await tx.tag.delete({ where: { id } });
    const result = { ok: true, articleCount: tag._count.articles } as const;
    if (audit) {
      await recordAuditFromRequest(audit(result), tx);
    }
    return result;
  });
}
