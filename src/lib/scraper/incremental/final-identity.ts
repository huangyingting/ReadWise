/**
 * PURE trusted-final-identity resolution + merge-winner selection (issue #1092,
 * Phase 2.2).
 *
 * This module contains NO database, network, or clock access. Given inputs a
 * future ingest pipeline (#1095) will PROVIDE after it fetches + extracts a
 * candidate body — the fetched final URL, the declared canonical URL, and the
 * candidate's owning provider — it decides how the candidate's TRUSTED final
 * identity should be handled BEFORE any Article is created:
 *
 *   - `keep-own-provider`     — the trusted canonical belongs to the SAME
 *                               owning provider (directly, or on one of its
 *                               explicitly-associated domains).
 *   - `transfer-to-provider`  — the trusted canonical belongs to ANOTHER
 *                               registered provider; ownership transfers and
 *                               that provider's admission policy has been
 *                               RE-RUN here (a URL that would not be admitted by
 *                               the new provider is routed to review, never
 *                               silently accepted under a laxer policy).
 *   - `route-to-review`       — an UNKNOWN cross-domain redirect/canonical, an
 *                               unparseable/unsupported URL, or a transfer whose
 *                               new-provider admission failed: parked for an
 *                               auditable human/heuristic decision, never
 *                               auto-accepted.
 *
 * All identity derivation delegates to the versioned #1082 identity module, so
 * keys stay SANITIZED + versioned (never raw secret-bearing URLs) and no
 * credential material can leak through a decision or a thrown error.
 *
 * The persistence that APPLIES a decision to the ledger (collision merge, status
 * transitions, job cancellation, conflict rows) lives in
 * `final-identity-commit.ts` — this module stays pure + separately unit-testable.
 */
import { getProvider } from "@/lib/scraper/providers";
import type { Provider } from "@/lib/scraper/types";
import {
  UrlIdentityError,
  deriveCanonicalIdentity,
  type UrlIdentity,
} from "@/lib/scraper/url-identity";

/** The three trusted-final-identity decisions. */
export type FinalIdentityDecision = "keep-own-provider" | "transfer-to-provider" | "route-to-review";

/** Machine-readable, secret-free reason a candidate is routed to review. */
export type FinalIdentityReviewReason =
  | "unknown-cross-domain-canonical"
  | "invalid-final-url"
  | "unsupported-scheme"
  | "transfer-admission-rejected";

/** Inputs the (future) ingest pipeline PROVIDES after fetch + extraction. */
export type FinalIdentityInput = {
  /** Provider key that currently owns the candidate. */
  owningProviderKey: string;
  /** The fetched final URL after redirects (secret-free by adapter contract; re-sanitized on derivation). */
  finalUrl: string;
  /** A declared `<link rel="canonical">` when present; authoritative over `finalUrl`. */
  canonicalUrl?: string | null;
};

/** Result of {@link resolveFinalIdentity}. Exactly one decision. */
export type FinalIdentityResolution =
  | { decision: "keep-own-provider"; identity: UrlIdentity }
  | { decision: "transfer-to-provider"; targetProviderKey: string; identity: UrlIdentity }
  | {
      decision: "route-to-review";
      reason: FinalIdentityReviewReason;
      /** The (best-effort) resolved identity, or null when the URL is unparseable/unsupported. */
      identity: UrlIdentity | null;
      /** The registered provider a rejected transfer targeted, when known. */
      targetProviderKey: string | null;
    };

/**
 * Re-runs a provider's ADMISSION policy — the same versioned gate discovery uses
 * (`articleUrlPattern` + optional `articleUrlFilter`). Used to re-validate a URL
 * against a NEW owning provider on a cross-provider ownership transfer, so a
 * candidate can never be admitted under a laxer provider's policy than the one
 * whose content it actually is.
 */
export function admittedByProvider(provider: Provider, normalizedUrl: string): boolean {
  if (!provider.articleUrlPattern.test(normalizedUrl)) return false;
  if (provider.articleUrlFilter && !provider.articleUrlFilter(normalizedUrl)) return false;
  return true;
}

/**
 * PURE resolution of a candidate's trusted final identity. Deterministic; no DB,
 * network, or clock. A declared canonical URL is authoritative; otherwise the
 * fetched final URL is used. The owning provider is required so that a canonical
 * on an explicitly-associated domain is accepted (host preserved).
 */
