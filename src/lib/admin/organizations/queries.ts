/**
 * Platform-wide organization listing for the admin back-office (#1163).
 *
 * Paginated, searchable (name/slug), sortable list of EVERY organization on the
 * platform — the oversight counterpart to `@/lib/org`'s per-membership reads.
 * Read-only; imports only the Prisma singleton.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Page size for the admin organization listing. */
export const ADMIN_ORGANIZATIONS_PAGE_SIZE = 20;
export const ADMIN_ORG_SORT_KEYS = ["createdAt", "name", "members", "classrooms"] as const;
export type AdminOrgSortKey = (typeof ADMIN_ORG_SORT_KEYS)[number];
type SortOrder = "asc" | "desc";

export type AdminOrganizationRow = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  memberCount: number;
  classroomCount: number;
};

export type AdminOrganizationSearch = {
  organizations: AdminOrganizationRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  query: string;
  sort: AdminOrgSortKey;
  order: SortOrder;
};

export type ListOrganizationsOpts = {
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: string | null;
  order?: string | null;
};

function normalizePage(page: number | undefined): number {
  return Math.max(1, page ?? 1);
}

function normalizeSort(value: string | null | undefined): AdminOrgSortKey {
  return (ADMIN_ORG_SORT_KEYS as readonly string[]).includes(value ?? "")
    ? (value as AdminOrgSortKey)
    : "createdAt";
}

function normalizeOrder(value: string | null | undefined): SortOrder {
  return value === "asc" ? "asc" : "desc";
}

function buildOrgWhere(query: string): Prisma.OrganizationWhereInput {
  return query
    ? {
        OR: [
          { name: { contains: query } },
          { slug: { contains: query } },
        ],
      }
    : {};
}

function orgOrderBy(
  sort: AdminOrgSortKey,
  order: SortOrder,
): Prisma.OrganizationOrderByWithRelationInput[] {
  switch (sort) {
    case "name":
      return [{ name: order }, { createdAt: "desc" }];
    case "members":
      return [{ memberships: { _count: order } }, { createdAt: "desc" }];
    case "classrooms":
      return [{ classrooms: { _count: order } }, { createdAt: "desc" }];
    case "createdAt":
    default:
      return [{ createdAt: order }];
  }
}

/**
 * Lists organizations for the admin area. Matches the query (case-insensitively
 * via SQLite LIKE) against name and slug, and includes per-org membership and
 * classroom counts. Paginated, newest orgs first by default.
 */
export async function listOrganizations(
  opts: ListOrganizationsOpts = {},
): Promise<AdminOrganizationSearch> {
  const query = (opts.q ?? "").trim();
  const pageSize = opts.pageSize ?? ADMIN_ORGANIZATIONS_PAGE_SIZE;
  const page = normalizePage(opts.page);
  const sort = normalizeSort(opts.sort);
  const order = normalizeOrder(opts.order);

  const where = buildOrgWhere(query);

  const [total, rows] = await Promise.all([
    prisma.organization.count({ where }),
    prisma.organization.findMany({
      where,
      orderBy: orgOrderBy(sort, order),
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { memberships: true, classrooms: true } } },
    }),
  ]);

  const organizations: AdminOrganizationRow[] = rows.map((org) => ({
    id: org.id,
    name: org.name,
    slug: org.slug,
    createdAt: org.createdAt,
    memberCount: org._count.memberships,
    classroomCount: org._count.classrooms,
  }));

  return {
    organizations,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    query,
    sort,
    order,
  };
}
