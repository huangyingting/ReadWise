import { createHandler, ApiError } from "@/lib/api-handler";
import { object, nonEmptyString } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { isPushConfigured } from "@/lib/push";

const unsubscribeBody = object({
  endpoint: nonEmptyString(2048),
});

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

    // Only delete if it belongs to the authenticated user.
    await prisma.pushSubscription.deleteMany({
      where: { endpoint, userId },
    });

    log.info("push subscription removed", { userId, endpointLen: endpoint.length });
    return Response.json({ ok: true });
  },
);
