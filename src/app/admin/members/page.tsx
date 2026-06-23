import Link from "next/link";
import Avatar from "@/components/ui/Avatar";
import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import { listMembers } from "@/lib/admin-members";
import AdminMemberActions from "@/components/AdminMemberActions";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button, buttonVariants } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

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

function dateLabel(d: Date): string {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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

  const showingFrom =
    result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const showingTo = Math.min(result.page * result.pageSize, result.total);

  return (
    <section className="stack">
      <h1 className="m-0 text-[length:var(--text-3xl)] font-[family-name:var(--font-display)] font-bold text-text">
        Members
      </h1>

      <form
        method="get"
        className="flex flex-wrap gap-[var(--space-2)] items-center"
      >
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
      </form>

      <p className="muted" style={{ margin: 0 }}>
        {result.total === 0
          ? "No members match."
          : `Showing ${showingFrom}–${showingTo} of ${result.total}`}
      </p>

      {result.members.length > 0 && (
        <div
          className="admin-table-wrap"
          tabIndex={0}
          aria-label="Members table (scrollable)"
        >
          <table className="admin-table">
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
                            {m.name ?? "—"}
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
                    <td className="muted">{dateLabel(m.createdAt)}</td>
                    <td className="muted">
                      {m.articlesStarted} started · {m.articlesCompleted} done ·{" "}
                      {m.savedWords} words
                    </td>
                    <td>
                      <AdminMemberActions
                        memberId={m.id}
                        role={m.role}
                        isSelf={isSelf}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {result.totalPages > 1 && (
        <div className="admin-pagination">
          {result.page > 1 ? (
            <Link
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href={buildHref({ q: query, role, page: result.page - 1 })}
            >
              ← Previous
            </Link>
          ) : (
            <Button variant="outline" size="sm" disabled>
              ← Previous
            </Button>
          )}
          <span className="muted">
            Page {result.page} of {result.totalPages}
          </span>
          {result.page < result.totalPages ? (
            <Link
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href={buildHref({ q: query, role, page: result.page + 1 })}
            >
              Next →
            </Link>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Next →
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
