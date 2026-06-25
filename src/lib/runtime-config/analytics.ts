/**
 * Product analytics configuration (server-only).
 *
 * IMPORTANT: never import from a Client Component.
 */
import { positiveIntEnv } from "@/lib/runtime-config/env";

/**
 * Whether the product analytics event stream persists events to the database.
 * Defaults OFF under NODE_ENV=test and ON otherwise. Set ANALYTICS_ENABLED=0 to disable.
 */
export function analyticsEnabled(): boolean {
  const raw = (process.env.ANALYTICS_ENABLED ?? "").trim().toLowerCase();
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return process.env.NODE_ENV !== "test";
}

/**
 * Retention window (in days) for pruneOldEvents. Defaults to 400 days.
 * Set via ANALYTICS_RETENTION_DAYS.
 */
export function analyticsRetentionDays(): number {
  return positiveIntEnv("ANALYTICS_RETENTION_DAYS", 400);
}
