/**
 * Security-owned sensitive metadata redaction policy (#676).
 *
 * Single source of truth for sensitive-key detection and value scrubbing
 * across the entire codebase. Every path that persists or logs metadata
 * (audit log, error reporting, analytics events, security events, AI ledger)
 * MUST use this module as the sole authority for what constitutes a sensitive
 * key or value.
 *
 * AGENTS.md invariant: never log or persist prompts, article text, selected
 * text, translations, definitions, cookies, tokens, credentials, or secrets.
 * Any key matching {@link SENSITIVE_KEY_RE} must be redacted to "[redacted]";
 * free-text strings pass through {@link redactSensitiveValue} which masks
 * embedded emails and long token-like values in place.
 *
 * Public API:
 *   - {@link isSensitiveMetadataKey}     — key-name classifier
 *   - {@link redactSensitiveValue}       — string PII/token scrubber
 *   - {@link redactSensitiveObject}      — flat object redactor (error context, etc.)
 *   - {@link safeMetadataForPersistence} — recursive object sanitizer (audit, ledger, etc.)
 *
 * Backward-compat aliases (from R2CI-1 / #627, previously in observability/redaction):
 *   - {@link isSensitiveKey}  → isSensitiveMetadataKey
 *   - {@link scrubValue}      → redactSensitiveValue
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

const REDACTED = "[redacted]";

// Global-flag regexes are safe with replace() — lastIndex resets after each call.
const EMAIL_SCRUB_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const TOKEN_SCRUB_RE = /\b[A-Za-z0-9_-]{24,}\b/g;

// ── Core classifiers ──────────────────────────────────────────────────────────

/** Returns true when a key name likely carries sensitive or user-private content. */
export function isSensitiveMetadataKey(key: string): boolean {
  return SENSITIVE_KEY_RE.test(key);
}

/**
 * Scrub a free-text string: mask embedded email addresses as "[email]" and
 * long token-like strings (API keys, JWT segments, bearer tokens) as "[token]".
 *
 * Does NOT truncate — callers apply their own length limits. Does NOT replace
 * the entire value; inline masking preserves surrounding context for debugging
 * while guaranteeing no raw PII or credential passes through.
 */
export function redactSensitiveValue(value: string): string {
  return value.replace(EMAIL_SCRUB_RE, "[email]").replace(TOKEN_SCRUB_RE, "[token]");
}

// ── High-level object redactors ───────────────────────────────────────────────

/**
 * Redact a flat object: replace sensitive keys with "[redacted]", mask PII/tokens
 * in string values, and replace nested objects with "[object]" so structured
 * content cannot leak through compound values.
 *
 * Suitable for low-cardinality extra context (error reporting, security events).
 * For persistence-safe recursive redaction, use {@link safeMetadataForPersistence}.
 */
export function redactSensitiveObject(
  obj: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!obj) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveMetadataKey(key)) {
      out[key] = REDACTED;
      continue;
    }
    if (value === null || value === undefined) {
      out[key] = value;
    } else if (typeof value === "string") {
      out[key] = redactSensitiveValue(value).slice(0, 200);
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else {
      out[key] = "[object]";
    }
  }
  return out;
}

const MAX_SAFE_KEYS = 25;
const MAX_SAFE_ARRAY_ITEMS = 20;
const MAX_SAFE_STRING_LEN = 200;
const MAX_SAFE_DEPTH = 3;

function sanitizeDeep(value: unknown, depth: number): unknown {
  if (depth > MAX_SAFE_DEPTH) return "[truncated]";
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    return redactSensitiveValue(value).slice(0, MAX_SAFE_STRING_LEN);
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_SAFE_ARRAY_ITEMS).map((item) => sanitizeDeep(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (count++ >= MAX_SAFE_KEYS) break;
      out[k] = isSensitiveMetadataKey(k) ? REDACTED : sanitizeDeep(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/**
 * Sanitize an arbitrary object into a structure safe for persistent storage or
 * structured logs: redacts sensitive keys, scrubs PII/tokens in string values,
 * caps nesting depth, limits key and array cardinality, and coerces
 * non-serializable types.
 *
 * Suitable for audit log metadata, security events, and AI ledger context.
 * For flat extra-context bags (error reporting), prefer {@link redactSensitiveObject}.
 */
export function safeMetadataForPersistence(
  input: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!input) return {};
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(input)) {
    if (count++ >= MAX_SAFE_KEYS) break;
    out[key] = isSensitiveMetadataKey(key) ? REDACTED : sanitizeDeep(value, 0);
  }
  return out;
}

// ── Backward-compat aliases (R2CI-1 / #627 names) ────────────────────────────

/** @deprecated Use {@link isSensitiveMetadataKey} — canonical name since #676. */
export const isSensitiveKey = isSensitiveMetadataKey;
/** @deprecated Use {@link redactSensitiveValue} — canonical name since #676. */
export const scrubValue = redactSensitiveValue;
