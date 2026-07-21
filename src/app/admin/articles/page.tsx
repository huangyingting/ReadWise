import Link from "next/link";
import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import {
  articleAccessContext,
  getAdminArticleStatuses,
  searchArticles,
} from "@/lib/article-library";
import { statusBadgeVariant } from "@/lib/admin/overview";
import AdminArticleActions from "@/components/AdminArticleActions";
import AdminArticleIngest from "@/components/AdminArticleIngest";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge, CefrBadge, CEFR_LEVELS, type CefrLevel } from "@/components/ui/Badge";
import {
  AdminPageHeader,
  AdminFilterBar,
  AdminResultCount,
  AdminTableWrap,
  AdminPagination,
  AdminSortHeader,
} from "@/components/admin";

type SearchParams = {
  q?: string;
  status?: string;
  page?: string;
  sort?: string;
  order?: string;
};

function buildHref(params: {
  q: string;
  status: string;
  page: number;
  sort: string;
  order: "asc" | "desc";
}): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.status) sp.set("status", params.status);
  sp.set("sort", params.sort);
  sp.set("order", params.order);
  if (params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs ? `/admin/articles?${qs}` : "/admin/articles";
}

function getCefrLevel(difficulty: string | null | undefined): CefrLevel | null {
  return difficulty && (CEFR_LEVELS as readonly string[]).includes(difficulty)
    ? (difficulty as CefrLevel)
    : null;
}

function formatAuthorSource(
  author: string | null | undefined,
  source: string | null | undefined,
): string {
  return `${author ?? "—"}${source ? ` · ${source}` : ""}`;
}

function AdminArticleDifficulty({
  difficulty,
}: {
  difficulty: string | null | undefined;
}) {
  const level = getCefrLevel(difficulty);
  if (level) return <CefrBadge level={level} />;

  return <span className="text-text-subtle">{difficulty ?? "—"}</span>;
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
  const requestedSort = (sp.sort ?? "").trim();
  const requestedOrder = sp.order === "asc" ? "asc" : "desc";
  const hasActiveFilters = query.length > 0 || status.length > 0;

  const [result, statuses] = await Promise.all([
    searchArticles({
      query,
      status,
      page,
      context,
      sort: requestedSort,
      order: requestedOrder,
    }),
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
        <input type="hidden" name="sort" value={result.sort} />
        <input type="hidden" name="order" value={result.order} />
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
              <AdminSortHeader
                label="Title"
                sortKey="title"
                currentSort={result.sort}
                currentOrder={result.order}
                buildHref={(sort, order) =>
                  buildHref({ q: query, status, page: 1, sort, order })
                }
              />
              <AdminSortHeader
                label="Author / Source"
                sortKey="author"
                currentSort={result.sort}
                currentOrder={result.order}
                buildHref={(sort, order) =>
                  buildHref({ q: query, status, page: 1, sort, order })
                }
              />
              <AdminSortHeader
                label="Visibility / Status"
                sortKey="status"
                currentSort={result.sort}
                currentOrder={result.order}
                buildHref={(sort, order) =>
                  buildHref({ q: query, status, page: 1, sort, order })
                }
              />
              <AdminSortHeader
                label="Level"
                sortKey="difficulty"
                currentSort={result.sort}
                currentOrder={result.order}
                buildHref={(sort, order) =>
                  buildHref({ q: query, status, page: 1, sort, order })
                }
              />
              <th scope="col">Actions</th>
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
                  {formatAuthorSource(a.author, a.source)}
                </td>
                <td>
                  <div className="flex flex-wrap gap-[var(--space-1)]">
                    <Badge variant="neutral">{a.visibility}</Badge>
                    <Badge variant={statusBadgeVariant(a.status)}>{a.status}</Badge>
                    <Badge variant="neutral">{a.sourceType}</Badge>
                  </div>
                </td>
                <td>
                  <AdminArticleDifficulty difficulty={a.difficulty} />
                </td>
                <td>
                  <AdminArticleActions articleId={a.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </AdminTableWrap>
      )}

      {result.articles.length === 0 && (
        <EmptyState
          title={hasActiveFilters ? "No articles match these filters" : "No articles yet"}
          description={
            hasActiveFilters
              ? "Clear filters to return to the full article queue."
              : "Ingest or import articles before managing them here."
          }
          action={
            hasActiveFilters
              ? { label: "Clear filters", href: "/admin/articles" }
              : undefined
          }
        />
      )}

      <AdminPagination
        page={result.page}
        totalPages={result.totalPages}
        buildHref={(p) =>
          buildHref({ q: query, status, page: p, sort: result.sort, order: result.order })
        }
      />
    </section>
  );
}
