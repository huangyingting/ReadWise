/**
 * Shared route-test helpers (REF-033).
 *
 * Provides small, explicit utilities for constructing Route Requests,
 * promised params, and common session fixtures — the boilerplate that used to
 * be duplicated across every route test file.
 *
 * Node test runner + --experimental-test-module-mocks compatible.
 */

// ---------------------------------------------------------------------------
// Type alias
// ---------------------------------------------------------------------------

/** Canonical handler signature used by Next.js 15 route modules. */
export type RouteHandler = (
  req: Request,
  ctx?: { params?: Promise<Record<string, string>> } | unknown,
) => Promise<Response>;

// ---------------------------------------------------------------------------
// Session fixtures
// ---------------------------------------------------------------------------

/** Default authenticated reader session for route tests. */
export const readerSession = {
  user: { id: "user-1", role: "Reader", name: "T", email: "t@e.com" },
} as const;

/** Default authenticated admin session for route tests. */
export const adminSession = {
  user: { id: "admin-1", role: "Admin", name: "Admin", email: "admin@e.com" },
} as const;

// ---------------------------------------------------------------------------
// Request factories
// ---------------------------------------------------------------------------

/**
 * Build a JSON `Request` for route handler tests.
 *
 * @param url    Full URL string (e.g. "http://test/api/reader/a1/tutor").
 * @param method HTTP method (GET, POST, PUT, PATCH, DELETE, …).
 * @param body   Value to JSON-encode as the request body. Pass `undefined`
 *               to omit the body (useful for GET / DELETE).
 */
export function makeJsonRequest(
  url: string,
  method: string,
  body?: unknown,
): Request {
  const hasBody = body !== undefined;
  return new Request(url, {
    method,
    headers: hasBody ? { "content-type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(body) : undefined,
  });
}

/**
 * Convenience: POST JSON to `url`.
 */
export function jsonPost(url: string, body: unknown): Request {
  return makeJsonRequest(url, "POST", body);
}

/**
 * Convenience: PUT JSON to `url`.
 */
export function jsonPut(url: string, body: unknown): Request {
  return makeJsonRequest(url, "PUT", body);
}

/**
 * Convenience: PATCH JSON to `url`.
 */
export function jsonPatch(url: string, body: unknown): Request {
  return makeJsonRequest(url, "PATCH", body);
}

/**
 * Convenience: plain GET to `url`.
 */
export function getReq(url: string): Request {
  return new Request(url);
}

/**
 * Convenience: plain DELETE to `url`.
 */
export function deleteReq(url: string): Request {
  return new Request(url, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Promised params (Next.js 15 convention)
// ---------------------------------------------------------------------------

/**
 * Wraps route segment params in the `{ params: Promise<T> }` shape that
 * Next.js 15 server components and route handlers expect.
 *
 * @example
 *   handler(req, withParams({ id: "a1" }));
 */
export function withParams<T extends Record<string, string>>(
  params: T,
): { params: Promise<T> } {
  return { params: Promise.resolve(params) };
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

/**
 * Read and parse the JSON body of a route `Response`.
 * Thin wrapper so tests don't have to type-assert `await res.json()`.
 */
export async function readJson<T = unknown>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}
