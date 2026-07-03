import Link from "next/link";
import Avatar from "@/components/ui/Avatar";
import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
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
} from "@/components/admin";
import { formatShortDate } from "@/lib/display-format";

type SearchParams = {
  q?: string;
  role?: string;
  page?: string;
};

type Member = Awaited<ReturnType<typeof listMembers>>["members"][number];

const ROLE_OPTIONS = ["Admin", "Reader"] as const;

function parsePage(value: string | undefined): number {
  return Math.max(1, Number.parseInt(value ?? "1", 10) || 1);
}

function buildHref(params: { q: string; role: string; page: number }): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.role) sp.set("role", params.role);
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
  return (
    <Badge variant={role === "Admin" ? "primary" : "neutral"}>
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
}: {
  members: Member[];
  currentUserId: string;
}) {
  if (members.length === 0) return null;

  return (
    <AdminTableWrap ariaLabel="Members table (scrollable)">
      <thead>
        <tr>
          <th>Member</th>
          <th>Role</th>
          <th>Joined</th>
          <th>Activity</th>
          <th>Manage</th>
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

  const result = await listMembers({ query, role, page });

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

      <MembersTable members={result.members} currentUserId={session.user.id} />

      <AdminPagination
        page={result.page}
        totalPages={result.totalPages}
        buildHref={(p) => buildHref({ q: query, role, page: p })}
      />
    </section>
  );
}
