/**
 * PURE, client-safe helpers for the admin series article-manager island (#1157).
 *
 * The admin Series table could create a series, edit metadata, and reorder its
 * members — but had NO way to ADD or REMOVE articles, so an operator could
 * create a series that could never be populated. This owns the presentation
 * contract for wiring `GET /api/admin/series/[id]` (resolved titles),
 * `GET /api/admin/articles?q=…` (search), and `PATCH /api/admin/series/[id]`
 * (persist the resulting ordered `articleIds`) into the UI WITHOUT any
 * React/DOM/network: the endpoint builders, the pure array helpers the island's
 * local state uses, and the response DTOs.
 *
 * Privacy by construction: the detail DTO is a narrow `Pick` of PUBLIC metadata
 * (`id`, `articleIds`, `articles.{id,title,slug}`) and the search DTO reads only
 * `id` + `title`. No body text, notes, or learner content is ever referenced.
 * The array helpers (`addArticleId`, `removeArticleId`) are pure + immutable;
 * order/reorder reuse the shared `moveArticleId`/`sameOrder` helpers.
 */
import type {
  AdminSeriesDetailWithArticles,
  SeriesArticleRef,
} from "@/lib/engagement/series";

/** A resolved series member (public metadata only). */
export type SeriesManagerArticle = SeriesArticleRef;

/** The only fields the manager reads back from the detail route. */
export type SeriesManagerDetail = Pick<
  AdminSeriesDetailWithArticles,
  "id" | "articleIds" | "articles"
>;

/** The `{ series }` body returned by the admin series detail route. */
export interface SeriesManagerDetailResponse {
  series: SeriesManagerDetail;
}

/** The minimal admin-article search hit the "Add" list renders. */
export interface AdminArticleSearchHit {
  id: string;
  title: string;
}

/** The admin-article search response subset the manager consumes. */
export interface AdminArticleSearchResponse {
  articles: AdminArticleSearchHit[];
}

/** The admin single-series detail endpoint (GET titles, PATCH `{ articleIds }`). */
export function seriesManageEndpoint(id: string): string {
  return `/api/admin/series/${id}`;
}

/** The admin article-search endpoint for the "Add articles" picker. */
export function adminArticlesSearchEndpoint(query: string): string {
  const params = new URLSearchParams();
  const q = query.trim();
  if (q.length > 0) params.set("q", q);
  const qs = params.toString();
  return qs.length > 0 ? `/api/admin/articles?${qs}` : "/api/admin/articles";
}

/**
 * Appends `id` to the ordered list if it is not already a member. Returns a NEW
 * array; the input is never mutated. PURE.
 */
export function addArticleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.slice() : [...ids, id];
}

/**
 * Removes every occurrence of `id` from the ordered list. Returns a NEW array;
 * the input is never mutated. PURE.
 */
export function removeArticleId(ids: readonly string[], id: string): string[] {
  return ids.filter((entry) => entry !== id);
}
