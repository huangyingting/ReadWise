/**
 * Sign-in view helpers (REF-064).
 *
 * Testable utilities for the sign-in page:
 *  - Error code → human-readable message mapping.
 *  - callbackUrl sanitization (allow-list: relative paths only).
 */

/** Maps NextAuth error codes to user-facing messages. */
export const SIGNIN_ERROR_MESSAGES: Record<string, string> = {
  OAuthAccountNotLinked:
    "That email is already linked to a different sign-in method.",
  AccessDenied: "Sign-in was cancelled or denied.",
};

/**
 * Returns a user-facing error message for a NextAuth error code, or `null`
 * when no error code is present.
 */
export function friendlySignInError(code: string | undefined): string | null {
  if (!code) return null;
  return (
    SIGNIN_ERROR_MESSAGES[code] ??
    "Something went wrong signing you in. Please try again."
  );
}

/**
 * Sanitizes a `callbackUrl` query parameter so only relative paths are
 * accepted. Falls back to `/dashboard` for absolute URLs, empty strings, or
 * missing values to prevent open-redirect vulnerabilities.
 */
export function sanitizeCallbackUrl(url: string | undefined): string {
  return url && url.startsWith("/") ? url : "/dashboard";
}
