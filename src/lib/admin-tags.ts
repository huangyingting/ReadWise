import { prisma } from "@/lib/prisma";

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
 * Lists tags for the admin area. Matches the query (case insensitively via
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
        OR: [
          { name: { contains: query } },
          { slug: { contains: query } },
        ],
      }
    : {};

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
        where: { tagId: { in: ids }, article: { status: "published" } },
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
  | { ok: true }
  | { ok: false; error: string; status: number };

/**
 * Deletes a tag. The schema cascades remove its ArticleTag join rows, so
 * articles simply lose the tag (their content is untouched). Returns a
 * structured error when the tag does not exist.
 */
export async function deleteTag(id: string): Promise<DeleteTagResult> {
  const tag = await prisma.tag.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!tag) {
    return { ok: false, error: "Not found", status: 404 };
  }

  await prisma.tag.delete({ where: { id } });
  return { ok: true };
}
