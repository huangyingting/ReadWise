/**
 * PURE per-item classification for one bounded discovery page (issue #1085,
 * Phase 1.5).
 *
 * This module contains NO database or network access. Given a page of
 * discovered items and a context snapshot (source lifecycle mode, the frontier
 * window, and the set of identity keys already present in the ledger), it
 * derives an explicit, deterministic outcome for every item WITHOUT fetching an
 * article body. The transactional commit (`page-commit.ts`) consumes these
 * outcomes; keeping classification pure makes it separately unit-testable and
 * guarantees routes/scripts/workers cannot re-implement the admission rules.
 *
 * Identity mapping is kept CONSISTENT with the #1083 baseline seed: the #1082
 * string version tag (`"v1"`) maps to the numeric `identityVersion` column via
 * {@link identityVersionToInt}, and the full versioned key emitted by #1082
 * (`"v1:<sha256hex>"`) is used as the `provisionalKey`.
 *
 * Outcome vocabulary (exactly one per item):
 *   - `eligible`          — ACTIVE source, admitted, dated, first observed after
 *                           the frontier window: a new active candidate.
 *   - `baseline-shadow`   — BASELINE/SHADOW (or any non-ACTIVE) source: observed
 *                           for completeness; NEVER creates an Article.
 *   - `existing-identity` — the identity is already in the ledger; re-observed,
 *                           never re-ingested.
 *   - `policy-rejected`   — the URL is unparseable, unsupported, owned by no
 *                           registered provider, or fails versioned admission.
 *   - `outside-window`    — ACTIVE source, admitted, dated, but at or before the
 *                           frontier window (already behind the frontier).
 *   - `review-required`   — ACTIVE source, admitted, but undated (no trusted
 *                           publication date to decide window membership).
 */
import { createHash } from "node:crypto";

import { CandidateDateProvenance, DiscoverySourceLifecycleMode } from "@prisma/client";

import { getProvider, providerForUrl } from "@/lib/scraper/providers";
import type { Provider } from "@/lib/scraper/types";
import {
  UrlIdentityError,
  deriveProvisionalIdentity,
  type UrlIdentity,
} from "@/lib/scraper/url-identity";

import { identityVersionToInt } from "./baseline-backfill";

/**
 * A single discovered item on a page. Built on the #1084 `DiscoveredUrl` shape
 * (see {@link pageItemFromDiscoveredUrl}) but carries an explicit, controlled
 * date provenance and an optional adapter-provided stable item ID. `url` is a
 * secret-free discovered URL by the adapter contract; it is normalized here.
 */
export type DiscoveryPageItem = {
  /** Discovered URL (normalized to a sanitized identity here; never persisted raw). */
  url: string;
  /** Stable adapter item ID when available (sanitized). Used only as a fallback observation key. */
  stableId?: string;
  /** Trusted publication date when known. Absent → undated → review-required in ACTIVE mode. */
  publishedAt?: Date;
  /** Provenance of {@link publishedAt}. `UNKNOWN` (or absent) is treated as undated. */
  dateProvenance?: CandidateDateProvenance;
  /** Position of the item within the page (recorded on the observation). */
  positionRank?: number;
  /** Observed HTTP status for the item, when the adapter probed it. */
  httpStatus?: number;
};

/** Page-oriented adapter result: the unit committed atomically by #1085. */
export type DiscoveryPageResult = {
  /** Discovered items on this page, in adapter order. */
  items: DiscoveryPageItem[];
  /**
   * Continuation checkpoint to persist AFTER every item on this page is durably
   * classified. `null` means the page carried no forward continuation (the
   * checkpoint is left unchanged). A sanitized pagination token / page number.
   */
  continuation: { cursor?: string | null; page?: number | null } | null;
  /** True when the configured discovery boundary was reached on this page. */
  boundaryReached: boolean;
  /** Validator updates observed for the source on this page. */
  validators?: {
    etag?: string;
    lastModified?: string;
    /** Version/fingerprint of the admission validator that produced this page. */
    validatorVersion?: string;
  };
};

/** Exactly one of these is assigned to every classified item. */
export type PageItemOutcomeKind =
  | "eligible"
  | "baseline-shadow"
  | "existing-identity"
  | "policy-rejected"
  | "outside-window"
  | "review-required";

/** Controlled, metadata-only reason a URL was rejected by admission policy. */
export type PolicyRejectionReason =
  | "invalid-url"
  | "unsupported-scheme"
  | "no-registered-provider"
  | "admission-pattern"
  | "admission-filter";

/** Fully-resolved, admitted identity of an item (sanitized keys, never a raw URL). */
export type ClassifiedIdentity = {
  providerKey: string;
  identityVersion: number;
  /** Full versioned key (`"v1:<sha256hex>"`), consistent with #1083. */
  provisionalKey: string;
  /** Readable, secret-free canonical URL the key was derived from. */
  normalizedUrl: string;
};

