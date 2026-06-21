/**
 * General utility helpers shared across the codebase.
 */

/**
 * Format a date as a relative human-readable string:
 * "today", "yesterday", "3 days ago", "May 2026", etc.
 *
 * Returns null when the input is null/undefined.
 */
export function formatRelativeDate(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return null;

  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return null; // future date — omit
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 14) return "1 week ago";
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 60) return "1 month ago";
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `${months} months ago`;
  }

  // Older than a year: show "Month Year"
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
