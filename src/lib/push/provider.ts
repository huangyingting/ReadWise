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
import { createLogger } from "@/lib/observability/logger";
import { pushConfig } from "@/lib/runtime-config/push";
import { isPushFeatureEnabled } from "@/lib/runtime-config/feature-flags";

const log = createLogger("push");

const VAPID_CONFIG_KEY_SEPARATOR = "\n";

let pushInitialised = false;
let pushInitKey: string | null = null;

type VapidCfg = { publicKey: string; privateKey: string; subject: string };

function readVapidConfig(): VapidCfg | null {
  return pushConfig.get();
}

function configKey(cfg: VapidCfg): string {
  return `${cfg.subject}${VAPID_CONFIG_KEY_SEPARATOR}${cfg.publicKey}${VAPID_CONFIG_KEY_SEPARATOR}${cfg.privateKey}`;
}

function rememberPushInit(key: string): void {
  pushInitialised = true;
  pushInitKey = key;
}

function resetPushInit(): void {
  pushInitialised = false;
  pushInitKey = null;
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
    rememberPushInit(key);
  } catch {
    resetPushInit();
    log.warn("invalid VAPID configuration — push disabled", {
      machineReason: "invalid_vapid_configuration",
    });
    return false;
  }
  return true;
}

/** Returns true when VAPID env vars are present, accepted by web-push, and push is enabled. */
export function isPushConfigured(): boolean {
  return isPushFeatureEnabled() && ensurePushInit();
}

/** The VAPID public key (safe to expose to clients), or null when unconfigured or disabled. */
export function vapidPublicKey(): string | null {
  if (!isPushFeatureEnabled() || !ensurePushInit()) return null;
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
