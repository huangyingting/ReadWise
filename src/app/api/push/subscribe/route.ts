import { createHandler, ApiError } from "@/lib/api-handler";
import { object, nonEmptyString } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { isPushConfigured } from "@/lib/push";

const subscribeBody = object({
  endpoint: nonEmptyString(2048),
  p256dh: nonEmptyString(256),
  auth: nonEmptyString(128),
});

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

    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { p256dh, auth, userId },
      create: { userId, endpoint, p256dh, auth },
    });

    log.info("push subscription saved", { userId, endpointLen: endpoint.length });
    return Response.json({ ok: true }, { status: 201 });
  },
);
