import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import { AdminPageHeader } from "@/components/admin";
import CandidateReviewQueue from "@/components/admin/candidate-review/CandidateReviewQueue";
import {
  DEFAULT_REVIEW_LIMIT,
  MAX_REVIEW_LIMIT,
  isReviewQueueStatus,
  type ReviewQueueStatus,
} from "@/lib/scraper/incremental/candidate-review-ui";

type SearchParams = {
  status?: string;
  providerKey?: string;
  discoverySourceId?: string;
  offset?: string;
  limit?: string;
};

function parseStatus(raw: string | undefined): ReviewQueueStatus {
  return raw && isReviewQueueStatus(raw) ? raw : "NEEDS_REVIEW";
}

function parseBoundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/**
 * Admin candidate-review queue page (#1100, Phase 3.1). Gates on
 * `sources.manage` server-side (repo convention), then hands the initial filter
 * state to the {@link CandidateReviewQueue} client island which fetches the
 * sanitized queue from `/api/admin/candidates` and drives every review action.
 * The client island additionally renders an explicit unauthorized view if the
 * API later returns 401/403 (defence-in-depth for mid-session revocation). Only
 * sanitized provenance is ever shown — no URL, body, secret, or article content.
 */
export default async function AdminCandidatesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireCapability(CAPABILITIES.sourcesManage, "/admin/candidates");

  const sp = await searchParams;

  return (
    <section className="stack">
      <AdminPageHeader>Candidate review</AdminPageHeader>
      <p className="m-0 text-text-muted">
        Decide uncertain crawl candidates parked for review (RW-1100). Approving a
        candidate routes it through the normal ingest pipeline; rejecting it parks it
        as reviewed so it is never rediscovered; a rejected candidate can be
        explicitly reactivated. Only sanitized provenance is shown — never a crawl
        URL, article content, or credentials.
      </p>

      <CandidateReviewQueue
        initialStatus={parseStatus(sp.status)}
        initialProviderKey={(sp.providerKey ?? "").trim()}
        initialDiscoverySourceId={(sp.discoverySourceId ?? "").trim()}
        initialOffset={parseBoundedInt(sp.offset, 0, 0, Number.MAX_SAFE_INTEGER)}
        initialLimit={parseBoundedInt(sp.limit, DEFAULT_REVIEW_LIMIT, 1, MAX_REVIEW_LIMIT)}
      />
    </section>
  );
}
