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

function buildHref(params: { q: string; role: string; page: number }): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.role) sp.set("role", params.role);
  if (params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs ? `/admin/members?${qs}` : "/admin/members";
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
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

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
            <option value="Admin">Admin</option>
            <option value="Reader">Reader</option>
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

      {result.members.length > 0 && (
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
            {result.members.map((m) => {
              const isSelf = m.id === session.user.id;
              return (
                <tr key={m.id}>
                  <td>
                    <div className="admin-member-cell">
                      <Avatar
                        src={m.image}
                        name={m.name ?? m.email}
                        size={32}
                        className="admin-member-avatar"
                      />
                      <span className="admin-member-name">
                        <span>
                          <Link href={`/admin/members/${m.id}`}>
                            {m.name ?? "—"}
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
                        <span className="muted">{m.email ?? "no email"}</span>
                      </span>
                    </div>
                  </td>
                  <td>
                    <Badge
                      variant={m.role === "Admin" ? "primary" : "neutral"}
                    >
                      {m.role}
                    </Badge>
                  </td>
                  <td className="muted">{formatShortDate(m.createdAt)}</td>
                  <td className="muted">
                    {m.articlesStarted} started · {m.articlesCompleted} done ·{" "}
                    {m.savedWords} words
                  </td>
                  <td>
                    <div className="flex flex-col gap-[var(--space-1)] items-start">
                      <Link
                        className="text-[length:var(--text-sm)]"
                        href={`/admin/members/${m.id}`}
                      >
                        View &amp; support →
                      </Link>
                      <AdminMemberActions
                        memberId={m.id}
                        role={m.role}
                        isSelf={isSelf}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </AdminTableWrap>
      )}

      <AdminPagination
        page={result.page}
        totalPages={result.totalPages}
        buildHref={(p) => buildHref({ q: query, role, page: p })}
      />
    </section>
  );
}
