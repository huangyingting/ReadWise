import { createHandler, ApiError } from "@/lib/api-handler";
import {
  enforceRateLimitPolicy,
  sessionUserRateLimitPolicy,
} from "@/lib/security/rate-limit/index";
import { unsubscribeBody } from "@/lib/push/schemas";
import { unsubscribePush } from "@/lib/push/commands";

const PUSH_UNSUBSCRIBE_RATE_LIMIT = sessionUserRateLimitPolicy("lookup");

function unsubscribeLogMetadata(userId: string, endpoint: string) {
  return { userId, endpointLen: endpoint.length };
}

/**
 * POST /api/push/unsubscribe
 *
 * Removes the push subscription for the given endpoint.
 * No-op when the endpoint is not found (idempotent).
 * This local cleanup remains available when VAPID delivery is unconfigured so
 * users can remove subscriptions during provider outages or key rotation.
 */
export const POST = createHandler(
  { body: unsubscribeBody },
  async ({ session, body, log }) => {
    const userId = session.user.id;
    const { endpoint } = body;

    await enforceRateLimitPolicy(PUSH_UNSUBSCRIBE_RATE_LIMIT, { session });

    const result = await unsubscribePush(userId, endpoint);
    if (!result.ok) {
      throw new ApiError(result.status, result.error);
    }

    log.info("push subscription removed", unsubscribeLogMetadata(userId, endpoint));
    return Response.json({ ok: true });
  },
);
