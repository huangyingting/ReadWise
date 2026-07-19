/**
 * Versioned URL normalization and public article identity (issue #1082).
 *
 * This module is the ONE deterministic place that turns a provider URL into
 * (1) a readable, secret-free **normalized URL** and (2) a fixed-size,
 * **versioned identity key** suitable for a NON-NULL database unique constraint.
 *
 * Contract — this module is PURE:
 *   - No network fetch (never resolves canonical links by loading a page).
 *   - No database access.
 *   - No candidate-lifecycle decisions (it maps URL -> identity, nothing else).
 *
 * Security invariant (critical): userinfo, access tokens, signatures, cookies,
 * and credential-like query parameters are stripped BEFORE any URL-derived value
 * is returned, so they can never leak into the normalized URL, the identity key,
 * debug output, logs, or a thrown error. {@link redactUrlForLog} is the only
 * approved way to render an arbitrary URL for logging.
 *
 * NOTE: This is distinct from `normalize.ts`, which normalizes article *HTML*.
 */
import { createHash } from "node:crypto";
import type { Provider, ProviderUrlIdentityPolicy } from "@/lib/scraper/types";
import { providerForUrl, getProvider } from "@/lib/scraper/providers";

/**
 * Identity version tag. It prefixes every identity key (`v1:<hash>`). Changing
 * ANY normalization behavior below (tracking allowlist, provider-rule handling,
 * hash, key shape) is a breaking change and REQUIRES bumping this tag so old
 * and new keys never collide. See the version-bump procedure in
 * `docs/content/incremental-provider-scraping-design.md` (Phase 1.2).
 */
export const URL_IDENTITY_VERSION = "v1" as const;

/** Result of deriving an identity. All fields are secret-free by construction. */
export type UrlIdentity = {
  /** Identity-version tag ({@link URL_IDENTITY_VERSION}). */
  identityVersion: string;
  /** Fixed-size versioned key: `<version>:<sha256hex>` (67 chars for v1). */
  key: string;
  /** Readable, secret-free canonical URL the key was derived from. */
  normalizedUrl: string;
  /** Owning provider key, or null when no registered provider owns the host. */
  providerKey: string | null;
};

/** Machine-readable failure reasons. Messages never echo secret URL parts. */
export type UrlIdentityErrorCode =
  | "invalid-url"
  | "unsupported-scheme"
  | "unknown-cross-domain-canonical";

/**
 * Error thrown by identity derivation. The `message` and any interpolated URL
 * are ALWAYS redacted (see {@link redactUrlForLog}) so credential-bearing input
 * cannot leak through a thrown error.
 */
