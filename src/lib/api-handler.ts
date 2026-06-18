/**
 * Shared API handler wrapper (US-028). Every route handler is built with one of
 * {@link createHandler} (auth required), {@link createAdminHandler} (admin only)
 * or {@link createPublicHandler} (explicitly unauthenticated). The wrapper
 * centralizes:
 *   - authentication (session/admin via `@/lib/api-auth`, or explicit public),
 *   - request-id generation + structured request/response logging,
 *   - schema validation of body / params / query (untrusted ids never trusted),
 *   - error formatting — controlled {@link ApiError}s surface their message,
 *     everything else is logged in full and returned as a generic 500 in
 *     production so internals are never leaked.
 */
import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { requireAdminApi, requireSessionApi } from "@/lib/api-auth";
import type { Schema } from "@/lib/validation";

const isProduction = process.env.NODE_ENV === "production";

/** Throw from a handler to return a controlled, client-safe error response. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export type RequestLogger = {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
};

function createRequestLogger(base: Record<string, unknown>): RequestLogger {
  const emit =
    (level: "info" | "warn" | "error") =>
    (message: string, meta?: Record<string, unknown>) => {
      const line = {
        ts: new Date().toISOString(),
        level,
        scope: "api",
        message,
        ...base,
        ...meta,
      };
      const out = JSON.stringify(line);
      if (level === "error") console.error(out);
      else if (level === "warn") console.warn(out);
      else console.log(out);
    };
  return { info: emit("info"), warn: emit("warn"), error: emit("error") };
}

type AuthMode = "public" | "session" | "admin";

type RouteContext = { params?: Promise<Record<string, string>> };

export type HandlerContext<B, P, Q, S extends Session | null> = {
  req: Request;
  session: S;
  body: B;
  params: P;
  query: Q;
  requestId: string;
  log: RequestLogger;
};

type HandlerConfig<B, P, Q> = {
  body?: Schema<B>;
  params?: Schema<P>;
  query?: (params: URLSearchParams) => import("@/lib/validation").ValidationResult<Q>;
};

type Handler<B, P, Q, S extends Session | null> = (
  ctx: HandlerContext<B, P, Q, S>,
) => Promise<Response> | Response;

function jsonError(
  status: number,
  message: string,
  requestId: string,
): NextResponse {
  const res = NextResponse.json({ error: message, requestId }, { status });
  res.headers.set("x-request-id", requestId);
  return res;
}

function withRequestId(res: Response, requestId: string): Response {
  res.headers.set("x-request-id", requestId);
  return res;
}

function build<B, P, Q, S extends Session | null>(
  auth: AuthMode,
  config: HandlerConfig<B, P, Q>,
  handler: Handler<B, P, Q, S>,
) {
  return async (req: Request, routeCtx?: unknown): Promise<Response> => {
    const ctx = (routeCtx ?? {}) as RouteContext;
    const requestId =
      req.headers.get("x-request-id")?.slice(0, 200) || crypto.randomUUID();
    const url = new URL(req.url);
    const log = createRequestLogger({
      requestId,
      method: req.method,
      path: url.pathname,
    });
    const startedAt = Date.now();
    log.info("request.start");

    try {
      // 1) Authentication — public routes are explicitly exempt.
      let session: Session | null = null;
      if (auth === "admin") {
        const result = await requireAdminApi();
        if (result.error) return withRequestId(result.error, requestId);
        session = result.session;
      } else if (auth === "session") {
        const result = await requireSessionApi();
        if (result.error) return withRequestId(result.error, requestId);
        session = result.session;
      }

      // 2) Validate route params (untrusted ids from the URL).
      let params = {} as P;
      if (config.params) {
        const raw = ctx.params ? await ctx.params : {};
        const res = config.params(raw);
        if (!res.ok) return jsonError(400, res.error, requestId);
        params = res.value;
      }

      // 3) Validate query string.
      let query = {} as Q;
      if (config.query) {
        const res = config.query(url.searchParams);
        if (!res.ok) return jsonError(400, res.error, requestId);
        query = res.value;
      }

      // 4) Parse + validate JSON body.
      let body = undefined as B;
      if (config.body) {
        let raw: unknown;
        try {
          raw = await req.json();
        } catch {
          return jsonError(400, "Invalid JSON body", requestId);
        }
        const res = config.body(raw);
        if (!res.ok) return jsonError(400, res.error, requestId);
        body = res.value;
      }

      const response = await handler({
        req,
        session: session as S,
        body,
        params,
        query,
        requestId,
        log,
      });
      log.info("request.complete", {
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      return withRequestId(response, requestId);
    } catch (err) {
      if (err instanceof ApiError) {
        log.warn("request.handled_error", {
          status: err.status,
          error: err.message,
        });
        return jsonError(err.status, err.message, requestId);
      }
      // Unexpected: log internals, return a generic response in production.
      log.error("request.unhandled_error", {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      const message = isProduction
        ? "Internal server error"
        : err instanceof Error
          ? err.message
          : "Internal server error";
      return jsonError(500, message, requestId);
    }
  };
}

/** Authenticated handler — `ctx.session` is guaranteed non-null. */
export function createHandler<B = undefined, P = Record<string, never>, Q = Record<string, never>>(
  config: HandlerConfig<B, P, Q>,
  handler: Handler<B, P, Q, Session>,
) {
  return build("session", config, handler);
}

/** Admin-only handler — non-admins get 401/403 before the handler runs. */
export function createAdminHandler<B = undefined, P = Record<string, never>, Q = Record<string, never>>(
  config: HandlerConfig<B, P, Q>,
  handler: Handler<B, P, Q, Session>,
) {
  return build("admin", config, handler);
}

/** Explicitly public handler — `ctx.session` is null. */
export function createPublicHandler<B = undefined, P = Record<string, never>, Q = Record<string, never>>(
  config: HandlerConfig<B, P, Q>,
  handler: Handler<B, P, Q, null>,
) {
  return build("public", config, handler);
}
