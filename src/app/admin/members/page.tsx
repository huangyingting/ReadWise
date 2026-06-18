import Link from "next/link";
import Image from "next/image";
import { requireAdmin } from "@/lib/session";
import { listMembers } from "@/lib/admin-members";
import AdminMemberActions from "@/components/AdminMemberActions";

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
  const session = await requireAdmin("/admin/members");

  const sp = await searchParams;
  const query = (sp.q ?? "").trim();
  const role = (sp.role ?? "").trim();
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const result = await listMembers({ query, role, page });

  const showingFrom =
    result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const showingTo = Math.min(result.page * result.pageSize, result.total);

  return (
    <section className="stack" style={{ marginTop: "1.5rem" }}>
      <h2 style={{ marginBottom: 0 }}>Members</h2>

      <form method="get" className="admin-search">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search name or email…"
          className="admin-input"
          aria-label="Search members"
        />
        <select
          name="role"
          defaultValue={role}
          className="admin-input"
          aria-label="Filter by role"
        >
          <option value="">All roles</option>
          <option value="Admin">Admin</option>
          <option value="Reader">Reader</option>
        </select>
        <button type="submit" className="btn btn-primary admin-search-btn">
          Search
        </button>
      </form>

      <p className="muted" style={{ margin: 0 }}>
        {result.total === 0
          ? "No members match."
          : `Showing ${showingFrom}–${showingTo} of ${result.total}`}
      </p>

      {result.members.length > 0 && (
        <div className="admin-table-wrap">
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
                        {m.image ? (
                          <Image
                            src={m.image}
                            alt=""
                            width={32}
                            height={32}
                            className="admin-member-avatar"
                            unoptimized
                          />
                        ) : (
                          <span className="admin-member-avatar admin-member-avatar-fallback">
                            {(m.name ?? m.email ?? "?").charAt(0).toUpperCase()}
                          </span>
                        )}
                        <span className="admin-member-name">
                          <span>
                            {m.name ?? "—"}
                            {isSelf && (
                              <span
                                className="pill"
                                style={{ marginLeft: "0.4rem" }}
                              >
                                You
                              </span>
                            )}
                          </span>
                          <span className="muted">{m.email ?? "no email"}</span>
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="pill">{m.role}</span>
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
              className="btn admin-page-btn"
              href={buildHref({ q: query, role, page: result.page - 1 })}
            >
              ← Previous
            </Link>
          ) : (
            <span className="btn admin-page-btn is-disabled">← Previous</span>
          )}
          <span className="muted">
            Page {result.page} of {result.totalPages}
          </span>
          {result.page < result.totalPages ? (
            <Link
              className="btn admin-page-btn"
              href={buildHref({ q: query, role, page: result.page + 1 })}
            >
              Next →
            </Link>
          ) : (
            <span className="btn admin-page-btn is-disabled">Next →</span>
          )}
        </div>
      )}
    </section>
  );
}