export class UrlIdentityError extends Error {
  readonly code: UrlIdentityErrorCode;
  constructor(code: UrlIdentityErrorCode, message: string) {
    super(message);
    this.name = "UrlIdentityError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Central, explicit tracking-parameter allowlist-to-strip
// ---------------------------------------------------------------------------
//
// Only these well-known analytics/click parameters are removed by the SHARED
// normalizer. Unknown parameters are NEVER stripped just because they look
// inconvenient — that is the job of a provider's `meaningfulParams` policy,
// which must be proven by tests. Keep this list conservative and centrally
// owned; adding to it changes identities and therefore requires an identity
// version bump.

/** Case-insensitive exact query-param names removed as tracking noise. */
const TRACKING_PARAM_NAMES: ReadonlySet<string> = new Set([
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "yclid",
  "twclid",
  "ttclid",
  "igshid",
  "igsh",
  "mc_cid",
  "mc_eid",
  "mkt_tok",
  "_hsenc",
  "_hsmi",
  "vero_id",
  "vero_conv",
  "oly_anon_id",
  "oly_enc_id",
  "wickedid",
  "s_cid",
  "ncid",
  "cmpid",
  "spm",
  "scmts",
]);

/** Case-insensitive query-param name prefixes removed as tracking noise. */
const TRACKING_PARAM_PREFIXES: readonly string[] = ["utm_", "pk_", "piwik_", "hsa_"];

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  if (TRACKING_PARAM_NAMES.has(lower)) return true;
  return TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Credential / signature detection (security — always applied, globally)
// ---------------------------------------------------------------------------
//
// These parameters carry secrets (auth tokens, presign signatures, session ids)
// and are ALWAYS dropped before an identity is produced or logged. Dropping
// them is safe for identity because they never distinguish public content —
// two signed URLs for the same resource differ only by their (expiring) secret.

/** Case-insensitive credential/signature query-param name prefixes. */
const CREDENTIAL_PARAM_PREFIXES: readonly string[] = ["x-amz-", "x-goog-", "x-ms-"];

/** Case-insensitive credential/signature query-param exact names. */
const CREDENTIAL_PARAM_NAMES: ReadonlySet<string> = new Set([
  "sig",
  "signature",
  "hmac",
  "hash",
  "token",
  "access_token",
  "accesstoken",
  "refresh_token",
  "id_token",
  "auth",
  "authorization",
  "apikey",
  "api_key",
  "api-key",
  "key",
  "keyid",
  "secret",
  "secret_key",
  "client_secret",
  "password",
  "passwd",
  "pwd",
  "sessionid",
  "session_id",
  "session",
  "sessid",
  "sid",
  "jwt",
  "bearer",
  "credential",
  "credentials",
  "awsaccesskeyid",
  "expires",
]);

/** Case-insensitive substrings that mark a param as credential-bearing. */
const CREDENTIAL_PARAM_SUBSTRINGS: readonly string[] = [
  "token",
  "signature",
  "password",
  "secret",
  "apikey",
  "sessionid",
];

function isCredentialParam(name: string): boolean {
  const lower = name.toLowerCase();
  if (CREDENTIAL_PARAM_NAMES.has(lower)) return true;
  if (CREDENTIAL_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  return CREDENTIAL_PARAM_SUBSTRINGS.some((needle) => lower.includes(needle));
}

// ---------------------------------------------------------------------------
// Safe parsing + redaction
// ---------------------------------------------------------------------------

/**
 * Parses `rawUrl` into a URL, immediately stripping userinfo (user:pass@) and
 * the fragment so no secret material survives past this boundary. Only http(s)
 * is accepted. Throws {@link UrlIdentityError} with a redacted message.
 */
function parseSecretFree(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    // Never echo the input — it may contain embedded credentials.
    throw new UrlIdentityError("invalid-url", "Invalid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UrlIdentityError(
      "unsupported-scheme",
      `Only http(s) URLs are supported (got ${url.protocol})`,
    );
  }
  // Redact credential material carried outside the query string.
  url.username = "";
  url.password = "";
  url.hash = "";
  return url;
}

/**
 * Renders any URL as a secret-free string safe for logs and error messages:
 * userinfo, the entire query string, and the fragment are removed. Returns a
 * fixed placeholder when the input cannot be parsed (so a malformed,
 * credential-bearing string is never echoed verbatim).
 */
export function redactUrlForLog(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "[unparseable-url]";
  }
  url.username = "";
  url.password = "";
  url.hash = "";
  const query = url.search.length > 0 ? "?[redacted]" : "";
  return `${url.protocol}//${url.host}${url.pathname}${query}`;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function hostMatchesAssociatedDomain(host: string, domain: string): boolean {
  const lower = domain.toLowerCase();
  return host === lower || host.endsWith(`.${lower}`);
}

/** Applies provider hostname aliases and canonical-host folding (in place). */
function foldHostname(url: URL, policy: ProviderUrlIdentityPolicy | undefined): void {
  if (!policy) return;
  const host = url.hostname; // already lowercased + punycoded by URL
  const alias = policy.hostnameAliases?.[host];
  if (alias) {
    url.hostname = alias.toLowerCase();
    return;
  }
  if (policy.canonicalHost) {
    url.hostname = policy.canonicalHost.toLowerCase();
  }
}

/** Folds AMP/mobile path + host variants onto the canonical form (in place). */
function foldAmpVariant(url: URL, policy: ProviderUrlIdentityPolicy | undefined): void {
  const amp = policy?.amp;
  if (!amp) return;

  if (amp.hosts?.some((h) => h.toLowerCase() === url.hostname)) {
    url.hostname = (policy?.canonicalHost ?? url.hostname).toLowerCase();
  }

  let path = url.pathname;
  for (const prefix of amp.pathPrefixes ?? []) {
    const seg = `/${prefix.replace(/^\/+|\/+$/g, "")}`;
    if (path === seg) {
      path = "/";
    } else if (path.startsWith(`${seg}/`)) {
      path = path.slice(seg.length);
    }
  }
  for (const suffix of amp.pathSuffixes ?? []) {
    const seg = `/${suffix.replace(/^\/+|\/+$/g, "")}`;
    if (path === seg) {
      path = "/";
    } else if (path.endsWith(seg)) {
      path = path.slice(0, -seg.length) || "/";
    } else if (path.endsWith(`${seg}/`)) {
      path = path.slice(0, -(seg.length + 1)) || "/";
    }
  }
  url.pathname = path;
}

/** Applies the provider's trailing-slash policy to the path (in place). */
function applyTrailingSlash(url: URL, policy: ProviderUrlIdentityPolicy | undefined): void {
  const mode = policy?.trailingSlash ?? "preserve";
  if (mode === "preserve") return;
  const path = url.pathname;
  if (path === "/") return; // never touch the site root
  if (mode === "strip") {
    url.pathname = path.replace(/\/+$/, "") || "/";
  } else if (mode === "add" && !path.endsWith("/")) {
    url.pathname = `${path}/`;
  }
}

/**
 * Builds the deterministic, secret-free query string:
 *   1. credential/signature params are always dropped;
 *   2. tracking params on the central allowlist are dropped;
 *   3. when the provider declares `meaningfulParams`, ONLY those are kept
 *      (empty array = drop all query params); otherwise every remaining
 *      (non-tracking, non-credential) param is preserved;
 *   4. surviving (name, value) pairs are sorted for a stable key.
 */
function buildCanonicalSearch(url: URL, policy: ProviderUrlIdentityPolicy | undefined): string {
  const meaningful = policy?.meaningfulParams;
  const meaningfulSet = meaningful ? new Set(meaningful.map((p) => p.toLowerCase())) : null;

  const kept: Array<[string, string]> = [];
  for (const [name, value] of url.searchParams.entries()) {
    if (isCredentialParam(name)) continue;
    if (isTrackingParam(name)) continue;
    if (meaningfulSet && !meaningfulSet.has(name.toLowerCase())) continue;
    kept.push([name, value]);
  }
  kept.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));

