/**
 * Admin member list read model (REF-052 — Issue #489).
 *
 * Provides the paginated member listing used by the admin /members area.
 * Separated from member mutation commands ({@link ./member-commands}) to keep
 * read-side and write-side concerns distinct.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma, Role } from "@prisma/client";
import { ACTIVE_ROLES } from "@/lib/rbac";

/** Page size for the admin member listing. */
export const ADMIN_MEMBERS_PAGE_SIZE = 20;
export const ADMIN_MEMBER_SORT_KEYS = ["createdAt", "name", "role", "activity"] as const;
export const SORT_ORDERS = ["asc", "desc"] as const;
export type AdminMemberSortKey = (typeof ADMIN_MEMBER_SORT_KEYS)[number];
export type SortOrder = (typeof SORT_ORDERS)[number];

export type AdminMemberRow = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: Role;
  createdAt: Date;
  articlesStarted: number;
  articlesCompleted: number;
  savedWords: number;
};

export type AdminMemberSearch = {
  members: AdminMemberRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  query: string;
  role: Role | null;
  sort: AdminMemberSortKey;
  order: SortOrder;
};

export type ListMembersOpts = {
  query?: string;
  role?: string | null;
  page?: number;
  pageSize?: number;
  sort?: string | null;
  order?: string | null;
};

function asRole(value: string | null | undefined): Role | null {
  return value != null && (ACTIVE_ROLES as readonly string[]).includes(value)
    ? (value as Role)
    : null;
}

function normalizePage(page: number | undefined): number {
  return Math.max(1, page ?? 1);
}

function normalizeSort(value: string | null | undefined): AdminMemberSortKey {
  return (ADMIN_MEMBER_SORT_KEYS as readonly string[]).includes(value ?? "")
    ? (value as AdminMemberSortKey)
    : "createdAt";
}

function normalizeOrder(value: string | null | undefined): SortOrder {
  return value === "asc" ? "asc" : "desc";
}

function memberOrderBy(
  sort: AdminMemberSortKey,
  order: SortOrder,
): Prisma.UserOrderByWithRelationInput[] {
  switch (sort) {
    case "name":
      return [{ name: order }, { email: order }, { createdAt: "desc" }];
    case "role":
      return [{ role: order }, { createdAt: "desc" }];
    case "activity":
      return [
        { readingProgress: { _count: order } },
        { savedWords: { _count: order } },
        { createdAt: "desc" },
      ];
    case "createdAt":
    default:
      return [{ createdAt: order }];
  }
}

function buildMemberWhere(query: string, role: Role | null): Prisma.UserWhereInput {
  return {
    ...(role ? { role } : {}),
    ...(query
      ? {
          OR: [
            { name: { contains: query } },
            { email: { contains: query } },
          ],
        }
      : {}),
  };
}

async function countCompletedArticlesByUser(
  userIds: string[],
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();

  const completedGroups = await prisma.readingProgress.groupBy({
    by: ["userId"],
    where: { userId: { in: userIds }, completed: true },
    _count: { _all: true },
  });

  return new Map(completedGroups.map((g) => [g.userId, g._count._all]));
}

/**
 * Lists members for the admin area. Matches the query (case insensitively via
 * SQLite LIKE) against name and email, optionally restricts to a single role,
 * and includes per-member activity counts (articles started/completed, saved
 * words). Paginated, newest members first.
 */
export async function listMembers(
  opts: ListMembersOpts = {},
): Promise<AdminMemberSearch> {
  const query = (opts.query ?? "").trim();
  const role = asRole(opts.role ?? null);
  const pageSize = opts.pageSize ?? ADMIN_MEMBERS_PAGE_SIZE;
  const page = normalizePage(opts.page);
  const sort = normalizeSort(opts.sort);
  const order = normalizeOrder(opts.order);

  const where = buildMemberWhere(query, role);

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: memberOrderBy(sort, order),
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        createdAt: true,
        _count: { select: { savedWords: true, readingProgress: true } },
      },
    }),
  ]);

  const completedByUser = await countCompletedArticlesByUser(
    rows.map((row) => row.id),
  );

  const members: AdminMemberRow[] = rows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image,
    role: u.role,
    createdAt: u.createdAt,
    articlesStarted: u._count.readingProgress,
    articlesCompleted: completedByUser.get(u.id) ?? 0,
    savedWords: u._count.savedWords,
  }));

  return {
    members,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    query,
    role,
    sort,
    order,
  };
}
