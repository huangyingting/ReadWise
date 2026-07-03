import { createHandler, ApiError } from "@/lib/api-handler";
import { isPushConfigured } from "@/lib/push/provider";
import { checkRateLimit } from "@/lib/security/rate-limit/index";
import { unsubscribeBody } from "@/lib/push/schemas";
import { unsubscribePush } from "@/lib/push/commands";

const PUSH_NOT_CONFIGURED_MESSAGE = "Push notifications are not configured on this server.";
const RATE_LIMIT_ACTION = "lookup";

function assertPushConfigured(log: { info: (message: string) => void }): void {
  if (isPushConfigured()) return;
  log.info("push/unsubscribe: push not configured — returning 503");
  throw new ApiError(503, PUSH_NOT_CONFIGURED_MESSAGE);
}

function unsubscribeLogMetadata(userId: string, endpoint: string) {
  return { userId, endpointLen: endpoint.length };
}

/**
 * POST /api/push/unsubscribe
 *
 * Removes the push subscription for the given endpoint.
 * No-op when the endpoint is not found (idempotent).
 */
export const POST = createHandler(
  { body: unsubscribeBody },
  async ({ session, body, log }) => {
    assertPushConfigured(log);

    const userId = session.user.id;
    const { endpoint } = body;

    await checkRateLimit(userId, RATE_LIMIT_ACTION);

    const result = await unsubscribePush(userId, endpoint);
    if (!result.ok) {
      throw new ApiError(result.status, result.error);
    }

    log.info("push subscription removed", unsubscribeLogMetadata(userId, endpoint));
    return Response.json({ ok: true });
  },
);
