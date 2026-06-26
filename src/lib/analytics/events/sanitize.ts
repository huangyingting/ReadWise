/**
 * Analytics property sanitization (REF-049).
 *
 * Coerces caller-supplied property bags into a flat, metadata-only object:
 * drops sensitive/free-text keys, coerces values to safe primitives, caps the
 * key count, and stamps the schema version. NEVER stores nested objects or
 * long text.
 *
 * Privacy invariant: the `properties` payload is for small, non-sensitive
 * metadata (counts, enums, ids). It MUST NEVER contain article text, selected
 * text, prompts, dictionary definitions, translations, URLs, emails, or PII.
 */

import { ANALYTICS_SCHEMA_VERSION } from "@/lib/analytics/events/catalog";
import { isSensitiveKey } from "@/lib/observability/redaction";

const MAX_PROPERTY_KEYS = 25;
const MAX_PROPERTY_STRING_LEN = 200;
const MAX_PROPERTY_ARRAY_ITEMS = 20;

/**
 * Keys that could carry sensitive free text / secrets are dropped from the
 * payload entirely. Analytics is metadata-only by contract; this is a backstop
 * so an accidental `{ text: article.body }` never lands in the stream.
 * Key detection is handled by {@link isSensitiveKey} from the shared
 * redaction primitive (src/lib/observability/redaction.ts).
 */

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

/** Coerce a single property value to a small, safe, serializable primitive. */
function sanitizePropertyValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return truncate(value, MAX_PROPERTY_STRING_LEN);
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_PROPERTY_ARRAY_ITEMS)
      .map((item) =>
        typeof item === "string"
          ? truncate(item, MAX_PROPERTY_STRING_LEN)
          : typeof item === "number" || typeof item === "boolean"
            ? item
            : null,
      );
  }
  // Objects/functions are not persisted as nested structures — analytics props
  // are intentionally flat. Drop anything we can't represent safely.
  return null;
}

/**
 * Sanitizes a caller-supplied property bag into a flat, metadata-only object:
 * drops sensitive keys, coerces values to safe primitives, caps the key count,
 * and stamps the schema version. NEVER stores nested objects or long text.
 */
export function sanitizeEventProperties(
  input: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { _v: ANALYTICS_SCHEMA_VERSION };
  if (!input) return out;
  let count = 0;
  for (const [rawKey, value] of Object.entries(input)) {
    if (count >= MAX_PROPERTY_KEYS) break;
    if (rawKey === "_v") continue;
    if (isSensitiveKey(rawKey)) continue;
    const key = truncate(rawKey, 60);
    out[key] = sanitizePropertyValue(value);
    count++;
  }
  return out;
}
