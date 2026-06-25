import { createHandler, ApiError } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { isPushConfigured } from "@/lib/push/provider";
import { checkRateLimit } from "@/lib/security/rate-limit/index";
import { subscribeBody } from "@/lib/push/schemas";

const MAX_SUBSCRIPTIONS_PER_USER = 10;

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

    // Enforce per-user subscription cap (upserts on existing endpoint don't count).
    const existing = await prisma.pushSubscription.findUnique({
      where: { endpoint },
      select: { userId: true },
    });
    if (!existing) {
      const count = await prisma.pushSubscription.count({ where: { userId } });
      if (count >= MAX_SUBSCRIPTIONS_PER_USER) {
        throw new ApiError(409, "Too many subscriptions");
      }
    }

    await checkRateLimit(userId, "lookup");

    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { p256dh, auth, userId },
      create: { userId, endpoint, p256dh, auth },
    });

    log.info("push subscription saved", { userId, endpointLen: endpoint.length });
    return Response.json({ ok: true }, { status: 201 });
  },
);
