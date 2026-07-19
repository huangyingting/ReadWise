/**
 * Phase-2.8 measured public-rollout BATCH / TIER configuration (issue #1098).
 *
 * DATA-ONLY declarative config (the house convention for provider config, mirrors
 * `canaries.ts`): the rollout of REAL body ingestion to public providers is
 * grouped into ordered BATCHES by discovery STRATEGY / RISK class (RSS vs sitemap
 * vs seed-HTML), so a framework defect (present across every channel) is
 * distinguishable from a provider-adapter defect (isolated to one channel), and
 * each channel is expanded with LOW per-day body-ingestion + downstream-work
 * limits that ramp up across tiers as the framework is proven.
 *
 * Batch order + risk rationale:
 *   0. `tier-0-canaries`  — the three Phase-1 canaries (one per channel). The
 *      proving set: discovery already passed exit gates in shadow; this batch is
 *      the FIRST to enable real body ingestion, at the lowest limits.
 *   1. `tier-1-rss`       — RSS/Atom feeds with a TRUSTED per-item date (lowest
 *      risk after the canaries); the framework is proven, expand the safest channel.
 *   2. `tier-2-sitemap`   — sitemaps with a trusted `<lastmod>`; higher aggregate
 *      volume once RSS is stable.
 *   3. `tier-3-seed-html` — seed-index HTML with NO trusted per-item date (the
 *      strictest date-trust case). Highest per-day cap because untrusted-date
 *      drafts NEVER auto-publish (Phase 2.6) — they all land as review-required
 *      drafts, so ingest volume carries no publication risk.
 *
 * Safety invariants enforced here (pure guards, mirroring
 * `assertNoCanaryAutoActivates`):
 *   - No batch member ever auto-activates: registry sync alone can NEVER flip a
 *     source ACTIVE. Every member still requires its OWN baseline → shadow
 *     acceptance ({@link assertNoBatchSkipsBaseline}).
 *   - Authenticated providers are EXCLUDED from every public batch — auth is
 *     #1099's scope, an explicit non-goal here
 *     ({@link assertNoAuthenticatedProviderInBatch}).
 *   - Batches are strictly ordered and never skip ahead
 *     ({@link assertBatchesOrdered}).
 *
 * PRIVACY: every field is a stable key, channel enum, count, or rationale label —
 * never a URL, body, credential, or user content.
 */
import { CANARIES } from "./canaries";
import type { CanaryChannel } from "./adapters/types";

/** The discovery strategy / risk class a rollout batch expands. */
export type RolloutRiskClass = "canary" | "rss" | "sitemap" | "seed-html";

/**
 * Per-day / concurrency limits for one rollout tier. LOW and ramping up across
 * tiers so the blast radius of a defect stays bounded during measured rollout.
 */
export type RolloutTierLimits = {
  /** Max bodies ingested per day across the whole tier (cost + blast-radius cap). */
  maxBodyIngestPerDay: number;
  /** Max downstream enrichment jobs (ARTICLE_PROCESS) enqueued per day. */
  maxDownstreamJobsPerDay: number;
  /** Max sources activated concurrently within this tier. */
  maxConcurrentSources: number;
};

/**
 * One member of a rollout batch. `autoActivate` and `requiresAuth` are compile-
 * time `false` literals so a member that violated either invariant would not
 * type-check; the runtime guards below re-assert them for defence in depth.
 */
export type RolloutBatchMember = {
  /** Registered provider-registry key that owns the emitted identities. */
  providerKey: string;
  /** Stable source key (unique per provider + definition version). */
  sourceKey: string;
  /** Discovery channel (drives which adapter/strategy is under test). */
  channel: CanaryChannel;
  /**
   * MUST be `false`: no member auto-activates. Registry sync seeds a member
   * DISABLED; only the operator-driven, gate-enforced path (baseline → shadow →
   * gated activate) can make it ACTIVE.
   */
  autoActivate: false;
  /**
   * MUST be `false`: public batches exclude authenticated providers (#1099
   * scope). A credentialed provider is never a public-rollout member.
   */
  requiresAuth: false;
};

/** A single declarative rollout batch. */
export type RolloutBatch = {
  /** Ordinal — batches roll out in ascending order; a batch never skips ahead. */
  order: number;
  /** Stable batch id (also the metrics/audit label). */
  id: string;
  /** The strategy/risk class this batch expands. */
  riskClass: RolloutRiskClass;
  /** Channels covered by the batch (isolates framework vs adapter defects). */
  channels: readonly CanaryChannel[];
  /** Per-day + concurrency limits for the tier. */
  limits: RolloutTierLimits;
  /**
   * Member source identities. Each is still baseline→shadow gated; an expansion
   * batch may start empty (operators append same-channel public sources as they
   * pass acceptance) — registry sync never activates them.
   */
  members: readonly RolloutBatchMember[];
  /** WHY this batch sits at this risk tier + these limits (recorded for operators). */
  rationale: string;
};

/** Builds a canary batch member from the shared canary config (no auto-activate). */
function canaryMember(channel: CanaryChannel): RolloutBatchMember {
  const canary = CANARIES.find((c) => c.channel === channel);
  if (!canary) {
    throw new Error(`no canary configured for channel: ${channel}`);
  }
  return {
    providerKey: canary.providerKey,
    sourceKey: canary.sourceKey,
    channel: canary.channel,
    autoActivate: false,
    requiresAuth: false,
  };
}

/**
 * The ordered public-rollout batches. Batch 0 is the three Phase-1 canaries (the
 * proving set); batches 1–3 expand ONE channel each with ramping limits. Expansion
 * batches start EMPTY of additional members — operators append public same-channel
 * sources that each pass baseline → shadow acceptance (registry sync never
 * activates them). No authenticated provider appears in any batch (#1099).
 */
