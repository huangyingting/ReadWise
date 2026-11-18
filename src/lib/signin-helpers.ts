/**
 * Sign-in view helpers (REF-064).
 *
 * Testable utilities for the sign-in page:
 *  - Error code → human-readable message mapping.
 *  - callbackUrl sanitization (allow-list: relative paths only).
 */

const DEFAULT_CALLBACK_URL = "/dashboard";
const GENERIC_SIGNIN_ERROR_MESSAGE =
  "Something went wrong signing you in. Please try again.";

/** Maps NextAuth error codes to user-facing messages. */
export const SIGNIN_ERROR_MESSAGES: Record<string, string> = {
  OAuthAccountNotLinked:
    "That email is already linked to a different sign-in method.",
  AccessDenied: "This account is not authorized to access ReadWise.",
};

/**
 * Returns a user-facing error message for a NextAuth error code, or `null`
 * when no error code is present.
 */
export function friendlySignInError(code: string | undefined): string | null {
  if (!code) return null;
  return SIGNIN_ERROR_MESSAGES[code] ?? GENERIC_SIGNIN_ERROR_MESSAGE;
}

/**
 * True only for same-origin absolute paths ("/reader/1"). Protocol-relative
 * ("//evil.com"), backslash ("/\evil.com" — browsers treat "\" as "/"),
 * and control-character tricks resolve to another origin and are rejected.
 */
function hasRelativePathPrefix(url: string | undefined): url is string {
  if (!url || !url.startsWith("/")) return false;
  if (url.startsWith("//") || url.startsWith("/\\")) return false;
  if (/[\u0000-\u001f\u007f]/.test(url)) return false;
  try {
    return new URL(url, "https://readwise.invalid").origin === "https://readwise.invalid";
  } catch {
    return false;
  }
}

/**
 * Sanitizes a `callbackUrl` query parameter so only relative paths are
 * accepted. Falls back to `/dashboard` for absolute URLs, empty strings, or
 * missing values to prevent open-redirect vulnerabilities.
 */
export function sanitizeCallbackUrl(url: string | undefined): string {
  return hasRelativePathPrefix(url) ? url : DEFAULT_CALLBACK_URL;
}
