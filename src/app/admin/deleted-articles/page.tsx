import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import { AdminPageHeader } from "@/components/admin";
import DeletedArticleQueue from "@/components/admin/deleted-articles/DeletedArticleQueue";
import {
  parseDeletedLimit,
  parseDeletedOffset,
} from "@/lib/scraper/incremental/deleted-article-ui";

type SearchParams = {
  providerKey?: string;
  offset?: string;
  limit?: string;
};

/**
 * Admin deleted-identity recovery page (#1104, Phase 3.5, AC2). Gates on
 * `sources.manage` server-side (repo convention), then hands the initial filter
 * state to the {@link DeletedArticleQueue} client island which fetches the
 * sanitized queue from `/api/admin/deleted-articles` and drives explicit,
 * audited recovery. The client island additionally renders an explicit
 * unauthorized view if the API later returns 401/403 (defence-in-depth for
 * mid-session revocation). Recovery re-admits a deleted identity for
 * re-ingestion — it is NOT a content restore — so it requires an audit reason and
 * an explicit confirmation. Only sanitized identity is shown — never a crawl URL,
 * article content, or credentials.
 */
export default async function AdminDeletedArticlesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireCapability(CAPABILITIES.sourcesManage, "/admin/deleted-articles");

  const sp = await searchParams;

  return (
    <section className="stack">
      <AdminPageHeader>Deleted articles</AdminPageHeader>
      <p className="m-0 text-text-muted">
        Explicitly re-admit a deleted article identity for re-ingestion (RW-1104).
        When an article is deleted its identity is retained so it is never silently
        recreated; recovery clears that deleted terminal and enqueues one fresh
        ingest job. This is not a content restore — the original content is gone — so
        it requires an audit reason and an explicit confirmation. Only sanitized
        identity is shown — never a crawl URL, article content, or credentials.
      </p>

      <DeletedArticleQueue
        initialProviderKey={(sp.providerKey ?? "").trim()}
        initialOffset={parseDeletedOffset(sp.offset)}
        initialLimit={parseDeletedLimit(sp.limit)}
      />
    </section>
  );
}
