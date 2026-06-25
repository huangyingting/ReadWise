/**
 * Admin member list read model (REF-052 — Issue #489).
 *
 * Provides the paginated member listing used by the admin /members area.
 * Separated from member mutation commands ({@link ./member-commands}) to keep
 * read-side and write-side concerns distinct.
 */

import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";

/** Page size for the admin member listing. */
export const ADMIN_MEMBERS_PAGE_SIZE = 20;

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
};

export type ListMembersOpts = {
  query?: string;
  role?: string | null;
  page?: number;
  pageSize?: number;
};

function asRole(value: string | null | undefined): Role | null {
  return value === "Admin" || value === "Reader" ? value : null;
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
  const page = Math.max(1, opts.page ?? 1);

  const where = {
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

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
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

  const ids = rows.map((r) => r.id);
  const completedGroups = ids.length
    ? await prisma.readingProgress.groupBy({
        by: ["userId"],
        where: { userId: { in: ids }, completed: true },
        _count: { _all: true },
      })
    : [];
  const completedByUser = new Map(
    completedGroups.map((g) => [g.userId, g._count._all]),
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
  };
}
