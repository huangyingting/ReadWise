/**
 * Reading speed analytics (#378).
 *
 * Re-exports all public APIs from the focused engagement/reading-speed
 * sub-module. The implementation lives in engagement/reading-speed.ts so
 * the pure WPM computation logic is independently testable without mocking
 * Prisma.
 */

export {
  MIN_ACTIVE_TIME_MS,
  MAX_ACTIVE_TIME_MS,
  MIN_WPM,
  MAX_WPM,
  clampActiveTime,
  computeWpm,
  computeWpmTrend,
} from "@/lib/engagement/reading-speed";
export type { SpeedRecord } from "@/lib/engagement/reading-speed";
