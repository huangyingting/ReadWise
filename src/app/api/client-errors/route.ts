import { NextResponse } from "next/server";
import { createPublicHandler } from "@/lib/api-handler";
import { object, nonEmptyString, optional, string } from "@/lib/validation";
import {
  clientIpRateLimitPolicy,
  enforceRateLimitPolicy,
} from "@/lib/security/rate-limit/index";
import { captureError } from "@/lib/observability/errors";
import { routeGroupFromPath } from "@/lib/metrics";

/**
 * Client-side error sink (US-029). The browser error reporter
 * (src/components/ClientErrorReporter.tsx) POSTs runtime errors and unhandled
 * promise rejections here so they land in the same structured server logs
 * (with the request id) as everything else. Public + best-effort: it always
 * returns 204 and never blocks the page.
 */
const bodySchema = object({
  message: nonEmptyString(2000),
  source: optional(string({ max: 100 })),
  stack: optional(string({ max: 8000, trim: false })),
  url: optional(string({ max: 2000 })),
});

type ClientErrorBody = {
  message: string;
  source?: string;
  stack?: string;
  url?: string;
};

type ScrubbedClientErrorReport = {
  source: string;
  stack?: string;
  route?: string;
};

const CLIENT_SOURCE_FALLBACK = "window";

/** Mask email addresses and long token-like strings to prevent PII in logs. */
function scrubClientText(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[token]");
}

/** Reduce an untrusted browser URL to a bounded, low-cardinality route group. */
function clientRouteGroup(url: string): string {
  try {
    const parsed = new URL(url, "http://client.invalid");
    return routeGroupFromPath(parsed.pathname);
  } catch {
    return "/other";
  }
}

function scrubClientReport(body: ClientErrorBody): ScrubbedClientErrorReport {
  return {
    source: body.source ?? CLIENT_SOURCE_FALLBACK,
    stack: body.stack ? scrubClientText(body.stack) : undefined,
    route: body.url ? clientRouteGroup(body.url) : undefined,
  };
}

function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

const CLIENT_ERROR_REPORT_RATE_LIMIT = clientIpRateLimitPolicy("public", {
  onExceeded: () => noContent(),
});

export const POST = createPublicHandler(
  { body: bodySchema },
  async ({ body, log, req }) => {
    // IP-based rate limit: silently absorbs excess but still returns 204
    // (best-effort, keep returning 204 to avoid leaking the limit to clients).
    const rateLimitedResponse = await enforceRateLimitPolicy(
      CLIENT_ERROR_REPORT_RATE_LIMIT,
      { req },
    );
    if (rateLimitedResponse) return rateLimitedResponse;
    const report = scrubClientReport(body);
    log.error("client.error", {
      failureReason: "client_error",
      clientSource: report.source,
      route: report.route,
    });
    // Funnel a controlled synthetic error into the backend-agnostic aggregator.
    // The client stack is used only to derive a safe top-frame filename inside
    // captureError; raw browser exception prose is never logged or exported.
    const clientError = new Error("client_error");
    clientError.name = "ClientError";
    if (report.stack) clientError.stack = report.stack;
    captureError(clientError, {
      source: "client",
      severity: "error",
      machineReason: "client_error",
      route: report.route,
      extra: { clientSource: report.source },
    });
    return noContent();
  },
);
