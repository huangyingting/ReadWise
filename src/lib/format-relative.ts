/**
 * Relative time formatting — shared display helper.
 *
 * Converts an ISO timestamp into a human-readable relative string
 * ("just now", "5m ago", "2h ago", "3d ago").
 */
export function formatRelative(isoString: string): string {
  try {
    const diff = Date.now() - new Date(isoString).getTime();
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  } catch {
    return "";
  }
}