export const ROLLOUT_BATCHES: readonly RolloutBatch[] = [
  {
    order: 0,
    id: "tier-0-canaries",
    riskClass: "canary",
    channels: ["rss", "sitemap", "seed-html"],
    limits: { maxBodyIngestPerDay: 25, maxDownstreamJobsPerDay: 25, maxConcurrentSources: 3 },
    members: [canaryMember("rss"), canaryMember("sitemap"), canaryMember("seed-html")],
    rationale:
      "The three Phase-1 canaries (one per channel) proved discovery correctness in shadow. This " +
      "is the FIRST batch to enable real body ingestion, at the lowest limits, so the save + " +
      "publication + rollback path is exercised across all three input styles before any expansion.",
  },
  {
    order: 1,
    id: "tier-1-rss",
    riskClass: "rss",
    channels: ["rss"],
    limits: { maxBodyIngestPerDay: 100, maxDownstreamJobsPerDay: 100, maxConcurrentSources: 5 },
    members: [],
    rationale:
      "RSS/Atom feeds carry a TRUSTED per-item publication date (FEED provenance), the lowest-risk " +
      "channel once the framework is proven. Operators append public RSS sources here, each gated " +
      "through its own baseline → shadow acceptance.",
  },
  {
    order: 2,
    id: "tier-2-sitemap",
    riskClass: "sitemap",
    channels: ["sitemap"],
    limits: { maxBodyIngestPerDay: 250, maxDownstreamJobsPerDay: 250, maxConcurrentSources: 8 },
    members: [],
    rationale:
      "Sitemaps carry a trusted <lastmod> (PAGE_METADATA provenance); once RSS is stable the " +
      "framework supports a higher aggregate volume. Operators append public sitemap sources here, " +
      "each gated through its own baseline → shadow acceptance.",
  },
  {
    order: 3,
    id: "tier-3-seed-html",
    riskClass: "seed-html",
    channels: ["seed-html"],
    limits: { maxBodyIngestPerDay: 500, maxDownstreamJobsPerDay: 500, maxConcurrentSources: 8 },
    members: [],
    rationale:
      "Seed-index HTML has NO trusted per-item date (the strictest date-trust case). Its higher " +
      "per-day cap is safe because untrusted-date drafts NEVER auto-publish (Phase 2.6): they all " +
      "land as review-required drafts, so ingest volume carries no publication risk. Operators " +
      "append public seed-HTML sources here, each gated through its own baseline → shadow acceptance.",
  },
];

/** Finds the rollout batch that a `(providerKey, sourceKey)` member belongs to. */
export function findRolloutBatchForSource(
  providerKey: string,
  sourceKey: string,
  batches: readonly RolloutBatch[] = ROLLOUT_BATCHES,
): RolloutBatch | null {
  return (
    batches.find((batch) =>
      batch.members.some((m) => m.providerKey === providerKey && m.sourceKey === sourceKey),
    ) ?? null
  );
}

/** Looks up the tier limits for a member source, or `null` when it is not batched. */
export function tierLimitsForSource(
  providerKey: string,
  sourceKey: string,
  batches: readonly RolloutBatch[] = ROLLOUT_BATCHES,
): RolloutTierLimits | null {
  return findRolloutBatchForSource(providerKey, sourceKey, batches)?.limits ?? null;
}

/**
 * Asserts NO batch member is configured to auto-activate. Registry sync must seed
 * every member DISABLED and let the operator-driven, gate-enforced path
 * (baseline → shadow → gated activate) promote it — never flip straight to
 * ACTIVE. Throws with a sanitized message listing the offending members.
 */
export function assertNoBatchSkipsBaseline(
  batches: readonly RolloutBatch[] = ROLLOUT_BATCHES,
): void {
  const offenders: string[] = [];
  for (const batch of batches) {
    for (const member of batch.members) {
      if (member.autoActivate !== false) {
        offenders.push(`${batch.id}:${member.providerKey}/${member.sourceKey}`);
      }
    }
  }
  if (offenders.length > 0) {
    throw new Error(`rollout batch members must not auto-activate: ${offenders.join(", ")}`);
  }
}

/**
 * Asserts NO authenticated provider appears in any public batch (auth is #1099's
 * scope, an explicit non-goal here). Checks the member's static `requiresAuth`
 * flag and, when supplied, cross-checks each member's provider key against a set
 * of known authenticated provider keys. Throws with a sanitized message listing
 * the offending members.
 */
export function assertNoAuthenticatedProviderInBatch(
  batches: readonly RolloutBatch[] = ROLLOUT_BATCHES,
  authenticatedProviderKeys: ReadonlySet<string> = new Set(),
): void {
  const offenders: string[] = [];
  for (const batch of batches) {
    for (const member of batch.members) {
      if (member.requiresAuth !== false || authenticatedProviderKeys.has(member.providerKey)) {
        offenders.push(`${batch.id}:${member.providerKey}/${member.sourceKey}`);
      }
    }
  }
  if (offenders.length > 0) {
    throw new Error(`public rollout batches must exclude authenticated providers: ${offenders.join(", ")}`);
  }
}

/**
 * Asserts the batches form a strict, gap-free ascending order starting at 0, so a
 * batch can never silently skip ahead of an earlier, less-proven tier. Throws
 * with a sanitized message on any duplicate or out-of-sequence ordinal.
 */
export function assertBatchesOrdered(batches: readonly RolloutBatch[] = ROLLOUT_BATCHES): void {
  const orders = batches.map((b) => b.order);
  for (let i = 0; i < orders.length; i += 1) {
    if (orders[i] !== i) {
      throw new Error(
        `rollout batches must be a gap-free ascending sequence from 0: got [${orders.join(", ")}]`,
      );
    }
  }
}
