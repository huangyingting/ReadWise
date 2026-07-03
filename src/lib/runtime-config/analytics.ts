/**
 * Product analytics configuration (server-only).
 *
 * IMPORTANT: never import from a Client Component.
 */
import { positiveIntEnv } from "@/lib/runtime-config/env";

const analyticsEnabledEnv = "ANALYTICS_ENABLED";
const analyticsRetentionDaysEnv = "ANALYTICS_RETENTION_DAYS";
const analyticsRetentionDaysDefault = 400;
const truthyEnvValues = new Set(["1", "true"]);
const falsyEnvValues = new Set(["0", "false"]);

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  const normalized = (value ?? "").trim().toLowerCase();
  if (truthyEnvValues.has(normalized)) return true;
  if (falsyEnvValues.has(normalized)) return false;
  return undefined;
}

/**
 * Whether the product analytics event stream persists events to the database.
 * Defaults OFF under NODE_ENV=test and ON otherwise. Set ANALYTICS_ENABLED=0 to disable.
 */
export function analyticsEnabled(): boolean {
  const configured = parseBooleanEnv(process.env[analyticsEnabledEnv]);
  if (configured !== undefined) return configured;
  return process.env.NODE_ENV !== "test";
}

/**
 * Retention window (in days) for pruneOldEvents. Defaults to 400 days.
 * Set via ANALYTICS_RETENTION_DAYS.
 */
export function analyticsRetentionDays(): number {
  return positiveIntEnv(analyticsRetentionDaysEnv, analyticsRetentionDaysDefault);
}
