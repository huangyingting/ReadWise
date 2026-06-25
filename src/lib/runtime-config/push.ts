/**
 * Web Push / VAPID configuration (server-only).
 *
 * IMPORTANT: never import from a Client Component.
 */
import { defineFeatureConfig, envValue, type FeatureConfig } from "@/lib/runtime-config/env";

export type PushConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

export function isValidVapidSubject(subject: string): boolean {
  return /^(mailto:[^@\s]+@[^@\s]+\.[^@\s]+|https?:\/\/.+)/i.test(subject);
}

/** VAPID config for web-push (all three values trimmed). */
export const pushConfig: FeatureConfig<PushConfig> = defineFeatureConfig(() => {
  const publicKey = envValue("VAPID_PUBLIC_KEY");
  const privateKey = envValue("VAPID_PRIVATE_KEY");
  const subject = envValue("VAPID_SUBJECT");
  if (!publicKey || !privateKey || !subject) {
    return null;
  }
  if (!isValidVapidSubject(subject)) {
    return null;
  }
  return { publicKey, privateKey, subject };
});
