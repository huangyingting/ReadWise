/**
 * Relative time formatting — shared display helper.
 *
 * Converts an ISO timestamp into a human-readable relative string
 * ("just now", "5m ago", "2h ago", "3d ago").
 */
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export function formatRelative(isoString: string): string {
  try {
    const diff = Date.now() - new Date(isoString).getTime();
    if (diff < MINUTE_MS) return "just now";
    if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)}m ago`;
    if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)}h ago`;
    return `${Math.floor(diff / DAY_MS)}d ago`;
  } catch {
    return "";
  }
}
