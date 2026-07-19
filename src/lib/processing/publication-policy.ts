/**
 * PURE trusted-provider publication policy (issue #1096, Phase 2.6).
 *
 * Decides whether an incrementally-ingested provider DRAFT may be AUTO-published
 * or must stay in the existing human review flow (DRAFT). It is the single
 * source of truth for that gate and follows the pure-logic house style (no
 * database, network, or clock access; plain inputs → a decision plus a machine
 * reason code). It lives in `lib/processing` — the publish gate's owner — rather
 * than `lib/scraper` to respect the one-way processing↛scraper module boundary.
 *
 * Governing rules (never relaxed):
 *   1. Auto-publication requires EXPLICIT provider trust (`autoPublishTrusted`).
 *      An untrusted provider can NEVER gain auto-publication through a discovery
 *      setting alone — it always yields a reviewable draft.
 *   2. Public republication requires EXPLICIT `canRepublishPublicly`. Permission
 *      to fetch WITH credentials (`canFetchAuthenticated`) is a SEPARATE grant
 *      and can NEVER make content public on its own.
 *   3. Every required check (body quality, content safety, source ownership,
 *      mandatory metadata) must pass, and every REQUIRED enrichment step must be
 *      complete. Optional enrichment (translation/TTS/etc.) is NOT consulted.
 *   4. Anything missing/unknown is treated CONSERVATIVELY as a failure ⇒ the
 *      article stays a draft. We never auto-publish on an unverified signal.
 *
 * Every reason code below is a controlled machine label — never a URL, prompt,
 * response, article text, translation, or credential (AC4 / privacy invariant).
 */

/**
 * The two INDEPENDENT provider permissions that gate auto-publication. Both
 * default OFF at the schema level; authenticated-fetch permission is
 * deliberately absent here because it can NEVER contribute to publication.
 */
export type ProviderPublicationTrust = {
  /** Explicit trust to auto-publish validated drafts without human review. */
  autoPublishTrusted: boolean;
  /** Explicit permission to republish the source's content publicly. */
  canRepublishPublicly: boolean;
};

/**
 * Results of the four REQUIRED publication checks. Each is a boolean the caller
 * computes in-pipeline; a check that cannot be computed must be passed as
 * `false` (conservative gating).
 */
export type RequiredCheckResults = {
  /** Body meets the minimum publishable-quality bar. */
  bodyQualityOk: boolean;
  /** Content safety screen passed (no flagged high-harm content). */
  contentSafetyOk: boolean;
  /** Source-ownership chain is intact (linked to its trusted provider source). */
  sourceOwnershipOk: boolean;
  /** Mandatory metadata (title, publish date, source, body) is present. */
  mandatoryMetadataOk: boolean;
};

export type PublicationDecisionInput = {
  trust: ProviderPublicationTrust;
  checks: RequiredCheckResults;
  /**
   * Whether every REQUIRED enrichment step (difficulty, tags, vocabulary, quiz)
   * completed. Optional enrichment (translation/TTS) is intentionally excluded —
   * a failed optional step must NOT block a publishable trusted article.
   */
  requiredEnrichmentComplete: boolean;
};

export type PublicationAction = "auto-publish" | "leave-in-review";

/** Machine reason codes — controlled labels only, never sensitive content. */
export type PublicationReason =
  | "provider-not-auto-publish-trusted"
  | "public-republication-not-permitted"
  | "required-check-failed:body-quality"
  | "required-check-failed:content-safety"
  | "required-check-failed:source-ownership"
  | "required-check-failed:mandatory-metadata"
  | "required-enrichment-incomplete"
  | "all-required-checks-passed";

export type PublicationDecision = {
  action: PublicationAction;
  reason: PublicationReason;
};

function leaveInReview(reason: PublicationReason): PublicationDecision {
  return { action: "leave-in-review", reason };
}

/**
 * Decides whether an incremental-provider DRAFT may be auto-published. Rules are
 * evaluated in a fixed, short-circuiting order so the returned reason is the
 * FIRST blocking condition (most-significant first: trust, then rights, then the
 * required checks, then required enrichment). Only when every gate passes does
 * it return `auto-publish`.
 */
export function decideIncrementalPublication(
  input: PublicationDecisionInput,
): PublicationDecision {
  const { trust, checks, requiredEnrichmentComplete } = input;

  // 1. Explicit auto-publish trust is mandatory (untrusted ⇒ always review).
  if (!trust.autoPublishTrusted) {
    return leaveInReview("provider-not-auto-publish-trusted");
  }
  // 2. Public republication permission is mandatory and separate from any
  //    authenticated-fetch permission (auth alone never publishes).
  if (!trust.canRepublishPublicly) {
    return leaveInReview("public-republication-not-permitted");
  }
  // 3. All required checks must pass (conservative: unknown was passed as false).
  if (!checks.bodyQualityOk) {
    return leaveInReview("required-check-failed:body-quality");
  }
  if (!checks.contentSafetyOk) {
    return leaveInReview("required-check-failed:content-safety");
  }
  if (!checks.sourceOwnershipOk) {
    return leaveInReview("required-check-failed:source-ownership");
  }
  if (!checks.mandatoryMetadataOk) {
    return leaveInReview("required-check-failed:mandatory-metadata");
  }
  // 4. Required enrichment must be complete; optional enrichment is ignored.
  if (!requiredEnrichmentComplete) {
    return leaveInReview("required-enrichment-incomplete");
  }
  return { action: "auto-publish", reason: "all-required-checks-passed" };
}

/**
 * A single linked candidate's trust view — the candidate's provider key plus the
 * (possibly null) discovery source it resolves to. `source` is null when the
 * DiscoverySource was deleted (`onDelete: SetNull`), in which case trust is
 * UNKNOWN and treated conservatively as untrusted.
 */
export type CandidateTrustView = {
  providerKey: string;
  source: {
    providerKey: string;
    autoPublishTrusted: boolean;
    canRepublishPublicly: boolean;
  } | null;
};

/**
 * Aggregates provider trust across ALL candidates linked to an article,
 * CONSERVATIVELY: a permission is granted only when there is at least one linked
 * candidate AND every linked candidate resolves to a source that grants it.
 * A single orphaned (source == null) or untrusted candidate withholds the grant,
 * so a stray alias/transfer can never upgrade an article to auto-publishable.
 */
export function resolveProviderTrust(
  candidates: readonly CandidateTrustView[],
): ProviderPublicationTrust {
  if (candidates.length === 0) {
    return { autoPublishTrusted: false, canRepublishPublicly: false };
  }
  return {
    autoPublishTrusted: candidates.every((c) => c.source?.autoPublishTrusted === true),
    canRepublishPublicly: candidates.every((c) => c.source?.canRepublishPublicly === true),
  };
}

/**
 * Whether the source-ownership chain is intact for every linked candidate: each
 * candidate must resolve to a non-null source whose `providerKey` matches the
 * candidate's own `providerKey`. A candidate orphaned by source deletion, or one
 * whose provider key drifted, fails the check (conservative ⇒ stay draft).
 */
export function resolveSourceOwnershipOk(
  candidates: readonly CandidateTrustView[],
): boolean {
  if (candidates.length === 0) {
    return false;
  }
  return candidates.every(
    (c) => c.source != null && c.source.providerKey === c.providerKey,
  );
}
