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

export type UpdateMemberRoleResult =
  | { ok: true; role: Role }
  | { ok: false; error: string; status: number };

/**
 * Updates a member's role. Guards against demoting the last remaining admin so
 * the platform can never be left without an administrator. Returns a structured
 * error (with an HTTP status) on failure.
 */
// Sentinel thrown inside a transaction to signal a guard condition.
class AdminGuardError extends Error {
  readonly guardError: string;
  readonly guardStatus: number;
  constructor(error: string, status: number) {
    super(error);
    this.guardError = error;
    this.guardStatus = status;
  }
}

export async function updateMemberRole(
  id: string,
  role: Role,
): Promise<UpdateMemberRoleResult> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true },
  });
  if (!user) {
    return { ok: false, error: "Not found", status: 404 };
  }

  // No role change — skip the DB write entirely.
  if (user.role === role) return { ok: true, role };

  // Re-count admins inside the transaction so two concurrent demotions of the
  // last admin can never both pass the guard and leave the system adminless.
  try {
    await prisma.$transaction(async (tx) => {
      if (user.role === "Admin" && role !== "Admin") {
        const admins = await tx.user.count({ where: { role: "Admin" } });
        if (admins <= 1) {
          throw new AdminGuardError("Cannot demote the last remaining admin", 409);
        }
      }
      await tx.user.update({ where: { id }, data: { role } });
    });
  } catch (e) {
    if (e instanceof AdminGuardError) {
      return { ok: false, error: e.guardError, status: e.guardStatus };
    }
    throw e;
  }
  return { ok: true, role };
}

export type DeleteMemberResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

/**
 * Removes a member. Related auth rows (accounts, sessions), profile, reading
 * progress and saved words are removed by the schema's cascade rules. Guards
 * against removing the last remaining admin. Returns a structured error on
 * failure.
 */
export async function deleteMember(id: string): Promise<DeleteMemberResult> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true },
  });
  if (!user) {
    return { ok: false, error: "Not found", status: 404 };
  }

  // Delete the member's personally-imported articles (ownerId === id) in the
  // SAME transaction as the user delete. Article.ownerId is onDelete: SetNull,
  // so otherwise those rows would survive as status:"published"/ownerId→NULL and
  // become world-readable via the public-visibility predicate. Deleting them
  // cascades all derived rows (translations/vocab/quiz/tags/speech/progress/
  // readingListItem/highlights — all onDelete: Cascade on articleId).
  //
  // The last-admin guard is re-evaluated INSIDE the transaction so two
  // concurrent admin deletions can never both pass the guard and leave the
  // system without an admin.
  //
  // Cascade deletes on the user: accounts, sessions, profile, reading progress,
  // saved words, etc. — all onDelete: Cascade.
  try {
    await prisma.$transaction(async (tx) => {
      if (user.role === "Admin") {
        const admins = await tx.user.count({ where: { role: "Admin" } });
        if (admins <= 1) {
          throw new AdminGuardError("Cannot remove the last remaining admin", 409);
        }
      }
      await tx.article.deleteMany({ where: { ownerId: id } });
      await tx.user.delete({ where: { id } });
    });
  } catch (e) {
    if (e instanceof AdminGuardError) {
      return { ok: false, error: e.guardError, status: e.guardStatus };
    }
    throw e;
  }
  return { ok: true };
}
