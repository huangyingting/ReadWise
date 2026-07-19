/**
 * PURE authenticated-provider credential policy (issue #1099, Phase 2.9).
 *
 * Decides — from plain, secret-free inputs only (no database, network, clock, or
 * secret access) — the two gating questions for project-authorized authenticated
 * provider ingestion:
 *
 *   1. ACTIVATION ELIGIBILITY (AC3): may a source be activated for AUTOMATIC
 *      incremental ingestion? An authenticated source must have a STABLE,
 *      secret-free identity (a provider article id or a canonical URL) AND a
 *      persisted `credentialRef`. A source whose items are identified ONLY by
 *      rotating signed URLs can never be activated — a signed URL is not a stable
 *      identity, so it cannot key candidate uniqueness or the no-refresh
 *      invariant.
 *
 *   2. PAUSE CATEGORY (requirement 6): when the worker's secret resolver reports
 *      a missing / expired / rotated credential, the AFFECTED source (only) is
 *      paused with a SANITIZED category label. The label is a controlled enum —
 *      never a URL, secret, token, signed URL, or Authorization header.
 *
 * The publication side of Phase 2.9 (authenticated fetch permission NEVER makes
 * an Article public — AC4) is owned by the #1096 pure publication policy
 * (`lib/processing/publication-policy.ts`) and is deliberately NOT re-decided
 * here: this module lives in `lib/scraper` and the one-way module boundary
 * forbids a `lib/scraper -> lib/processing` import. `canFetchAuthenticated` is
 * therefore intentionally absent from that publication gate; fetch permission
 * and republication permission stay separate grants.
 *
 * Every reason/category below is a controlled machine label — never sensitive
 * content — so it is safe to persist (e.g. `DiscoverySource.lastError`), log, or
 * surface in observability counts.
 */

/**
 * How a source's discovered items are identified. Only the two STABLE,
 * secret-free kinds may be activated for automatic incremental ingestion; a
 * `signed-url-only` source is refused (a rotating signed URL is not a durable
 * identity).
 */
export type AuthIdentityKind = "stable-provider-id" | "canonical-url" | "signed-url-only";

const AUTH_IDENTITY_KINDS: readonly AuthIdentityKind[] = [
  "stable-provider-id",
  "canonical-url",
  "signed-url-only",
];

/**
 * Narrows a raw `DiscoverySource.authIdentityKind` string (the column is a
 * secret-free `String?`) to the typed union, or `null` when unset/unrecognized.
 */
export function parseAuthIdentityKind(raw: string | null | undefined): AuthIdentityKind | null {
  if (raw == null) return null;
  return AUTH_IDENTITY_KINDS.includes(raw as AuthIdentityKind) ? (raw as AuthIdentityKind) : null;
}

/**
 * True when the identity kind is a STABLE, secret-free identity that can key
 * candidate uniqueness and the no-old-article-refresh invariant. A rotating
 * signed URL (or an unknown kind) is NOT stable.
 */
export function isStableSecretFreeIdentity(kind: AuthIdentityKind | null): boolean {
  return kind === "stable-provider-id" || kind === "canonical-url";
}

export type CredentialActivationInput = {
  /** Whether this source is authorized to fetch WITH a project credential. */
  canFetchAuthenticated: boolean;
  /** Secret-free credential handle (env-var / secret-store key), or null. */
  credentialRef: string | null;
  /** How the source's items are identified (already parsed), or null (unset). */
  authIdentityKind: AuthIdentityKind | null;
};

/** Sanitized activation-eligibility reason — a controlled label, never a secret. */
export type CredentialActivationReason =
  /** Public source (no authenticated fetch): no credential gate applies. */
  | "not-authenticated-source"
  /** Authenticated source with a stable identity + a credentialRef: eligible. */
  | "eligible"
  /** AC3: identity is ONLY a rotating signed URL — cannot be activated. */
  | "signed-url-only-identity"
  /** Authenticated source with no declared stable identity kind (conservative). */
  | "identity-kind-unspecified"
  /** Authenticated source without a persisted credentialRef to resolve. */
  | "credential-ref-missing";

export type CredentialActivationDecision = {
  eligible: boolean;
  reason: CredentialActivationReason;
};

/**
 * Decides whether a source may be ACTIVATED for automatic incremental ingestion
 * from an authentication standpoint (AC3). A public (non-authenticated) source
 * is always eligible here — its correctness gates live elsewhere and are NOT
 * special-cased. An authenticated source must clear, in order:
 *   1. its identity must be a STABLE secret-free identity (a signed-url-only or
 *      unspecified identity is refused — a signed URL cannot be a durable key);
 *   2. it must carry a non-empty `credentialRef` to resolve at request time.
 * The most-significant blocking reason is returned first.
 */
export function decideAuthenticatedActivation(
  input: CredentialActivationInput,
): CredentialActivationDecision {
  if (!input.canFetchAuthenticated) {
    return { eligible: true, reason: "not-authenticated-source" };
  }
  // AC3 headline: a rotating signed URL is not a stable identity — refuse first.
  if (input.authIdentityKind === "signed-url-only") {
    return { eligible: false, reason: "signed-url-only-identity" };
  }
  // Conservative: an authenticated source must DECLARE a stable identity kind.
  if (!isStableSecretFreeIdentity(input.authIdentityKind)) {
    return { eligible: false, reason: "identity-kind-unspecified" };
  }
  // A credentialRef (name only) must exist for the worker to resolve at runtime.
  if (input.credentialRef == null || input.credentialRef.length === 0) {
    return { eligible: false, reason: "credential-ref-missing" };
  }
  return { eligible: true, reason: "eligible" };
}

/**
 * The failure a worker-side secret resolver reports for a `credentialRef` it
 * cannot turn into usable auth material. Sanitized: it carries NO secret, URL,
 * token, or header — only which class of failure occurred.
 */
export type CredentialFailureStatus = "missing" | "expired" | "rotated";

/** Sanitized pause category persisted/logged when a credential fails to resolve. */
export type CredentialPauseCategory =
  | "credential-missing"
  | "credential-expired"
  | "credential-rotated";

/**
 * Maps a resolver failure status to the sanitized pause category recorded when
 * the affected source is paused (requirement 6). A 1:1 controlled-label mapping;
 * the returned category is safe to persist in `lastError`, log, and count.
 */
export function pauseCategoryForCredentialFailure(
  status: CredentialFailureStatus,
): CredentialPauseCategory {
  return `credential-${status}`;
}