/** The explicit outcome for one page item. */
export type ClassifiedPageItem = {
  item: DiscoveryPageItem;
  outcome: PageItemOutcomeKind;
  /**
   * Resolved identity, present for every outcome whose owning provider is known
   * (`eligible`, `baseline-shadow`, `existing-identity`, `outside-window`,
   * `review-required`, and admission-based `policy-rejected`). `null` only when
   * the URL is unparseable/unsupported or owned by no registered provider.
   */
  identity: ClassifiedIdentity | null;
  /**
   * Idempotency key for the item's `DiscoveryObservation`. The versioned
   * identity key when derivable; otherwise a one-way digest of the item's stable
   * ID / URL (never the raw URL). Stable across replays of the same page.
   */
  observationKey: string;
  /** Trusted publication date (present only when both a date AND provenance are known). */
  trustedPublishedAt: Date | null;
  dateProvenance: CandidateDateProvenance;
  /** Present only when `outcome === "policy-rejected"`. */
  rejectionReason?: PolicyRejectionReason;
};

/** Injectable dependencies + snapshot the pure classifier reads. */
export type PageClassificationContext = {
  /** Source lifecycle mode. Only `ACTIVE` runs the dated frontier-window logic. */
  lifecycleMode: DiscoverySourceLifecycleMode;
  /**
   * Exclusive lower bound for in-window items in ACTIVE mode. An item dated at
   * or before this instant is `outside-window`. `null` = no lower bound.
   * Typically `DiscoverySource.watermarkAt ?? baselineCompletedAt`.
   */
  windowStart: Date | null;
  /**
   * Composite identity keys already present in the ledger, as produced by
   * {@link identityCompositeKey}. Read by the caller BEFORE the transaction.
   */
  knownIdentityKeys: ReadonlySet<string>;
  /** Provider resolver override (defaults to {@link providerForUrl}). */
  resolveProvider?: (url: string) => Provider | null;
  /** Identity deriver override (defaults to {@link deriveProvisionalIdentity}). */
  deriveIdentity?: (url: string) => UrlIdentity;
};

/** Composite ledger identity key: `providerKey \0 identityVersion \0 provisionalKey`. */
export function identityCompositeKey(
  providerKey: string,
  identityVersion: number,
  provisionalKey: string,
): string {
  return `${providerKey}\u0000${identityVersion}\u0000${provisionalKey}`;
}

function isActiveMode(mode: DiscoverySourceLifecycleMode): boolean {
  return mode === DiscoverySourceLifecycleMode.ACTIVE;
}

function fallbackObservationKey(item: DiscoveryPageItem): string {
  if (item.stableId && item.stableId.length > 0) return `id:${item.stableId}`;
  // One-way digest: sanitized, non-reversible, never the raw URL.
  return `url:${createHash("sha256").update(item.url, "utf8").digest("hex")}`;
}

function resolveTrustedDate(item: DiscoveryPageItem): {
  trustedPublishedAt: Date | null;
  dateProvenance: CandidateDateProvenance;
} {
  const provenance = item.dateProvenance ?? CandidateDateProvenance.UNKNOWN;
  const hasTrustedDate =
    item.publishedAt != null &&
    !Number.isNaN(item.publishedAt.getTime()) &&
    provenance !== CandidateDateProvenance.UNKNOWN;
  return {
    trustedPublishedAt: hasTrustedDate ? item.publishedAt! : null,
    dateProvenance: hasTrustedDate ? provenance : CandidateDateProvenance.UNKNOWN,
  };
}

