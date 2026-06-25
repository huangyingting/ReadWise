/**
 * Platform primitives — master barrel (`@/lib/primitives`)
 *
 * Re-exports all **pure** primitives (safe for any runtime).
 * For client-only or server-only primitives, import from the explicit barrel:
 *
 *   import { cn, focusRing }       from "@/lib/primitives/client";
 *   import { sanitizeArticleHtml } from "@/lib/primitives/server";
 *
 * See src/lib/primitives/README.md for the full classification and
 * contribution guidelines.
 *
 * @boundary pure
 */
export * from "@/lib/primitives/pure";
