/**
 * CSRF defense-in-depth: same-origin enforcement for state-changing API
 * requests (RW-028).
 *
 * The app uses NextAuth database sessions in `SameSite=Lax` cookies, so the
 * browser already withholds the session cookie from most cross-site requests.
 * NextAuth's own `/api/auth/*` routes carry a dedicated CSRF token. This module
 * adds a cheap, correct extra layer for the app's OWN mutation routes: a
 * cross-site `Origin` on a POST/PUT/PATCH/DELETE is rejected.
 *
 * Design rules (kept deliberately conservative so legitimate traffic is never
 * broken — see `docs/security/overview.md`):
 *   - Only state-changing methods are checked (safe GET/HEAD/OPTIONS pass).
 *   - A request with NO `Origin` header is treated as same-origin and ALLOWED
 *     (server-to-server, health checks, non-browser `fetch`, some `sendBeacon`,
 *     and tests). Modern browsers DO send `Origin` on cross-site POSTs, which is
 *     exactly what we want to block.
 *   - When `Origin` is present it must match the request's own origin (derived
 *     from the URL and the `Host`/`X-Forwarded-Host` headers) or a configured
 *     allowed origin; otherwise it is rejected.
 *   - Enforcement can be disabled via `CSRF_ENFORCE=false` for deployments that
 *     terminate CSRF elsewhere.
 */
import { csrfAllowedOrigins, csrfEnforceSameOrigin } from "@/lib/runtime-config/security";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type CsrfDecision =
  | { ok: true }
  | { ok: false; reason: string; origin: string };

/** Whether `method` mutates state and therefore needs same-origin enforcement. */
export function isStateChangingMethod(method: string): boolean {
  return STATE_CHANGING_METHODS.has(method.toUpperCase());
}

/** Normalize a URL/origin string to `scheme://host[:port]` (lower-cased), or null. */
function toOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The set of origins that count as "this server". Derived from the request URL
 * plus the `Host` / `X-Forwarded-Host` headers (reconstructed with the
 * forwarded protocol) so the check is robust behind a reverse proxy, unioned
 * with any operator-configured allowed origins.
 */
function acceptableOrigins(req: Request): Set<string> {
  const origins = new Set<string>();
  const add = (value: string | null | undefined) => {
    const origin = toOrigin(value);
    if (origin) origins.add(origin);
  };

  try {
    add(new URL(req.url).origin);
  } catch {
    // ignore an unparseable request URL
  }

  const proto = (req.headers.get("x-forwarded-proto") ?? "https")
    .split(",")[0]
    .trim();
  const host = req.headers.get("host");
  if (host) add(`${proto}://${host.split(",")[0].trim()}`);
  const forwardedHost = req.headers.get("x-forwarded-host");
  if (forwardedHost) add(`${proto}://${forwardedHost.split(",")[0].trim()}`);

  for (const origin of csrfAllowedOrigins()) add(origin);
  return origins;
}

/**
 * Evaluate the same-origin policy for a request. Returns `{ ok: true }` when
 * the request is allowed, or `{ ok: false, reason, origin }` when a cross-site
 * (or malformed) `Origin` on a state-changing request should be rejected.
 */
export function checkSameOrigin(req: Request): CsrfDecision {
  if (!isStateChangingMethod(req.method)) return { ok: true };
  if (!csrfEnforceSameOrigin()) return { ok: true };

  const originHeader = req.headers.get("origin");

  if (!originHeader) {
    // No Origin → not a cross-site browser request. Honor an explicit
    // `Sec-Fetch-Site: cross-site` hint if a browser sent one without Origin.
    const fetchSite = req.headers.get("sec-fetch-site");
    if (fetchSite && fetchSite.toLowerCase() === "cross-site") {
      return { ok: false, reason: "cross-site request blocked", origin: "(none)" };
    }
    return { ok: true };
  }

  // The literal "null" origin (sandboxed iframes, some redirects) is not the
  // server's origin — reject it on a state-changing request.
  const normalized = toOrigin(originHeader);
  if (!normalized) {
    return { ok: false, reason: "invalid or null origin", origin: originHeader };
  }

  if (acceptableOrigins(req).has(normalized)) return { ok: true };
  return { ok: false, reason: "cross-site request blocked", origin: normalized };
}
