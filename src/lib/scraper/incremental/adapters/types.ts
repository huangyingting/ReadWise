/**
 * Canary discovery adapters (issue #1090, Phase 1.10).
 *
 * A canary adapter implements the {@link DiscoveryPageFetcher} seam
 * (`discovery-run.ts`) for ONE discovery channel (RSS / sitemap / seed-HTML) and
 * yields sanitized {@link DiscoveryPageItem}s for a SINGLE bounded observable
 * window. It is the proving ground for the common incremental-discovery model in
 * Phase 1 — so it structurally performs NO article-body work: it fetches ONLY the
 * one channel document (a feed, a sitemap, or a seed index page) via the injected
 * SSRF-safe {@link DiscoveryFetch} seam and never issues a per-item request. There
 * is no code path from an adapter to an article body, an Article write, or an
 * ingest job (the governing invariant + AC4).
 *
 * Adapters are fixture-driven in tests: the {@link DiscoveryFetch} is injected so
 * a canned {@link DiscoveryFetchResult} drives the whole pipeline with zero
 * network. The observable-window rule is "single document" — the entire fetched
 * channel document is the current observable window, so `boundaryReached` is
 * always `true` on a successful fetch (we saw everything currently observable).
 */
import type { DiscoverySource } from "@prisma/client";

import type { DiscoveryFetch } from "@/lib/scraper/fetch";
import type { DiscoveryPageItem, DiscoveryPageResult } from "@/lib/scraper/incremental/classify";
import type { DiscoveryPageFetcher } from "@/lib/scraper/incremental/discovery-run";

/** The discovery channel a canary adapter reads. */
export type CanaryChannel = "rss" | "sitemap" | "seed-html";

/**
 * Trust policy for a channel's per-item publication date. Only a TRUSTED date is
 * carried as a `publishedAt` + provenance; an untrusted channel yields undated
 * items (which are `review-required` in ACTIVE mode — never silently windowed).
 */
export type DateTrustPolicy = "trusted" | "untrusted";

/** Declarative configuration a canary adapter needs to read its one document. */
export type CanaryAdapterConfig = {
  channel: CanaryChannel;
  /**
   * The single channel document URL (feed / sitemap / seed index). This is the
   * ONLY URL an adapter ever fetches — never a per-article body. Used as the base
   * for resolving relative anchors in the seed-HTML adapter.
   */
  documentUrl: string;
  /** Whether the channel's per-item date is trusted (see {@link DateTrustPolicy}). */
  dateTrust: DateTrustPolicy;
  /**
   * Hard cap on items emitted from one document, bounding a single page. Defaults
   * to {@link DEFAULT_CANARY_ITEM_CAP}. The whole (capped) document is one
   * observable window, so `boundaryReached` stays `true`.
   */
  maxItems?: number;
};

/** Default per-document item cap (a single bounded observable window). */
export const DEFAULT_CANARY_ITEM_CAP = 200;

/** Injected dependencies for a canary adapter (network stays injectable/testable). */
export type CanaryAdapterDeps = {
  /** SSRF-safe response-metadata fetch for the ONE channel document. */
  fetchResponse: DiscoveryFetch;
};

/**
 * Thrown when a canary adapter cannot read its channel document. The run handler
 * (`discovery-run.ts`) catches it, records a REDACTED metadata-only `lastError`,
 * and backs the source off — a canary fault never stops the loop and never
 * touches an article body.
 */
export class CanaryFetchError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`canary document fetch failed: ${reason}`);
    this.name = "CanaryFetchError";
    this.reason = reason;
  }
}

/**
 * Shared fetch + typed-outcome handling for every canary adapter. Returns the
 * decoded body for an `ok` outcome (to be parsed by the channel-specific mapper),
 * `null` for `not-modified` (nothing changed → empty page, boundary reached), and
 * THROWS a {@link CanaryFetchError} for retryable / error / blocked outcomes so
 * the run handler isolates the source. Validators are surfaced for the commit.
 */
export async function fetchCanaryDocument(
  config: CanaryAdapterConfig,
  deps: CanaryAdapterDeps,
  signal?: AbortSignal,
): Promise<{ body: string | null; validators: DiscoveryPageResult["validators"] }> {
  const result = await deps.fetchResponse(config.documentUrl, { signal });
  switch (result.outcome) {
    case "ok":
      return {
        body: result.body,
        validators: {
          ...(result.validators.etag ? { etag: result.validators.etag } : {}),
          ...(result.validators.lastModified ? { lastModified: result.validators.lastModified } : {}),
        },
      };
    case "not-modified":
      return {
        body: null,
        validators: {
          ...(result.validators.etag ? { etag: result.validators.etag } : {}),
          ...(result.validators.lastModified ? { lastModified: result.validators.lastModified } : {}),
        },
      };
    case "retryable":
      throw new CanaryFetchError(`retryable-${result.status}`);
    case "error":
      throw new CanaryFetchError(`http-${result.status}`);
    case "blocked":
      throw new CanaryFetchError(`blocked-${result.reason}`);
  }
}

/** Builds an empty (nothing-changed) page result carrying only the validators. */
export function emptyCanaryPage(
  validators: DiscoveryPageResult["validators"],
): DiscoveryPageResult {
  return {
    items: [],
    continuation: null,
    boundaryReached: true,
    ...(validators && (validators.etag || validators.lastModified) ? { validators } : {}),
  };
}

/**
 * Wraps a channel-specific mapper into a {@link DiscoveryPageFetcher}. The
 * resulting fetcher reads the ONE document, applies the mapper (which never
 * fetches a body), caps the items, and returns a single-window page with
 * `boundaryReached = true`. The `_source`/`_signal` are accepted for the seam
 * contract but a canary adapter is configured by `config`, not by mutable source
 * state, so its behaviour stays deterministic and fixture-reproducible.
 */
export function buildCanaryFetcher(
  config: CanaryAdapterConfig,
  deps: CanaryAdapterDeps,
  mapBody: (body: string, config: CanaryAdapterConfig) => DiscoveryPageItem[],
): DiscoveryPageFetcher {
  const cap = config.maxItems ?? DEFAULT_CANARY_ITEM_CAP;
  return async (input: { source: DiscoverySource; signal?: AbortSignal }): Promise<DiscoveryPageResult> => {
    const { body, validators } = await fetchCanaryDocument(config, deps, input.signal);
    if (body === null) return emptyCanaryPage(validators);
    const items = mapBody(body, config).slice(0, cap);
    return {
      items,
      continuation: null,
      boundaryReached: true,
      ...(validators && (validators.etag || validators.lastModified) ? { validators } : {}),
    };
  };
}
