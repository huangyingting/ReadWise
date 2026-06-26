/**
 * Feature kill switches — env-driven booleans to intentionally disable
 * high-risk or expensive optional features even when provider credentials
 * are present (server-only).
 *
 * Convention: `FEATURE_<NAME>_ENABLED` (default "true" when absent).
 * Accepted values (case-insensitive): "0" | "false" | "off" → disabled;
 * anything else, or absent → enabled.
 *
 * Disabled state degrades identically to unconfigured: providers short-circuit
 * to their null/fallback path without throwing. This ensures graceful rollback
 * without credential changes.
 *
 * IMPORTANT: server-only. Never import from a Client Component.
 * See docs/platform/runtime-config.md.
 */

export type FeatureKey = "ai" | "tts" | "push" | "scraper";

const FEATURE_ENV: Record<FeatureKey, string> = {
  ai: "FEATURE_AI_ENABLED",
  tts: "FEATURE_TTS_ENABLED",
  push: "FEATURE_PUSH_ENABLED",
  scraper: "FEATURE_SCRAPER_ENABLED",
};

/**
 * Returns `false` only when the corresponding `FEATURE_<NAME>_ENABLED` env var
 * is explicitly set to a falsy value ("0", "false", or "off"). Returns `true`
 * by default (absent or any other value) so existing behavior is unchanged.
 */
export function isFeatureEnabled(feature: FeatureKey): boolean {
  const raw = process.env[FEATURE_ENV[feature]]?.trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

/** Convenience helpers — preferred over `isFeatureEnabled` for single-feature gates. */
export const isAiFeatureEnabled = (): boolean => isFeatureEnabled("ai");
export const isTtsFeatureEnabled = (): boolean => isFeatureEnabled("tts");
export const isPushFeatureEnabled = (): boolean => isFeatureEnabled("push");
export const isScraperFeatureEnabled = (): boolean => isFeatureEnabled("scraper");
