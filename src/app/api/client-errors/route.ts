import { NextResponse } from "next/server";
import { createPublicHandler } from "@/lib/api-handler";
import { object, nonEmptyString, optional, string } from "@/lib/validation";
import { checkRateLimitByKey, clientIpKey } from "@/lib/rate-limit";
import { captureError } from "@/lib/error-reporting";

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

export const POST = createPublicHandler(
  { body: bodySchema },
  async ({ body, log, req }) => {
    // IP-based rate limit: silently absorbs excess but still returns 204
    // (best-effort, keep returning 204 to avoid leaking the limit to clients).
    try {
      await checkRateLimitByKey(clientIpKey(req), "public");
    } catch {
      return new NextResponse(null, { status: 204 });
    }
    log.error("client.error", {
      clientMessage: scrubClientText(body.message),
      clientSource: body.source ?? "window",
      clientStack: body.stack ? scrubClientText(body.stack) : undefined,
      clientUrl: body.url ? stripUrlSensitive(body.url) : undefined,
    });
    // Also funnel into the backend-agnostic aggregator so client exceptions are
    // grouped/fingerprinted + alertable alongside server errors. Build a
    // synthetic Error from the (already scrubbed) client report — captureError
    // re-scrubs, fingerprints, and increments the error metric.
    const clientError = new Error(scrubClientText(body.message));
    clientError.name = "ClientError";
    if (body.stack) clientError.stack = scrubClientText(body.stack);
    captureError(clientError, {
      source: "client",
      severity: "error",
      route: body.url ? stripUrlSensitive(body.url) : undefined,
      extra: { clientSource: body.source ?? "window" },
    });
    return new NextResponse(null, { status: 204 });
  },
);
