import Link from "next/link";
import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import { listAdminTags } from "@/lib/admin-tags";
import AdminTagActions from "@/components/AdminTagActions";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  AdminPageHeader,
  AdminFilterBar,
  AdminResultCount,
  AdminTableWrap,
  AdminPagination,
} from "@/components/admin";

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

  return (
    <section className="stack">
      <AdminPageHeader>Global tags</AdminPageHeader>
      <p className="muted" style={{ margin: 0 }}>
        This tool manages public-library tags only. Private import tags stay scoped
        to their owner and are not listed here.
      </p>

      <AdminFilterBar>
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
      </AdminFilterBar>

      <AdminResultCount
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        noun="tags"
      />

      {result.tags.length > 0 && (
        <AdminTableWrap ariaLabel="Tags table (scrollable)">
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
        </AdminTableWrap>
      )}

      <AdminPagination
        page={result.page}
        totalPages={result.totalPages}
        buildHref={(p) => buildHref({ q: query, page: p })}
      />
    </section>
  );
}
