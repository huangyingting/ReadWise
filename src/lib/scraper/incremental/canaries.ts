/**
 * Phase-1 discovery CANARY configuration (issue #1090, Phase 1.10).
 *
 * This is the go/no-go proving set: three UNAUTHENTICATED, live-stable discovery
 * sources — one per common channel (RSS, sitemap, seed-HTML) — declaratively
 * configured so the SAME incremental-discovery model is proven against all three
 * input styles BEFORE body ingestion is ever enabled. It is DATA-ONLY (the house
 * convention for provider config): every canary is a plain record of stable keys,
 * an observable-window rule, a date-trust policy, a role, a schedule tier, an
 * overlap/stop rule, a validator-calibration interval, and an admission policy,
 * plus a `rationale` explaining WHY the source is representative and stable.
 *
 * Safety invariants enforced here:
 *   - No canary is ever configured `ACTIVE`; a canary starts DISABLED and is
 *     promoted through baseline → shadow → (gated) activate by an operator. The
 *     pure {@link assertNoCanaryAutoActivates} proves no registry sync can
 *     silently ACTIVATE a source.
 *   - Only unauthenticated sources are selected (no credential/OAuth provider).
 *   - Adapters fetch ONLY the one channel document; NONE fetches an article body
 *     (the governing invariant + AC4).
 */
import { DiscoveryAutomationPolicy, DiscoverySourceLifecycleMode, DiscoverySourceRole, type DiscoverySource } from "@prisma/client";

import type { DiscoveryPageFetcher } from "@/lib/scraper/incremental/discovery-run";

import { makeRssCanaryAdapter } from "./adapters/rss-adapter";
import { makeSeedHtmlCanaryAdapter } from "./adapters/html-seed-adapter";
import { makeSitemapCanaryAdapter } from "./adapters/sitemap-adapter";
import type { CanaryAdapterConfig, CanaryAdapterDeps, CanaryChannel } from "./adapters/types";

/** Overlap / stop rule for a canary's bounded observable window. */
export type CanaryOverlapRule = {
  /** Re-scan overlap size (identities) to detect same-timestamp / delayed entries. */
  overlapSize: number;
  /** Consecutive empty pages that terminate a paginated scan (single-doc canaries: 1). */
  consecutiveEmptyPages: number;
};

/** A single declarative canary definition. */
export type CanaryDefinition = {
  /** Stable, human-readable canary id (also the metrics/audit label). */
  id: string;
  /** Registered provider-registry key that owns the emitted identities. */
  providerKey: string;
  /** Stable source key (unique per provider + definition version). */
  sourceKey: string;
  /** Definition version — the cross-program guard; bumped on a replacement. */
  definitionVersion: number;
  /** The discovery channel (drives adapter selection). */
  channel: CanaryChannel;
  /** Mapped {@link DiscoverySourceRole} for scheduling + metrics. */
  role: DiscoverySourceRole;
  /**
   * The lifecycle mode a fresh canary is seeded in. MUST NOT be `ACTIVE` — a
   * canary is only ever promoted to ACTIVE by an operator through the gated
   * activation path.
   */
  seedLifecycleMode: DiscoverySourceLifecycleMode;
  /** Automation policy (SCHEDULED for the canaries; never CONTINUOUS in Phase 1). */
  automationPolicy: DiscoveryAutomationPolicy;
  /** Schedule tier cadence (seconds) — mirrors the pure scheduler's tiers. */
  pollIntervalSeconds: number;
  /** The adapter document config (the ONE URL fetched; never a body). */
  adapter: CanaryAdapterConfig;
  /** Overlap / stop rule for the observable window. */
  overlap: CanaryOverlapRule;
  /** Validator (ETag/Last-Modified) calibration interval, in completed runs. */
  validatorCalibrationIntervalRuns: number;
  /**
   * Sanitized admission-policy note: the emitted identities are admitted by the
   * SAME versioned provider `articleUrlPattern` / `articleUrlFilter` the rest of
   * the program uses (classify.ts). No canary-specific admission relaxation.
   */
  admissionPolicy: string;
  /** Per-run discovery budget (volume/cost bound checked by the exit gates). */
  discoveryBudgetPerRun: number;
  /** WHY this source is representative + stable (recorded for operators). */
  rationale: string;
};

const M = DiscoverySourceLifecycleMode;
const R = DiscoverySourceRole;
const A = DiscoveryAutomationPolicy;

const SHARED_ADMISSION =
  "versioned provider articleUrlPattern + articleUrlFilter (classify.ts); no canary-specific relaxation";

/**
 * The three Phase-1 canaries. One representative per channel, all unauthenticated
 * and live-stable, all seeded DISABLED (never ACTIVE).
 */
