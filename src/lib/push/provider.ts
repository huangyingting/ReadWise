/**
 * VAPID/web-push provider — the only module that imports `web-push`.
 *
 * Initialises web-push lazily so module load never throws when VAPID keys are
 * absent. All other push modules must send via `sendWebPushNotification` rather
 * than importing web-push directly.
 *
 * Server-only — never import from a Client Component or the SW script.
 */
import webpush from "web-push";
import { createLogger } from "@/lib/logger";
import { pushConfig } from "@/lib/runtime-config/push";

const log = createLogger("push");

let pushInitialised = false;
let pushInitKey: string | null = null;

type VapidCfg = { publicKey: string; privateKey: string; subject: string };

function readVapidConfig(): VapidCfg | null {
  return pushConfig.get();
}

function configKey(cfg: VapidCfg): string {
  return `${cfg.subject}\n${cfg.publicKey}\n${cfg.privateKey}`;
}

/**
 * Ensures web-push is initialised with the current VAPID config.
 * Returns false (and logs a warning) when config is absent or rejected.
 */
export function ensurePushInit(): boolean {
  const cfg = readVapidConfig();
  if (!cfg) return false;
  const key = configKey(cfg);
  if (pushInitialised && pushInitKey === key) return true;

  try {
    webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    pushInitialised = true;
    pushInitKey = key;
  } catch (err) {
    pushInitialised = false;
    pushInitKey = null;
    log.warn("invalid VAPID configuration — push disabled", { error: String(err) });
    return false;
  }
  return true;
}

/** Returns true when VAPID env vars are present and accepted by web-push. */
export function isPushConfigured(): boolean {
  return pushConfig.isConfigured() && ensurePushInit();
}

/** The VAPID public key (safe to expose to clients), or null when unconfigured. */
export function vapidPublicKey(): string | null {
  return readVapidConfig()?.publicKey ?? null;
}

/**
 * Sends a notification via web-push.
 * Callers must have verified push is initialised via `ensurePushInit()` first.
 */
export async function sendWebPushNotification(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
): Promise<void> {
  await webpush.sendNotification(subscription, payload);
}
