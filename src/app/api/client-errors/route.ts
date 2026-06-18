import { NextResponse } from "next/server";
import { createPublicHandler } from "@/lib/api-handler";
import { object, nonEmptyString, optional, string } from "@/lib/validation";

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
  userAgent: optional(string({ max: 500 })),
});

export const POST = createPublicHandler(
  { body: bodySchema },
  async ({ body, log }) => {
    log.error("client.error", {
      clientMessage: body.message,
      clientSource: body.source ?? "window",
      clientStack: body.stack,
      clientUrl: body.url,
      clientUserAgent: body.userAgent,
    });
    return new NextResponse(null, { status: 204 });
  },
);
