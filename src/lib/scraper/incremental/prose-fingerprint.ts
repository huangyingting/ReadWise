/**
 * PURE versioned normalized-prose fingerprint (issue #1092, Phase 2.2).
 *
 * Computes a fixed-size, one-way HASH of a candidate's extracted prose so two
 * candidates that carry IDENTICAL provider content can be detected BEFORE an
 * Article is created. This module is PURE — no DB, network, or clock.
 *
 * Security invariant (critical): the fingerprint is a SHA-256 hash of the
 * NORMALIZED prose; the prose text itself is NEVER returned, stored, or logged.
 * Only the versioned hash key is persisted (`CrawlCandidate.bodyFingerprint` +
 * `bodyFingerprintVersion`).
 *
 * EXACT-ONLY by design: matching is byte-exact on the normalized hash. There is
 * deliberately NO fuzzy / semantic / shingled similarity — an approximate match
 * could merge two genuinely different articles (or, worse, let a fingerprint
 * check masquerade as a content refresh of a KNOWN Article). A hash gives zero
 * false merges: only truly identical normalized prose collides.
 *
 * VERSIONED: {@link PROSE_FINGERPRINT_VERSION} tags the normalization + hash
 * scheme. Changing ANY normalization rule below is a breaking change and MUST
 * bump the version so old and new fingerprints never compare equal.
 */
import { createHash } from "node:crypto";

/**
 * Prose-fingerprint scheme version. Prefixes every fingerprint key
 * (`v<version>:<sha256hex>`) and is stored alongside it. Bump this whenever the
 * normalization rules or hash below change.
 */
export const PROSE_FINGERPRINT_VERSION = 1 as const;

/** A computed, secret-free prose fingerprint. */
export type ProseFingerprint = {
  /** Scheme version ({@link PROSE_FINGERPRINT_VERSION}). */
  version: number;
  /** SHA-256 hex digest of the normalized prose (no version prefix). */
  hash: string;
  /** Fixed-size versioned key: `v<version>:<sha256hex>`. */
  key: string;
};

/**
 * Normalizes prose for fingerprinting. Deterministic and conservative — it only
 * removes differences that never distinguish article content:
 *
 *   1. Unicode NFKC normalization (compatibility-fold width/ligature variants).
 *   2. Lowercase (identity of the content, not its casing).
 *   3. Collapse every run of Unicode whitespace to a single ASCII space
 *      (feed/HTML re-flow, CRLF vs LF, and indentation never change identity).
 *   4. Trim leading/trailing whitespace.
 *
 * Punctuation, digits, and letters are otherwise preserved so genuinely
 * different prose never collides.
 */
export function normalizeProse(prose: string): string {
  return prose
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Computes the versioned prose fingerprint of `prose`. Returns `null` when the
 * normalized prose is empty (no content to fingerprint), so an empty extraction
 * never collides with another empty extraction.
 */
export function computeProseFingerprint(prose: string): ProseFingerprint | null {
  const normalized = normalizeProse(prose);
  if (normalized.length === 0) return null;
  const hash = createHash("sha256").update(normalized, "utf8").digest("hex");
  return {
    version: PROSE_FINGERPRINT_VERSION,
    hash,
    key: `v${PROSE_FINGERPRINT_VERSION}:${hash}`,
  };
}
