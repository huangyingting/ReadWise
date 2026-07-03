import { NextResponse } from "next/server";
import { createPublicHandler } from "@/lib/api-handler";
import { object, nonEmptyString, optional, string } from "@/lib/validation";
import { checkRateLimitByKey, clientIpKey } from "@/lib/security/rate-limit/index";
import { captureError } from "@/lib/observability/errors";

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
  message: string;
  source: string;
  stack?: string;
  url?: string;
};

const CLIENT_SOURCE_FALLBACK = "window";

/** Mask email addresses and long token-like strings to prevent PII in logs. */
function scrubClientText(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[token]");
}

/** Strip query string and hash from a URL string (defense-in-depth). */
function stripUrlSensitive(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    // Not a valid absolute URL — strip manually.
    return url.split("?")[0].split("#")[0];
  }
}

function scrubClientReport(body: ClientErrorBody): ScrubbedClientErrorReport {
  return {
    message: scrubClientText(body.message),
    source: body.source ?? CLIENT_SOURCE_FALLBACK,
    stack: body.stack ? scrubClientText(body.stack) : undefined,
    url: body.url ? stripUrlSensitive(body.url) : undefined,
  };
}

function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export const POST = createPublicHandler(
  { body: bodySchema },
  async ({ body, log, req }) => {
    // IP-based rate limit: silently absorbs excess but still returns 204
    // (best-effort, keep returning 204 to avoid leaking the limit to clients).
    try {
      await checkRateLimitByKey(clientIpKey(req), "public");
    } catch {
      return noContent();
    }
    const report = scrubClientReport(body);
    log.error("client.error", {
      clientMessage: report.message,
      clientSource: report.source,
      clientStack: report.stack,
      clientUrl: report.url,
    });
    // Also funnel into the backend-agnostic aggregator so client exceptions are
    // grouped/fingerprinted + alertable alongside server errors. Build a
    // synthetic Error from the (already scrubbed) client report — captureError
    // re-scrubs, fingerprints, and increments the error metric.
    const clientError = new Error(report.message);
    clientError.name = "ClientError";
    if (report.stack) clientError.stack = report.stack;
    captureError(clientError, {
      source: "client",
      severity: "error",
      route: report.url,
      extra: { clientSource: report.source },
    });
    return noContent();
  },
);
