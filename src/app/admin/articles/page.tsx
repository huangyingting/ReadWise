import Link from "next/link";
import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import { searchArticles, getAdminArticleStatuses } from "@/lib/article-library";
import { statusBadgeVariant } from "@/lib/admin/overview";
import { articleAccessContext } from "@/lib/article-library";
import AdminArticleActions from "@/components/AdminArticleActions";
import AdminArticleIngest from "@/components/AdminArticleIngest";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Badge, CefrBadge, CEFR_LEVELS, type CefrLevel } from "@/components/ui/Badge";
import {
  AdminPageHeader,
  AdminFilterBar,
  AdminResultCount,
  AdminTableWrap,
  AdminPagination,
} from "@/components/admin";

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
  const session = await requireCapability(CAPABILITIES.articlesManage, "/admin/articles");
  const context = articleAccessContext(session.user);

  const sp = await searchParams;
  const query = (sp.q ?? "").trim();
  const status = (sp.status ?? "").trim().toUpperCase();
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const [result, statuses] = await Promise.all([
    searchArticles({ query, status, page, context }),
    getAdminArticleStatuses(context),
  ]);

  return (
    <section className="stack">
      <AdminPageHeader>Articles</AdminPageHeader>

      <AdminArticleIngest />

      <AdminFilterBar>
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
      </AdminFilterBar>

      <AdminResultCount
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        noun="articles"
      />

      {result.articles.length > 0 && (
        <AdminTableWrap ariaLabel="Articles table (scrollable)">
          <thead>
            <tr>
              <th>Title</th>
              <th>Author / Source</th>
              <th>Visibility / Status</th>
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
                  <div className="flex flex-wrap gap-[var(--space-1)]">
                    <Badge variant="neutral">{a.visibility}</Badge>
                    <Badge variant={statusBadgeVariant(a.status)}>{a.status}</Badge>
                    <Badge variant="neutral">{a.sourceType}</Badge>
                  </div>
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
        </AdminTableWrap>
      )}

      <AdminPagination
        page={result.page}
        totalPages={result.totalPages}
        buildHref={(p) => buildHref({ q: query, status, page: p })}
      />
    </section>
  );
}
