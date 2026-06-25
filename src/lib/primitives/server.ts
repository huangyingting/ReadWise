/**
 * Server-only platform primitives barrel — `@/lib/primitives/server`
 *
 * @boundary server — may use Node.js APIs and server-only packages.
 * Must NOT be imported by client components or client-safe modules.
 *
 * Canonical import paths remain stable; these re-exports are provided for
 * discoverability and boundary documentation only.
 * See src/lib/primitives/README.md for the full classification.
 */

// ── Security-sensitive: HTML sanitization before render ──────────────────────
export { sanitizeArticleHtml } from "@/lib/sanitize";
