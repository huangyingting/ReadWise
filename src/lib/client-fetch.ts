/**
 * Shared client-side fetch helpers (#224).
 *
 * Tiny, dependency-free wrappers around `fetch` for the many client components
 * that talk to our JSON API routes. They standardise three things that were
 * previously inconsistent across ~67 raw call sites:
 *
 *  1. An AbortController timeout (default {@link DEFAULT_TIMEOUT_MS}) so a stalled
 *     request can't hang the UI forever. The timeout composes with a
 *     caller-supplied `signal` — aborting either one aborts the request.
 *  2. JSON request/response handling (sets `Content-Type`, parses the body).
 *  3. Typed error extraction: a non-OK response throws an {@link ApiResponseError}
 *     carrying the HTTP `status` and the server's `{ error }` message (the shape
 *     our `api-handler` always returns), so callers get a real message to show.
 *
 * Client-safe: imports nothing from the server. Keep it that way.
 */

/** Default request timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 25_000;

/**
 * Thrown by {@link postJson}/{@link getJson} on a non-OK HTTP response. Carries
 * the response `status` and the server-provided message (from the `{ error }`
 * body) so call sites can surface a meaningful, user-facing string.
 */
export class ApiResponseError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiResponseError";
    this.status = status;
  }
}

export interface ClientFetchOptions {
  /** Timeout in ms before the request is aborted. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Caller signal — composed with the internal timeout signal. */
  signal?: AbortSignal;
  /** Forwarded to fetch for unload-safe best-effort requests. */
  keepalive?: boolean;
}

/** Build an AbortSignal that fires when the timeout elapses OR the caller aborts. */
function withTimeout(opts: ClientFetchOptions | undefined): {
  signal: AbortSignal;
  keepalive?: boolean;
  cleanup: () => void;
} {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const external = opts?.signal;
  let onAbort: (() => void) | null = null;
  if (external) {
    if (external.aborted) {
      controller.abort();
    } else {
      onAbort = () => controller.abort();
      external.addEventListener("abort", onAbort);
    }
  }

  return {
    signal: controller.signal,
    keepalive: opts?.keepalive,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (external && onAbort) external.removeEventListener("abort", onAbort);
    },
  };
}

/** Parse the JSON body, tolerating an empty/invalid body (returns null). */
async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Extract the server `{ error }` message, falling back to a status-based string. */
function messageFor(status: number, body: unknown): string {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as { error?: unknown }).error;
    if (typeof err === "string" && err.length > 0) return err;
  }
  return `Request failed (HTTP ${status})`;
}

export async function requestJson<T>(
  url: string,
  init: RequestInit,
  opts?: ClientFetchOptions,
): Promise<T> {
  const { signal, keepalive, cleanup } = withTimeout(opts);
  try {
    const res = await fetch(url, { ...init, signal, keepalive });
    const body = await safeJson(res);
    if (!res.ok) {
      throw Object.assign(new ApiResponseError(res.status, messageFor(res.status, body)), {
        cause: body,
      });
    }
    return body as T;
  } finally {
    cleanup();
  }
}

/** POST a JSON body and parse the JSON response. Throws {@link ApiResponseError} on non-OK. */
export function postJson<T>(
  url: string,
  body?: unknown,
  opts?: ClientFetchOptions,
): Promise<T> {
  return requestJson<T>(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    opts,
  );
}

/** GET a JSON response. Throws {@link ApiResponseError} on non-OK. */
export function getJson<T>(url: string, opts?: ClientFetchOptions): Promise<T> {
  return requestJson<T>(url, { method: "GET", headers: { Accept: "application/json" } }, opts);
}

/** PUT a JSON body and parse the JSON response. Throws {@link ApiResponseError} on non-OK. */
export function putJson<T>(
  url: string,
  body?: unknown,
  opts?: ClientFetchOptions,
): Promise<T> {
  return requestJson<T>(
    url,
    {
      method: "PUT",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    opts,
  );
}

/** PATCH a JSON body and parse the JSON response. Throws {@link ApiResponseError} on non-OK. */
export function patchJson<T>(
  url: string,
  body?: unknown,
  opts?: ClientFetchOptions,
): Promise<T> {
  return requestJson<T>(
    url,
    {
      method: "PATCH",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    opts,
  );
}

/** DELETE an optional JSON body and parse the JSON response. Throws {@link ApiResponseError} on non-OK. */
export function deleteJson<T>(
  url: string,
  body?: unknown,
  opts?: ClientFetchOptions,
): Promise<T> {
  return requestJson<T>(
    url,
    {
      method: "DELETE",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    opts,
  );
}
