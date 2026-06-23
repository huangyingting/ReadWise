import Link from "next/link";
import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import { listAdminTags } from "@/lib/admin-tags";
import AdminTagActions from "@/components/AdminTagActions";
import { Input } from "@/components/ui/Input";
import { Button, buttonVariants } from "@/components/ui/Button";

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
  await requireCapability(CAPABILITIES.tagsManage, "/admin/tags");

  const sp = await searchParams;
  const query = (sp.q ?? "").trim();
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const result = await listAdminTags({ query, page });

  const showingFrom =
    result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const showingTo = Math.min(result.page * result.pageSize, result.total);

  return (
    <section className="stack">
      <h1 className="m-0 text-[length:var(--text-3xl)] font-[family-name:var(--font-display)] font-bold text-text">
        Global tags
      </h1>
      <p className="muted" style={{ margin: 0 }}>
        This tool manages public-library tags only. Private import tags stay scoped
        to their owner and are not listed here.
      </p>

      <form
        method="get"
        className="flex flex-wrap gap-[var(--space-2)] items-center"
      >
        <Input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search tag name or slug…"
          inputSize="md"
          className="flex-[1_1_240px]"
          aria-label="Search tags"
        />
        <Button type="submit" variant="primary" size="md" className="w-auto">
          Search
        </Button>
      </form>

      <p className="muted" style={{ margin: 0 }}>
        {result.total === 0
          ? "No tags match."
          : `Showing ${showingFrom}–${showingTo} of ${result.total}`}
      </p>

      {result.tags.length > 0 && (
        <div
          className="admin-table-wrap"
          tabIndex={0}
          aria-label="Tags table (scrollable)"
        >
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
                    <Link
                      href={`/tags/${t.slug}`}
                      className="text-text-subtle hover:text-text text-[length:var(--text-sm)]"
                    >
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
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href={buildHref({ q: query, page: result.page - 1 })}
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
              href={buildHref({ q: query, page: result.page + 1 })}
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
