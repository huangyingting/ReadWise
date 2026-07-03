import { createPublicHandler } from "@/lib/api-handler";
import { vapidPublicKey } from "@/lib/push/provider";

const PUSH_NOT_CONFIGURED_STATUS = 503;

/**
 * GET /api/push/vapid-public-key
 *
 * Returns the VAPID public key so the client can subscribe to push notifications.
 * This is public (no auth required) — the public key is not sensitive.
 * Returns 503 when push is not configured.
 */
export const GET = createPublicHandler({}, async ({ log }) => {
  const key = vapidPublicKey();
  if (!key) {
    log.info("vapid-public-key: push not configured");
    return pushNotConfiguredResponse();
  }
  return vapidPublicKeyResponse(key);
});

function pushNotConfiguredResponse(): Response {
  return Response.json({ configured: false }, { status: PUSH_NOT_CONFIGURED_STATUS });
}

function vapidPublicKeyResponse(publicKey: string): Response {
  return Response.json({ configured: true, publicKey });
}
