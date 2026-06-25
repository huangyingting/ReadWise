import { createHandler, ApiError } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { isPushConfigured } from "@/lib/push";
import { checkRateLimit } from "@/lib/rate-limit";
import { unsubscribeBody } from "@/lib/push/schemas";

/**
 * POST /api/push/unsubscribe
 *
 * Removes the push subscription for the given endpoint.
 * No-op when the endpoint is not found (idempotent).
 */
export const POST = createHandler(
  { body: unsubscribeBody },
  async ({ session, body, log }) => {
    if (!isPushConfigured()) {
      log.info("push/unsubscribe: push not configured — returning 503");
      throw new ApiError(503, "Push notifications are not configured on this server.");
    }

    const userId = session.user.id;
    const { endpoint } = body;

    await checkRateLimit(userId, "lookup");

    // Only delete if it belongs to the authenticated user.
    await prisma.pushSubscription.deleteMany({
      where: { endpoint, userId },
    });

    log.info("push subscription removed", { userId, endpointLen: endpoint.length });
    return Response.json({ ok: true });
  },
);