export function resolveFinalIdentity(input: FinalIdentityInput): FinalIdentityResolution {
  const { owningProviderKey } = input;
  const declared = input.canonicalUrl?.trim();
  const trustedUrl = declared && declared.length > 0 ? declared : input.finalUrl;

  let identity: UrlIdentity;
  try {
    identity = deriveCanonicalIdentity(trustedUrl, { owningProviderKey });
  } catch (error) {
    if (error instanceof UrlIdentityError) {
      const reason: FinalIdentityReviewReason =
        error.code === "unsupported-scheme"
          ? "unsupported-scheme"
          : error.code === "unknown-cross-domain-canonical"
            ? "unknown-cross-domain-canonical"
            : "invalid-final-url";
      return { decision: "route-to-review", reason, identity: null, targetProviderKey: null };
    }
    throw error;
  }

  // Same owning provider (directly or via an associated domain): keep ownership.
  if (identity.providerKey === owningProviderKey) {
    return { decision: "keep-own-provider", identity };
  }

  // A DIFFERENT registered provider owns the canonical. Transfer ownership only
  // after RE-RUNNING that provider's admission policy; never silently accept.
  const targetProviderKey = identity.providerKey;
  const target = targetProviderKey ? getProvider(targetProviderKey) : null;
  if (!target || !targetProviderKey) {
    // Defensive: identity carried a provider key with no registered provider.
    return {
      decision: "route-to-review",
      reason: "unknown-cross-domain-canonical",
      identity,
      targetProviderKey: null,
    };
  }
  if (!admittedByProvider(target, identity.normalizedUrl)) {
    return {
      decision: "route-to-review",
      reason: "transfer-admission-rejected",
      identity,
      targetProviderKey,
    };
  }
  return { decision: "transfer-to-provider", targetProviderKey, identity };
}

// ---------------------------------------------------------------------------
// Merge-winner selection (pure)
// ---------------------------------------------------------------------------

/** Minimal, secret-free view of a candidate participating in a collision merge. */
export type MergeParticipant = {
  id: string;
  firstObservedAt: Date;
  createdAt: Date;
  /** True when `articleId != null` — a KNOWN public Article (governing invariant). */
  hasArticle: boolean;
  /** True when the identity was first seen during a source baseline (a known identity). */
  observedInBaseline: boolean;
};

/** Outcome of {@link selectMergeWinner}. */
export type MergeWinnerDecision =
  | { kind: "merge"; winnerId: string; loserIds: string[] }
  | { kind: "review"; reason: "multiple-known-articles" };

function earlier(a: MergeParticipant, b: MergeParticipant): MergeParticipant {
  const at = a.firstObservedAt.getTime();
  const bt = b.firstObservedAt.getTime();
  if (at !== bt) return at < bt ? a : b;
  const ac = a.createdAt.getTime();
  const bc = b.createdAt.getTime();
  if (ac !== bc) return ac < bc ? a : b;
  // Final deterministic tiebreak on the cuid so the winner is stable.
  return a.id <= b.id ? a : b;
}

/**
 * PURE winner selection for a final-identity collision. The rules, in order:
 *
 *   1. If TWO OR MORE participants already have a public Article, the collision
 *      is unmergeable without touching a known Article (governing invariant), so
 *      it is routed to review.
 *   2. A KNOWN identity always wins so it is never touched: a participant with an
 *      Article beats everything; failing that, a baseline participant beats a
 *      fresh one. Among equally-protected participants the EARLIEST wins.
 *   3. Otherwise the EARLIEST candidate by `firstObservedAt`, then `createdAt`,
 *      then `id`, wins.
 *
 * Losers are every other participant; the caller folds them into the winner.
 */
export function selectMergeWinner(participants: readonly MergeParticipant[]): MergeWinnerDecision {
  if (participants.length === 0) {
    throw new Error("selectMergeWinner requires at least one participant");
  }

  const withArticle = participants.filter((p) => p.hasArticle);
  if (withArticle.length > 1) {
    return { kind: "review", reason: "multiple-known-articles" };
  }

  // Prefer a known Article, then a baseline identity, then earliest overall.
  const protectedTiers: Array<(p: MergeParticipant) => boolean> = [
    (p) => p.hasArticle,
    (p) => p.observedInBaseline,
  ];
  let pool = participants as readonly MergeParticipant[];
  for (const inTier of protectedTiers) {
    const tier = pool.filter(inTier);
    if (tier.length > 0) {
      pool = tier;
      break;
    }
  }

  const winner = pool.reduce((best, p) => earlier(best, p));
  const loserIds = participants.filter((p) => p.id !== winner.id).map((p) => p.id);
  return { kind: "merge", winnerId: winner.id, loserIds };
}

// ---------------------------------------------------------------------------
// Prose-fingerprint match decision (pure)
// ---------------------------------------------------------------------------

/** A candidate that shares a prose fingerprint with the one under resolution. */
export type FingerprintMatch = { candidateId: string; providerKey: string };

/** Split of fingerprint matches by whether they share the resolver's provider. */
export type FingerprintMatchDecision = {
  /** Same-provider matches — EXACT duplicates that are merged into the winner. */
  sameProviderIds: string[];
  /** Cross-provider matches — routed to review (rights/attribution may differ). */
  crossProviderIds: string[];
};

/**
 * PURE split of prose-fingerprint matches. Same-provider matches are exact
 * duplicates safe to merge; cross-provider matches must be routed to review
 * because identical content under a different provider can carry different
 * rights/attribution and must never be silently merged.
 */
export function decideFingerprintMatches(
  ownerProviderKey: string,
  matches: readonly FingerprintMatch[],
): FingerprintMatchDecision {
  const sameProviderIds: string[] = [];
  const crossProviderIds: string[] = [];
  for (const match of matches) {
    if (match.providerKey === ownerProviderKey) sameProviderIds.push(match.candidateId);
    else crossProviderIds.push(match.candidateId);
  }
  return { sameProviderIds, crossProviderIds };
}
