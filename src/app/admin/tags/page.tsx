import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { listAdminTags } from "@/lib/admin-tags";
import AdminTagActions from "@/components/AdminTagActions";

type SearchParams = {
  q?: string;
  page?: string;
};

function buildHref(params: { q: string; page: number }): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs ? `/admin/tags?${qs}` : "/admin/tags";
}

export default async function AdminTagsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin("/admin/tags");

  const sp = await searchParams;
  const query = (sp.q ?? "").trim();
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const result = await listAdminTags({ query, page });

  const showingFrom =
    result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const showingTo = Math.min(result.page * result.pageSize, result.total);

  return (
    <section className="stack" style={{ marginTop: "1.5rem" }}>
      <h2 style={{ marginBottom: 0 }}>Tags</h2>

      <form method="get" className="admin-search">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search tag name or slug…"
          className="admin-input"
          aria-label="Search tags"
        />
        <button type="submit" className="btn btn-primary admin-search-btn">
          Search
        </button>
      </form>

      <p className="muted" style={{ margin: 0 }}>
        {result.total === 0
          ? "No tags match."
          : `Showing ${showingFrom}–${showingTo} of ${result.total}`}
      </p>

      {result.tags.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Tag</th>
                <th>Slug</th>
                <th>Usage</th>
                <th>Manage</th>
              </tr>
            </thead>
            <tbody>
              {result.tags.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>
                    <Link href={`/tags/${t.slug}`} className="muted">
                      {t.slug}
                    </Link>
                  </td>
                  <td className="muted">
                    {t.articleCount} article{t.articleCount === 1 ? "" : "s"} ·{" "}
                    {t.publishedCount} published
                  </td>
                  <td>
                    <AdminTagActions tagId={t.id} tagName={t.name} />
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
              href={buildHref({ q: query, page: result.page - 1 })}
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
              href={buildHref({ q: query, page: result.page + 1 })}
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
