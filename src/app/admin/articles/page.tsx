import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { searchArticles } from "@/lib/admin-articles";
import AdminArticleActions from "@/components/AdminArticleActions";

type SearchParams = {
  q?: string;
  status?: string;
  page?: string;
};

function buildHref(params: { q: string; status: string; page: number }): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.status) sp.set("status", params.status);
  if (params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs ? `/admin/articles?${qs}` : "/admin/articles";
}

export default async function AdminArticlesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin("/admin/articles");

  const sp = await searchParams;
  const query = (sp.q ?? "").trim();
  const status = (sp.status ?? "").trim();
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const [result, statusRows] = await Promise.all([
    searchArticles({ query, status, page }),
    prisma.article.findMany({
      distinct: ["status"],
      select: { status: true },
      orderBy: { status: "asc" },
    }),
  ]);
  const statuses = statusRows.map((r) => r.status);

  const showingFrom =
    result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const showingTo = Math.min(result.page * result.pageSize, result.total);

  return (
    <section className="stack" style={{ marginTop: "1.5rem" }}>
      <h2 style={{ marginBottom: 0 }}>Articles</h2>

      <form method="get" className="admin-search">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search title, author or source…"
          className="admin-input"
          aria-label="Search articles"
        />
        <select
          name="status"
          defaultValue={status}
          className="admin-input"
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary admin-search-btn">
          Search
        </button>
      </form>

      <p className="muted" style={{ margin: 0 }}>
        {result.total === 0
          ? "No articles match."
          : `Showing ${showingFrom}–${showingTo} of ${result.total}`}
      </p>

      {result.articles.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Author / Source</th>
                <th>Status</th>
                <th>Level</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {result.articles.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/admin/articles/${a.id}`}>{a.title}</Link>
                  </td>
                  <td className="muted">
                    {a.author ?? "—"}
                    {a.source ? ` · ${a.source}` : ""}
                  </td>
                  <td>
                    <span className="pill">{a.status}</span>
                  </td>
                  <td className="muted">{a.difficulty ?? "—"}</td>
                  <td>
                    <AdminArticleActions articleId={a.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.totalPages > 1 && (
        <div className="admin-pagination">
          {result.page > 1 ? (
            <Link
              className="btn admin-page-btn"
              href={buildHref({ q: query, status, page: result.page - 1 })}
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
              href={buildHref({ q: query, status, page: result.page + 1 })}
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
