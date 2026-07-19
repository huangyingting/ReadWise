/**
 * Shared admin data-fetch error classification (issue #1100, frontend).
 *
 * Client-safe, PURE mapping from an HTTP status (+ the server `{ error }`
 * message) to the discriminated UI state an admin client island renders while
 * LOADING a capability-gated resource. Deny-by-default is a first-class state:
 *
 *   - 401 → `unauthorized` (not signed in / session expired)
 *   - 403 → `forbidden`    (signed in, but missing the `sources.manage`
 *                           capability — the explicit "you don't have access"
 *                           view the issue mandates)
 *   - 404 → `notFound`
 *   - anything else → `generic` (carries the sanitized server message + status)
 *
 * It reads only the status and the already-sanitized message — never a URL,
 * body, secret, or article content.
 */
import { ApiResponseError } from "@/lib/client-fetch";

/** The discriminated fetch-error state for an admin client island. */
export type AdminFetchErrorState =
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "notFound"; message: string }
  | { kind: "generic"; message: string; status: number | null };

const GENERIC_MESSAGE = "Something went wrong loading this data.";

/** Maps a status + sanitized message to the fetch-error state. PURE. */
export function adminFetchErrorState(
  status: number | null,
  message: string,
): AdminFetchErrorState {
  if (status === 401) return { kind: "unauthorized" };
  if (status === 403) return { kind: "forbidden" };
  if (status === 404) return { kind: "notFound", message };
  return { kind: "generic", message: message || GENERIC_MESSAGE, status };
}

/**
 * Classifies a caught fetch error (an {@link ApiResponseError} from the shared
 * client-fetch helpers, or any thrown value) into an {@link AdminFetchErrorState}.
 */
export function classifyAdminFetchError(err: unknown): AdminFetchErrorState {
  if (err instanceof ApiResponseError) {
    return adminFetchErrorState(err.status, err.message);
  }
  const message = err instanceof Error ? err.message : GENERIC_MESSAGE;
  return adminFetchErrorState(null, message);
}
