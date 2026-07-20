import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import { AdminPageHeader } from "@/components/admin";
import CanonicalConflictQueue from "@/components/admin/canonical-conflicts/CanonicalConflictQueue";
import {
  parseConflictLimit,
  parseConflictOffset,
  parseConflictStatus,
} from "@/lib/scraper/incremental/canonical-conflict-ui";

type SearchParams = {
  status?: string;
  providerKey?: string;
  offset?: string;
  limit?: string;
};

/**
 * Admin canonical-conflict queue page (#1104, Phase 3.5, AC1). Gates on
 * `sources.manage` server-side (repo convention), then hands the initial filter
 * state to the {@link CanonicalConflictQueue} client island which fetches the
 * sanitized queue from `/api/admin/canonical-conflicts` and drives resolution.
 * The client island additionally renders an explicit unauthorized view if the
 * API later returns 401/403 (defence-in-depth for mid-session revocation). Only
 * sanitized identity is ever shown — no URL, body, secret, or article content;
 * dependent reader/learning data is reported as COUNTS only.
 */
export default async function AdminCanonicalConflictsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireCapability(CAPABILITIES.sourcesManage, "/admin/canonical-conflicts");

  const sp = await searchParams;

  return (
    <section className="stack">
      <AdminPageHeader>Canonical conflicts</AdminPageHeader>
      <p className="m-0 text-text-muted">
        Resolve public articles that collide on one normalized canonical identity
        (RW-1104). Pick the surviving article; the losers are archived out of public
        feeds while their reader data is retained. Resolving is destructive, so it
        requires an audit reason and an explicit confirmation. Only sanitized
        identity is shown — never a crawl URL, article content, or credentials — and
        dependent reader/learning data appears as counts only.
      </p>

      <CanonicalConflictQueue
        initialStatus={parseConflictStatus(sp.status)}
        initialProviderKey={(sp.providerKey ?? "").trim()}
        initialOffset={parseConflictOffset(sp.offset)}
        initialLimit={parseConflictLimit(sp.limit)}
      />
    </section>
  );
}
