/**
 * AI text moderation — backward-compatible re-export shim (REF-067).
 *
 * Canonical implementation has moved to `@/lib/ai/output/moderation`.
 * This file is kept as a stable re-export so existing consumers at
 * `@/lib/ai/moderation` continue to work unchanged.
 */
export * from "./output/moderation";