function classifyItem(
  item: DiscoveryPageItem,
  context: PageClassificationContext,
): ClassifiedPageItem {
  const deriveIdentity = context.deriveIdentity ?? deriveProvisionalIdentity;

  let derived: UrlIdentity;
  try {
    derived = deriveIdentity(item.url);
  } catch (error) {
    const reason: PolicyRejectionReason =
      error instanceof UrlIdentityError && error.code === "unsupported-scheme"
        ? "unsupported-scheme"
        : "invalid-url";
    return {
      item,
      outcome: "policy-rejected",
      identity: null,
      observationKey: fallbackObservationKey(item),
      trustedPublishedAt: null,
      dateProvenance: CandidateDateProvenance.UNKNOWN,
      rejectionReason: reason,
    };
  }

  const observationKey = derived.key;

  if (!derived.providerKey) {
    return {
      item,
      outcome: "policy-rejected",
      identity: null,
      observationKey,
      trustedPublishedAt: null,
      dateProvenance: CandidateDateProvenance.UNKNOWN,
      rejectionReason: "no-registered-provider",
    };
  }

  const provider = context.resolveProvider
    ? context.resolveProvider(derived.normalizedUrl)
    : (providerForUrl(derived.normalizedUrl) ?? getProvider(derived.providerKey));

  if (!provider) {
    return {
      item,
      outcome: "policy-rejected",
      identity: null,
      observationKey,
      trustedPublishedAt: null,
      dateProvenance: CandidateDateProvenance.UNKNOWN,
      rejectionReason: "no-registered-provider",
    };
  }

  const identity: ClassifiedIdentity = {
    providerKey: derived.providerKey,
    identityVersion: identityVersionToInt(derived.identityVersion),
    provisionalKey: derived.key,
    normalizedUrl: derived.normalizedUrl,
  };

  // Versioned provider admission rules (identical gate to discovery, #1084).
  if (!provider.articleUrlPattern.test(derived.normalizedUrl)) {
    return {
      item,
      outcome: "policy-rejected",
      identity,
      observationKey,
      trustedPublishedAt: null,
      dateProvenance: CandidateDateProvenance.UNKNOWN,
      rejectionReason: "admission-pattern",
    };
  }
  if (provider.articleUrlFilter && !provider.articleUrlFilter(derived.normalizedUrl)) {
    return {
      item,
      outcome: "policy-rejected",
      identity,
      observationKey,
      trustedPublishedAt: null,
      dateProvenance: CandidateDateProvenance.UNKNOWN,
      rejectionReason: "admission-filter",
    };
  }

  const { trustedPublishedAt, dateProvenance } = resolveTrustedDate(item);

  // A known identity is terminal: re-observed, never re-ingested. This takes
  // precedence over mode/window logic in every mode.
  if (
    context.knownIdentityKeys.has(
      identityCompositeKey(identity.providerKey, identity.identityVersion, identity.provisionalKey),
    )
  ) {
    return {
      item,
      outcome: "existing-identity",
      identity,
      observationKey,
      trustedPublishedAt,
      dateProvenance,
    };
  }

  // Only ACTIVE sources promote NEW identities to active candidates. BASELINE,
  // SHADOW, and every other non-active mode observe for completeness and NEVER
  // create an Article (governing invariant).
  if (!isActiveMode(context.lifecycleMode)) {
    return {
      item,
      outcome: "baseline-shadow",
      identity,
      observationKey,
      trustedPublishedAt,
      dateProvenance,
    };
  }

  if (trustedPublishedAt == null) {
    return {
      item,
      outcome: "review-required",
      identity,
      observationKey,
      trustedPublishedAt: null,
      dateProvenance: CandidateDateProvenance.UNKNOWN,
    };
  }

  if (context.windowStart != null && trustedPublishedAt.getTime() <= context.windowStart.getTime()) {
    return {
      item,
      outcome: "outside-window",
      identity,
      observationKey,
      trustedPublishedAt,
      dateProvenance,
    };
  }

  return {
    item,
    outcome: "eligible",
    identity,
    observationKey,
    trustedPublishedAt,
    dateProvenance,
  };
}

/**
 * PURE classification of a whole page. Deterministic for a stable input order;
 * performs no DB or network access. Every item is assigned exactly one
 * {@link PageItemOutcomeKind}.
 */
export function classifyPage(
  items: readonly DiscoveryPageItem[],
  context: PageClassificationContext,
): ClassifiedPageItem[] {
  return items.map((item) => classifyItem(item, context));
}

/**
 * Convenience mapper from a #1084 {@link DiscoveredUrl}-shaped record to a
 * {@link DiscoveryPageItem}. Adapters that already know a precise provenance
 * should construct {@link DiscoveryPageItem} directly; this mapper applies a
 * sane default provenance derived from the discovery source channel.
 */
export function pageItemFromDiscoveredUrl(discovered: {
  url: string;
  source?: string;
  publishedAt?: string;
  positionRank?: number;
  stableId?: string;
}): DiscoveryPageItem {
  const publishedAt =
    discovered.publishedAt && !Number.isNaN(Date.parse(discovered.publishedAt))
      ? new Date(discovered.publishedAt)
      : undefined;
  return {
    url: discovered.url,
    ...(discovered.stableId ? { stableId: discovered.stableId } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(publishedAt ? { dateProvenance: provenanceForChannel(discovered.source) } : {}),
    ...(discovered.positionRank != null ? { positionRank: discovered.positionRank } : {}),
  };
}

function provenanceForChannel(source: string | undefined): CandidateDateProvenance {
  switch (source) {
    case "rss":
    case "api":
      return CandidateDateProvenance.FEED;
    case "sitemap":
      return CandidateDateProvenance.PAGE_METADATA;
    default:
      return CandidateDateProvenance.URL;
  }
}