  const params = new URLSearchParams();
  for (const [name, value] of kept) params.append(name, value);
  return params.toString();
}

/**
 * Core normalizer. Assumes `url` is already secret-free (see
 * {@link parseSecretFree}). `allowHostRewrite` gates host-folding: it is enabled
 * for same-provider normalization but disabled for a canonical URL that lives
 * on a provider's explicitly-associated (different) domain, whose host must be
 * preserved.
 */
function normalizeSecretFreeUrl(
  url: URL,
  policy: ProviderUrlIdentityPolicy | undefined,
  allowHostRewrite: boolean,
): string {
  // Scheme + hostname are already lowercased and punycoded by the URL parser;
  // default ports (:80 / :443) are already dropped by the URL parser.
  if (allowHostRewrite) {
    foldHostname(url, policy);
    foldAmpVariant(url, policy);
  }
  applyTrailingSlash(url, policy);
  const search = buildCanonicalSearch(url, policy);
  return `${url.protocol}//${url.host}${url.pathname}${search ? `?${search}` : ""}`;
}

function keyFor(normalizedUrl: string): string {
  const hash = createHash("sha256").update(normalizedUrl, "utf8").digest("hex");
  return `${URL_IDENTITY_VERSION}:${hash}`;
}

// ---------------------------------------------------------------------------
// Public operations
// ---------------------------------------------------------------------------

