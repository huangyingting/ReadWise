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
type OrganizationWithMemberCount = Prisma.OrganizationGetPayload<{
  include: { _count: { select: { memberships: true } } };
}>;

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
      return [{ createdAt: "desc" }];
    case "createdAt":
    default:
      return [{ createdAt: order }];
  }
}

async function activeClassroomCountsByOrg(orgIds: string[]): Promise<Map<string, number>> {
  if (orgIds.length === 0) return new Map();
  const counts = await prisma.classroom.groupBy({
    by: ["orgId"],
    where: { orgId: { in: orgIds }, archivedAt: null },
    _count: { _all: true },
  });
  return new Map(counts.map((row) => [row.orgId, row._count._all]));
}

function compareByActiveClassrooms(
  counts: Map<string, number>,
  order: SortOrder,
): (a: OrganizationWithMemberCount, b: OrganizationWithMemberCount) => number {
  const direction = order === "asc" ? 1 : -1;
  return (a, b) => {
    const byCount = (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0);
    if (byCount !== 0) return byCount * direction;
    return b.createdAt.getTime() - a.createdAt.getTime();
  };
}

function toOrganizationRow(
  org: OrganizationWithMemberCount,
  activeClassroomCounts: Map<string, number>,
): AdminOrganizationRow {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    createdAt: org.createdAt,
    memberCount: org._count.memberships,
    classroomCount: activeClassroomCounts.get(org.id) ?? 0,
  };
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

  let total: number;
  let rows: OrganizationWithMemberCount[];
  let activeClassroomCounts: Map<string, number>;

  if (sort === "classrooms") {
    const allRows = await prisma.organization.findMany({
      where,
      orderBy: orgOrderBy(sort, order),
      include: { _count: { select: { memberships: true } } },
    });
    total = allRows.length;
    activeClassroomCounts = await activeClassroomCountsByOrg(allRows.map((org) => org.id));
    rows = [...allRows]
      .sort(compareByActiveClassrooms(activeClassroomCounts, order))
      .slice((page - 1) * pageSize, page * pageSize);
  } else {
    [total, rows] = await Promise.all([
      prisma.organization.count({ where }),
      prisma.organization.findMany({
        where,
        orderBy: orgOrderBy(sort, order),
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { memberships: true } } },
      }),
    ]);
    activeClassroomCounts = await activeClassroomCountsByOrg(rows.map((org) => org.id));
  }

  const organizations = rows.map((org) => toOrganizationRow(org, activeClassroomCounts));

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
