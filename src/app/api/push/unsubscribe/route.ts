import { createHandler, ApiError } from "@/lib/api-handler";
import { isPushConfigured } from "@/lib/push/provider";
import { checkRateLimit } from "@/lib/security/rate-limit/index";
import { unsubscribeBody } from "@/lib/push/schemas";
import { unsubscribePush } from "@/lib/push/commands";

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

    const result = await unsubscribePush(userId, endpoint);
    if (!result.ok) {
      throw new ApiError(result.status, result.error);
    }

    log.info("push subscription removed", { userId, endpointLen: endpoint.length });
    return Response.json({ ok: true });
  },
);
