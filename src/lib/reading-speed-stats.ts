/**
 * Reading speed stats — DB helper for the progress page (#378).
 *
 * Re-exports from the focused engagement/reading-speed-repo sub-module,
 * which keeps the DB access layer separate from the pure computation logic
 * in engagement/reading-speed.ts.
 */

export { getReadingSpeedStats } from "@/lib/engagement/reading-speed-repo";
