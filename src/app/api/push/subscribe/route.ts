import { createHandler, ApiError } from "@/lib/api-handler";
import { isPushConfigured } from "@/lib/push/provider";
import { checkRateLimit } from "@/lib/security/rate-limit/index";
import { subscribeBody } from "@/lib/push/schemas";
import { subscribePush } from "@/lib/push/commands";

/**
 * POST /api/push/subscribe
 *
 * Saves (or updates) the browser PushSubscription for the authenticated user.
 * Upserts by endpoint so re-subscribing is idempotent.
 */
export const POST = createHandler(
  { body: subscribeBody },
  async ({ session, body, log }) => {
    if (!isPushConfigured()) {
      log.info("push/subscribe: push not configured — returning 503");
      throw new ApiError(503, "Push notifications are not configured on this server.");
    }

    const userId = session.user.id;
    const { endpoint, p256dh, auth } = body;

    // Validate endpoint is a well-formed HTTPS URL.
    try {
      new URL(endpoint);
    } catch {
      throw new ApiError(400, "Invalid endpoint URL");
    }
    if (!endpoint.startsWith("https://")) {
      throw new ApiError(400, "Endpoint must be an HTTPS URL");
    }

    await checkRateLimit(userId, "lookup");

    const result = await subscribePush(userId, endpoint, p256dh, auth);
    if (!result.ok) {
      throw new ApiError(result.status, result.error);
    }

    log.info("push subscription saved", { userId, endpointLen: endpoint.length });
    return Response.json({ ok: true }, { status: 201 });
  },
);