/**
 * Derives the **provisional** (discovered) identity of a URL. Use this for a URL
 * observed during discovery, before any trusted canonicalization. Normalizes
 * with the owning provider's rules when a provider is registered for the host,
 * otherwise applies only the shared (generic) normalization. Never rejects an
 * unknown-provider URL — provisional identities are intentionally permissive.
 */
export function deriveProvisionalIdentity(rawUrl: string): UrlIdentity {
  const url = parseSecretFree(rawUrl);
  const provider = providerForUrl(url.href);
  const normalizedUrl = normalizeSecretFreeUrl(url, provider?.urlIdentity, true);
  return {
    identityVersion: URL_IDENTITY_VERSION,
    key: keyFor(normalizedUrl),
    normalizedUrl,
    providerKey: provider?.key ?? null,
  };
}

/** Context for {@link deriveCanonicalIdentity}. */
export type CanonicalIdentityContext = {
  /**
   * The provider that owns the candidate this canonical URL was discovered for.
   * Required to accept a canonical URL on an explicitly-associated domain.
   */
  owningProviderKey?: string;
};

/**
 * Derives the **trusted, final canonical** identity of a URL (e.g. from a
 * `<link rel="canonical">` already validated by a trusted caller).
 *
 * Canonical ownership is accepted ONLY when one of the following holds; any
 * other cross-domain canonical is rejected so a page cannot claim ownership of
 * an unrelated domain's identity:
 *   - the host belongs to the SAME owning provider;
 *   - the host is a SEPARATELY-REGISTERED provider (it will rerun its own
 *     admission policy downstream — we normalize with that provider's rules);
 *   - the host is on the owning provider's explicitly-associated domains
 *     (host is preserved; only path/query policy is applied).
 */
export function deriveCanonicalIdentity(
  canonicalUrl: string,
  context: CanonicalIdentityContext = {},
): UrlIdentity {
  const url = parseSecretFree(canonicalUrl);
  const host = url.hostname;

  const owner: Provider | null = context.owningProviderKey
    ? getProvider(context.owningProviderKey)
    : null;
  const resolved = providerForUrl(url.href);

  // Case 1 & 2: a registered provider owns the host (same provider, or a
  // separately-registered one that reruns its own admission downstream).
  if (resolved) {
    const normalizedUrl = normalizeSecretFreeUrl(url, resolved.urlIdentity, true);
    return {
      identityVersion: URL_IDENTITY_VERSION,
      key: keyFor(normalizedUrl),
      normalizedUrl,
      providerKey: resolved.key,
    };
  }

  // Case 3: an explicitly-associated domain of the owning provider. The host is
  // a different domain, so it is preserved (no host rewrite) — we only apply the
  // owner's path/query policy.
  const associated =
    owner?.urlIdentity?.associatedDomains?.some((d) => hostMatchesAssociatedDomain(host, d)) ??
    false;
  if (owner && associated) {
    const normalizedUrl = normalizeSecretFreeUrl(url, owner.urlIdentity, false);
    return {
      identityVersion: URL_IDENTITY_VERSION,
      key: keyFor(normalizedUrl),
      normalizedUrl,
      providerKey: owner.key,
    };
  }

  // Reject: unknown cross-domain canonical. The message is redacted so no
  // credential-bearing part of the URL can leak through the thrown error.
  throw new UrlIdentityError(
    "unknown-cross-domain-canonical",
    `Canonical URL is not owned by an associated or registered provider: ${redactUrlForLog(
      canonicalUrl,
    )}`,
  );
}
