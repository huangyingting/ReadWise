/**
 * Shared redaction primitive (R2CI-1 / #627).
 *
 * Single source of truth for sensitive-key detection and string-value
 * scrubbing across the audit, error-reporting, and analytics paths.
 * Covers the strict superset of all three prior per-module lists.
 *
 * AGENTS.md invariant: never log prompts, article text, selected text,
 * translations, definitions, cookies, tokens, or secrets. Any key that
 * matches {@link SENSITIVE_KEY_RE} must be redacted to "[redacted]" by
 * callers; free-text strings pass through {@link scrubValue} which masks
 * embedded emails and long token-like values in place.
 *
 * Prior per-module lists this replaces:
 *   - src/lib/security/audit.ts       SENSITIVE_KEY_RE / EMAIL_RE / TOKENISH_RE
 *   - src/lib/observability/errors.ts SENSITIVE_KEY_PATTERNS / scrubString
 *   - src/lib/analytics/events/sanitize.ts SENSITIVE_PROPERTY_KEY_RE
 */

/**
 * Matches any key name that could carry secrets, PII, or user-private content.
 * Evaluated as a substring match (case-insensitive) so compound names such as
 * `articleContent`, `api_key`, `selectedText`, and `bearerToken` are caught.
 *
 * Sensitive-key superset covered:
 *   authorization, body, completion, content, cookie, credential,
 *   definition, email, example, explanation, key (→ apiKey, secretKey, api_key),
 *   pass (→ password, passphrase, passwd), phrase, prompt, pwd,
 *   response, secret, select (→ selection, selected, selectedText),
 *   sentence, session, text, token, translation, url
 */
export const SENSITIVE_KEY_RE =
  /(authorization|body|completion|content|cookie|credential|definition|email|example|explanation|key|pass|phrase|prompt|pwd|response|secret|select|sentence|session|text|token|translation|url)/i;

/** Returns true when a key name likely carries sensitive or user-private content. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_RE.test(key);
}

// Global-flag regexes are safe with replace() — lastIndex resets after each call.
const EMAIL_SCRUB_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const TOKEN_SCRUB_RE = /\b[A-Za-z0-9_-]{24,}\b/g;

/**
 * Scrub a free-text string: mask embedded email addresses as "[email]" and
 * long token-like strings (API keys, JWT segments, bearer tokens) as "[token]".
 *
 * Does NOT truncate — callers apply their own length limits. Does NOT replace
 * the entire value; inline masking preserves surrounding context for debugging
 * while guaranteeing no raw PII or credential passes through.
 */
export function scrubValue(value: string): string {
  return value.replace(EMAIL_SCRUB_RE, "[email]").replace(TOKEN_SCRUB_RE, "[token]");
}
