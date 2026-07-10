/**
 * Web Push / VAPID configuration (server-only).
 *
 * IMPORTANT: never import from a Client Component.
 */
import { defineFeatureConfig, envValue, type FeatureConfig } from "./env";

export type PushConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

const VAPID_ENV_KEYS = {
  publicKey: "VAPID_PUBLIC_KEY",
  privateKey: "VAPID_PRIVATE_KEY",
  subject: "VAPID_SUBJECT",
} as const;

const VAPID_SUBJECT_PATTERN = /^(mailto:[^@\s]+@[^@\s]+\.[^@\s]+|https?:\/\/.+)/i;

export function isValidVapidSubject(subject: string): boolean {
  return VAPID_SUBJECT_PATTERN.test(subject);
}

/** VAPID config for web-push (all three values trimmed). */
export const pushConfig: FeatureConfig<PushConfig> = defineFeatureConfig(() => {
  const publicKey = envValue(VAPID_ENV_KEYS.publicKey);
  const privateKey = envValue(VAPID_ENV_KEYS.privateKey);
  const subject = envValue(VAPID_ENV_KEYS.subject);
  if (!publicKey || !privateKey || !subject) {
    return null;
  }
  if (!isValidVapidSubject(subject)) {
    return null;
  }
  return { publicKey, privateKey, subject };
});
