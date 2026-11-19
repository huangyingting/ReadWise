import Link from "next/link";
import { parsePageParam } from "@/lib/search-params";
import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import { listOrganizations } from "@/lib/admin/organizations";
import AdminOrgCreate from "@/components/admin/organizations/AdminOrgCreate";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  AdminPageHeader,
  AdminFilterBar,
  AdminResultCount,
  AdminTableWrap,
  AdminPagination,
  AdminSortHeaderRow,
  type AdminTableColumn,
} from "@/components/admin";
import { formatShortDate } from "@/lib/display-format";

const ORGANIZATION_COLUMNS: readonly AdminTableColumn[] = [
  { label: "Organization", sortKey: "name" },
  { label: "Slug" },
  { label: "Members", sortKey: "members" },
  { label: "Classrooms", sortKey: "classrooms" },
  { label: "Created", sortKey: "createdAt" },
];

type SearchParams = {
  q?: string;
  page?: string;
  sort?: string;
  order?: string;
};

type OrganizationRow = Awaited<
  ReturnType<typeof listOrganizations>
>["organizations"][number];

function buildHref(params: {
  q: string;
  page: number;
  sort: string;
  order: "asc" | "desc";
}): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  sp.set("sort", params.sort);
  sp.set("order", params.order);
  if (params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs ? `/admin/organizations?${qs}` : "/admin/organizations";
}

function OrganizationsTable({
  organizations,
  sort,
  order,
  buildSortHref,
}: {
  organizations: OrganizationRow[];
  sort: string;
  order: "asc" | "desc";
  buildSortHref: (sort: string, order: "asc" | "desc") => string;
}) {
  if (organizations.length === 0) return null;

  return (
    <AdminTableWrap ariaLabel="Organizations table (scrollable)">
      <thead>
        <AdminSortHeaderRow
          columns={ORGANIZATION_COLUMNS}
          currentSort={sort}
          currentOrder={order}
          buildHref={buildSortHref}
        />
      </thead>
      <tbody>
        {organizations.map((org) => (
          <tr key={org.id}>
            <td>
              <Link href={`/admin/organizations/${org.id}`}>{org.name}</Link>
            </td>
            <td className="muted">
              <Badge variant="neutral">{org.slug}</Badge>
            </td>
            <td className="muted">{org.memberCount}</td>
            <td className="muted">{org.classroomCount}</td>
            <td className="muted">{formatShortDate(org.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </AdminTableWrap>
  );
}

export default async function AdminOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireCapability(
    CAPABILITIES.organizationsManage,
    "/admin/organizations",
  );

  const sp = await searchParams;
  const query = (sp.q ?? "").trim();
  const page = parsePageParam(sp.page);
  const requestedSort = (sp.sort ?? "").trim();
  const requestedOrder = sp.order === "asc" ? "asc" : "desc";

  const result = await listOrganizations({
    q: query,
    page,
    sort: requestedSort,
    order: requestedOrder,
  });

  return (
    <section className="stack">
      <AdminPageHeader>Organizations</AdminPageHeader>

      <AdminOrgCreate />

      <AdminFilterBar>
        <Input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search name or slug…"
          inputSize="sm"
          className="flex-[1_1_240px]"
          aria-label="Search organizations"
        />
        <input type="hidden" name="sort" value={result.sort} />
        <input type="hidden" name="order" value={result.order} />
        <Button type="submit" variant="primary" size="sm" className="w-auto">
          Search
        </Button>
      </AdminFilterBar>

      <AdminResultCount
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        noun="organizations"
      />

      <OrganizationsTable
        organizations={result.organizations}
        sort={result.sort}
        order={result.order}
        buildSortHref={(nextSort, nextOrder) =>
          buildHref({ q: query, page: 1, sort: nextSort, order: nextOrder })
        }
      />

      <AdminPagination
        page={result.page}
        totalPages={result.totalPages}
        buildHref={(p) =>
          buildHref({ q: query, page: p, sort: result.sort, order: result.order })
        }
      />
    </section>
  );
}
