/**
 * Server-only platform primitives barrel — `@/lib/primitives/server`
 *
 * @server-only — Must never be imported by client components or client-safe modules.
 * See docs/refactoring.md § REF-076 for the boundary taxonomy.
 *
 * @boundary server — may use Node.js APIs and server-only packages.
 *
 * Canonical import paths remain stable; these re-exports are provided for
 * discoverability and boundary documentation only.
 * See src/lib/primitives/README.md for the full classification.
 */

// ── Security-sensitive: HTML sanitization before render ──────────────────────
export { sanitizeArticleHtml } from "@/lib/sanitize";
