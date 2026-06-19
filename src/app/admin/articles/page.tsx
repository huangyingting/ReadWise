import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { searchArticles } from "@/lib/admin-articles";
import AdminArticleActions from "@/components/AdminArticleActions";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button, buttonVariants } from "@/components/ui/Button";
import { Badge, CefrBadge, CEFR_LEVELS, type CefrLevel } from "@/components/ui/Badge";

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

function statusBadgeVariant(
  status: string,
): "success" | "neutral" | "warning" | "danger" {
  if (status === "published") return "success";
  if (status === "processing") return "warning";
  if (status === "failed") return "danger";
  return "neutral";
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
    <section className="stack mt-[var(--space-6)]">
      <h2>Articles</h2>

      <form
        method="get"
        className="flex flex-wrap gap-[var(--space-2)] items-center"
      >
        <Input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search title, author or source…"
          inputSize="md"
          className="flex-[1_1_240px]"
          aria-label="Search articles"
        />
        <div className="w-auto">
          <Select
            name="status"
            defaultValue={status}
            selectSize="md"
            className="w-auto"
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="primary" size="md" className="w-auto">
          Search
        </Button>
      </form>

      <p className="muted" style={{ margin: 0 }}>
        {result.total === 0
          ? "No articles match."
          : `Showing ${showingFrom}–${showingTo} of ${result.total}`}
      </p>

      {result.articles.length > 0 && (
        <div
          className="admin-table-wrap"
          tabIndex={0}
          aria-label="Articles table (scrollable)"
        >
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
                    <Link
                      href={`/admin/articles/${a.id}`}
                      className="text-primary-text hover:underline"
                    >
                      {a.title}
                    </Link>
                  </td>
                  <td className="muted">
                    {a.author ?? "—"}
                    {a.source ? ` · ${a.source}` : ""}
                  </td>
                  <td>
                    <Badge variant={statusBadgeVariant(a.status)}>
                      {a.status}
                    </Badge>
                  </td>
                  <td>
                    {a.difficulty &&
                    (CEFR_LEVELS as readonly string[]).includes(a.difficulty) ? (
                      <CefrBadge level={a.difficulty as CefrLevel} />
                    ) : (
                      <span className="text-text-subtle">
                        {a.difficulty ?? "—"}
                      </span>
                    )}
                  </td>
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
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href={buildHref({ q: query, status, page: result.page - 1 })}
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
              href={buildHref({ q: query, status, page: result.page + 1 })}
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
