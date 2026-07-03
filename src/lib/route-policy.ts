/**
 * Route protection policy (REF-060).
 *
 * Single source of truth for protected route prefixes, session cookie names,
 * and the Next.js middleware matcher list.  Import this module from
 * `src/middleware.ts` and any consumer that needs to reason about route-level
 * access control.
 *
 * Intentionally kept lightweight (no server-only imports) so it is safe for
 * the Next.js middleware edge runtime, next.config.ts, and test code.
 */

/** Route prefixes that require an active session. */
export const PROTECTED_PREFIXES = [
  "/dashboard",
  "/today",
  "/reader",
  "/settings",
  "/onboarding",
  "/admin",
  "/study",
  "/tags",
  "/browse",
  "/lists",
  "/notes",
  "/progress",
  "/offline",
  "/import",
  "/teacher",
  "/assignments",
  "/series",
] as const;

export type ProtectedPrefix = (typeof PROTECTED_PREFIXES)[number];

/** Cookie names used by NextAuth.js to carry the active session. */
export const SESSION_COOKIES = [
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
] as const;

const ROOT_MATCHER = "/";

function subtreeMatcher(prefix: ProtectedPrefix): `${ProtectedPrefix}/:path*` {
  return `${prefix}/:path*`;
}

/**
 * Next.js middleware `config.matcher` patterns.
 *
 * The leading "/" entry covers the landing-page authenticated redirect.
 * Every protected prefix has at least a `/:path*` variant.  Routes that
 * are reachable at their bare path (no sub-segments) also carry an explicit
 * root entry so single-segment visits are never skipped.
 *
 * IMPORTANT: this array must remain consistent with {@link PROTECTED_PREFIXES}.
 * The `tests/route-policy.test.ts` drift test enforces that every prefix has
 * a corresponding matcher entry.
 */
export const MIDDLEWARE_MATCHER: readonly string[] = [
  ROOT_MATCHER,
  subtreeMatcher("/dashboard"),
  "/today",
  subtreeMatcher("/today"),
  subtreeMatcher("/reader"),
  subtreeMatcher("/settings"),
  subtreeMatcher("/onboarding"),
  subtreeMatcher("/admin"),
  subtreeMatcher("/study"),
  subtreeMatcher("/tags"),
  subtreeMatcher("/browse"),
  subtreeMatcher("/lists"),
  "/lists",
  subtreeMatcher("/notes"),
  "/notes",
  subtreeMatcher("/progress"),
  "/progress",
  subtreeMatcher("/offline"),
  "/offline",
  "/import",
  subtreeMatcher("/import"),
  "/teacher",
  subtreeMatcher("/teacher"),
  "/assignments",
  subtreeMatcher("/assignments"),
  "/series",
  subtreeMatcher("/series"),
];
