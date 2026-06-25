/**
 * AI output validators — backward-compatible re-export shim (REF-067).
 *
 * Canonical implementation has moved to `@/lib/ai/output/validators`.
 * This file is kept as a stable re-export so existing consumers at
 * `@/lib/ai/validation` continue to work unchanged.
 */
export * from "./output/validators";