export const CANARIES: readonly CanaryDefinition[] = [
  {
    id: "canary-rss-theconversation",
    providerKey: "theconversation",
    sourceKey: "canary-rss",
    definitionVersion: 1,
    channel: "rss",
    role: R.PRIMARY_FEED,
    seedLifecycleMode: M.DISABLED,
    automationPolicy: A.SCHEDULED,
    pollIntervalSeconds: 15 * 60,
    adapter: {
      channel: "rss",
      documentUrl: "https://theconversation.com/articles.atom",
      dateTrust: "trusted",
    },
    overlap: { overlapSize: 25, consecutiveEmptyPages: 1 },
    validatorCalibrationIntervalRuns: 24,
    admissionPolicy: SHARED_ADMISSION,
    discoveryBudgetPerRun: 200,
    rationale:
      "The Conversation publishes a stable, high-volume RSS/Atom feed of unauthenticated public " +
      "articles with a trusted <published> date (FEED provenance) — the canonical representative " +
      "of the RSS discovery channel.",
  },
  {
    id: "canary-sitemap-worksinprogress",
    providerKey: "worksinprogress",
    sourceKey: "canary-sitemap",
    definitionVersion: 1,
    channel: "sitemap",
    role: R.SITEMAP,
    seedLifecycleMode: M.DISABLED,
    automationPolicy: A.SCHEDULED,
    pollIntervalSeconds: 6 * 60 * 60,
    adapter: {
      channel: "sitemap",
      documentUrl: "https://worksinprogress.co/post-sitemap.xml",
      dateTrust: "trusted",
    },
    overlap: { overlapSize: 25, consecutiveEmptyPages: 1 },
    validatorCalibrationIntervalRuns: 8,
    admissionPolicy: SHARED_ADMISSION,
    discoveryBudgetPerRun: 200,
    rationale:
      "Works in Progress exposes a small, well-formed <urlset> sitemap with trusted <lastmod> " +
      "(PAGE_METADATA provenance) for unauthenticated public issues — the canonical representative " +
      "of the sitemap discovery channel.",
  },
  {
    id: "canary-seed-html-undark",
    providerKey: "undark",
    sourceKey: "canary-seed-html",
    definitionVersion: 1,
    channel: "seed-html",
    role: R.SECTION_INDEX,
    seedLifecycleMode: M.DISABLED,
    automationPolicy: A.SCHEDULED,
    pollIntervalSeconds: 6 * 60 * 60,
    adapter: {
      channel: "seed-html",
      documentUrl: "https://undark.org/",
      dateTrust: "untrusted",
    },
    overlap: { overlapSize: 25, consecutiveEmptyPages: 1 },
    validatorCalibrationIntervalRuns: 8,
    admissionPolicy: SHARED_ADMISSION,
    discoveryBudgetPerRun: 200,
    rationale:
      "Undark's section index is a plain unauthenticated HTML page whose anchors are article links " +
      "with NO trusted per-item date (URL provenance → review-required in ACTIVE) — the canonical " +
      "representative of the seed-HTML discovery channel and the strictest date-trust case.",
  },
];

/**
 * Asserts NO canary is configured to auto-activate (seeded ACTIVE). Any registry
 * sync that seeds these definitions must go through the operator-driven,
 * gate-enforced activation path — never flip straight to ACTIVE. Throws with a
 * sanitized message listing the offending canary ids.
 */
export function assertNoCanaryAutoActivates(canaries: readonly CanaryDefinition[] = CANARIES): void {
  const offenders = canaries
    .filter((c) => c.seedLifecycleMode === M.ACTIVE)
    .map((c) => c.id);
  if (offenders.length > 0) {
    throw new Error(`canary definitions must not seed ACTIVE: ${offenders.join(", ")}`);
  }
}

/** Looks up a canary definition by its provider + source key. */
export function findCanary(providerKey: string, sourceKey: string): CanaryDefinition | null {
  return CANARIES.find((c) => c.providerKey === providerKey && c.sourceKey === sourceKey) ?? null;
}

/** True when a `(providerKey, sourceKey)` pair identifies a configured canary. */
export function isCanarySource(providerKey: string, sourceKey: string): boolean {
  return findCanary(providerKey, sourceKey) !== null;
}

/** Builds the channel-appropriate {@link DiscoveryPageFetcher} for a canary. */
export function canaryAdapterFor(
  canary: CanaryDefinition,
  deps: CanaryAdapterDeps,
): DiscoveryPageFetcher {
  switch (canary.channel) {
    case "rss":
      return makeRssCanaryAdapter(canary.adapter, deps);
    case "sitemap":
      return makeSitemapCanaryAdapter(canary.adapter, deps);
    case "seed-html":
      return makeSeedHtmlCanaryAdapter(canary.adapter, deps);
  }
}

/**
 * Resolves the {@link DiscoveryPageFetcher} for a live {@link DiscoverySource}
 * row when it is one of the configured canaries; returns `null` for a
 * non-canary source (which is never activated by this phase). This is where the
 * discovery loop would wire a canary adapter as its `fetchPage`.
 */
export function selectCanaryAdapterForSource(
  source: Pick<DiscoverySource, "providerKey" | "sourceKey">,
  deps: CanaryAdapterDeps,
): DiscoveryPageFetcher | null {
  const canary = findCanary(source.providerKey, source.sourceKey);
  return canary ? canaryAdapterFor(canary, deps) : null;
}
