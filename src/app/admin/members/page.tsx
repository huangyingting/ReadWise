import Link from "next/link";
import Avatar from "@/components/ui/Avatar";
import { requireCapability } from "@/lib/session";
import { ACTIVE_ROLES, CAPABILITIES } from "@/lib/rbac";
import { listMembers } from "@/lib/account-lifecycle";
import AdminMemberActions from "@/components/AdminMemberActions";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  AdminPageHeader,
  AdminFilterBar,
  AdminResultCount,
  AdminTableWrap,
  AdminPagination,
  AdminSortHeader,
} from "@/components/admin";
import { formatShortDate } from "@/lib/display-format";

type SearchParams = {
  q?: string;
  role?: string;
  page?: string;
  sort?: string;
  order?: string;
};

type Member = Awaited<ReturnType<typeof listMembers>>["members"][number];

const ROLE_OPTIONS = ACTIVE_ROLES;
const SCOPED_ADMIN_ROLES = ["Moderator", "ContentEditor", "SupportAgent"] as const;

function parsePage(value: string | undefined): number {
  return Math.max(1, Number.parseInt(value ?? "1", 10) || 1);
}

function buildHref(params: {
  q: string;
  role: string;
  page: number;
  sort: string;
  order: "asc" | "desc";
}): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.role) sp.set("role", params.role);
  sp.set("sort", params.sort);
  sp.set("order", params.order);
  if (params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs ? `/admin/members?${qs}` : "/admin/members";
}

function MemberIdentity({
  member,
  isSelf,
}: {
  member: Member;
  isSelf: boolean;
}) {
  return (
    <div className="admin-member-cell">
      <Avatar
        src={member.image}
        name={member.name ?? member.email}
        size={32}
        className="admin-member-avatar"
      />
      <span className="admin-member-name">
        <span>
          <Link href={`/admin/members/${member.id}`}>
            {member.name ?? "—"}
          </Link>
          {isSelf && (
            <Badge
              variant="neutral"
              className="ml-[var(--space-1)]"
            >
              You
            </Badge>
          )}
        </span>
        <span className="muted">{member.email ?? "no email"}</span>
      </span>
    </div>
  );
}

function MemberRoleBadge({ role }: { role: Member["role"] }) {
  const variant =
    role === "Admin"
      ? "primary"
      : (SCOPED_ADMIN_ROLES as readonly string[]).includes(role)
        ? "warning"
        : "neutral";
  return (
    <Badge variant={variant}>
      {role}
    </Badge>
  );
}

function MemberActivity({ member }: { member: Member }) {
  return (
    <>
      {member.articlesStarted} started · {member.articlesCompleted} done ·{" "}
      {member.savedWords} words
    </>
  );
}

function MemberManagementActions({
  member,
  isSelf,
}: {
  member: Member;
  isSelf: boolean;
}) {
  return (
    <div className="flex flex-col gap-[var(--space-1)] items-start">
      <Link
        className="text-[length:var(--text-sm)]"
        href={`/admin/members/${member.id}`}
      >
        View &amp; support →
      </Link>
      <AdminMemberActions
        memberId={member.id}
        role={member.role}
        isSelf={isSelf}
      />
    </div>
  );
}

function MembersTable({
  members,
  currentUserId,
  sort,
  order,
  buildSortHref,
}: {
  members: Member[];
  currentUserId: string;
  sort: string;
  order: "asc" | "desc";
  buildSortHref: (sort: string, order: "asc" | "desc") => string;
}) {
  if (members.length === 0) return null;

  return (
    <AdminTableWrap ariaLabel="Members table (scrollable)">
      <thead>
        <tr>
          <AdminSortHeader
            label="Member"
            sortKey="name"
            currentSort={sort}
            currentOrder={order}
            buildHref={buildSortHref}
          />
          <AdminSortHeader
            label="Role"
            sortKey="role"
            currentSort={sort}
            currentOrder={order}
            buildHref={buildSortHref}
          />
          <AdminSortHeader
            label="Joined"
            sortKey="createdAt"
            currentSort={sort}
            currentOrder={order}
            buildHref={buildSortHref}
          />
          <AdminSortHeader
            label="Activity"
            sortKey="activity"
            currentSort={sort}
            currentOrder={order}
            buildHref={buildSortHref}
          />
          <th scope="col">Manage</th>
        </tr>
      </thead>
      <tbody>
        {members.map((member) => {
          const isSelf = member.id === currentUserId;
          return (
            <tr key={member.id}>
              <td>
                <MemberIdentity member={member} isSelf={isSelf} />
              </td>
              <td>
                <MemberRoleBadge role={member.role} />
              </td>
              <td className="muted">{formatShortDate(member.createdAt)}</td>
              <td className="muted">
                <MemberActivity member={member} />
              </td>
              <td>
                <MemberManagementActions member={member} isSelf={isSelf} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </AdminTableWrap>
  );
}

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireCapability(CAPABILITIES.membersManage, "/admin/members");

  const sp = await searchParams;
  const query = (sp.q ?? "").trim();
  const role = (sp.role ?? "").trim();
  const page = parsePage(sp.page);
  const requestedSort = (sp.sort ?? "").trim();
  const requestedOrder = sp.order === "asc" ? "asc" : "desc";

  const result = await listMembers({
    query,
    role,
    page,
    sort: requestedSort,
    order: requestedOrder,
  });

  return (
    <section className="stack">
      <AdminPageHeader>Members</AdminPageHeader>

      <AdminFilterBar>
        <Input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search name or email…"
          inputSize="md"
          className="flex-[1_1_240px]"
          aria-label="Search members"
        />
        <input type="hidden" name="sort" value={result.sort} />
        <input type="hidden" name="order" value={result.order} />
        <div className="w-auto">
          <Select
            name="role"
            defaultValue={role}
            selectSize="md"
            className="w-auto"
            aria-label="Filter by role"
          >
            <option value="">All roles</option>
            {ROLE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="primary" size="md" className="w-auto">
          Search
        </Button>
      </AdminFilterBar>

      <AdminResultCount
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        noun="members"
      />

      <MembersTable
        members={result.members}
        currentUserId={session.user.id}
        sort={result.sort}
        order={result.order}
        buildSortHref={(nextSort, nextOrder) =>
          buildHref({ q: query, role, page: 1, sort: nextSort, order: nextOrder })
        }
      />

      <AdminPagination
        page={result.page}
        totalPages={result.totalPages}
        buildHref={(p) =>
          buildHref({ q: query, role, page: p, sort: result.sort, order: result.order })
        }
      />
    </section>
  );
}
