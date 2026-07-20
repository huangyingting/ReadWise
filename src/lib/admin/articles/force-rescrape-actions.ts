import { postJson } from "@/lib/client-fetch";

/**
 * Client-callable helpers for the operator force-rescrape trigger (#1142).
 *
 * The heavyweight force-rescrape backend (#1102/#1103/#1129) is exposed at
 * `POST /api/admin/articles/{id}/force-rescrape`. This module is the small,
 * behaviourally-testable seam the `AdminForceRescrapePanel` island calls: it
 * owns ONLY the endpoint + request shape so a unit test can drive it by mocking
 * `postJson`, and it never pulls the Prisma runtime into the browser bundle.
 *
 * The request body is exactly `{ reason, dryRun }` — the mandatory operator
 * justification and the preview flag, nothing else (no URL, no content).
 */

/**
 * Metadata-only fields of a dry-run preview the panel surfaces. The route
 * returns the full preview object; this structural subset is all the operator
 * summary reads (never any URL, title, or article content).
 */
export interface ForceRescrapePreview {
  articleId: string;
  annotationCount: number;
  migratorWired: boolean;
  wouldActivate: boolean;
  blockedReason?: string;
}

/** A metadata-only dry-run preview — nothing was written. */
export interface ForceRescrapeDryRunResponse {
  ok: true;
  dryRun: true;
  preview: ForceRescrapePreview;
}

/** The replacement was validated and ATOMICALLY activated (same Article id). */
export interface ForceRescrapeActivatedResponse {
  ok: true;
  dryRun: false;
  outcome: "activated";
  articleId: string;
  versionId: string;
  supersededVersionId: string | null;
}

/** A controlled failure — the current version and all reader access are retained. */
export interface ForceRescrapeFailedResponse {
  ok: true;
  dryRun: false;
  outcome: "failed";
  articleId: string;
  versionId: string;
  reason: string;
}

/** The union of successful (2xx) force-rescrape responses. 4xx/409/503 throw. */
export type ForceRescrapeResponse =
  | ForceRescrapeDryRunResponse
  | ForceRescrapeActivatedResponse
  | ForceRescrapeFailedResponse;

/** The force-rescrape trigger endpoint for a given article id. */
export function forceRescrapeEndpoint(articleId: string): string {
  return `/api/admin/articles/${articleId}/force-rescrape`;
}

/**
 * Preview (dryRun=true) or request (dryRun=false) a force-rescrape of ONE known
 * public Article. `postJson` attaches CSRF + credentials and throws
 * `ApiResponseError` on 4xx/409/503 so the calling island can surface the
 * server's `error` string. Sends only `{ reason, dryRun }`.
 */
export function submitForceRescrape(
  articleId: string,
  reason: string,
  dryRun: boolean,
): Promise<ForceRescrapeResponse> {
  return postJson<ForceRescrapeResponse>(forceRescrapeEndpoint(articleId), {
    reason,
    dryRun,
  });
}
