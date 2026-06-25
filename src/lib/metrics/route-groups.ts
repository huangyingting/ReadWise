/**
 * Route path normalization for low-cardinality API metrics grouping.
 *
 * Dynamic segments (UUIDs, numeric IDs, Cuid-style IDs, and known positional
 * slots) are replaced with "[id]" so the resulting route group is safe to use
 * as a metric label without unbounded cardinality.
 */

import { normalizeLabelValue } from "@/lib/metrics/registry";

function isDynamicApiSegment(segment: string, index: number, segments: string[]): boolean {
  const previous = segments[index - 1];
  const beforePrevious = segments[index - 2];
  if (segment === "[id]") return true;
  if (segment === "ingest") return false;
  if (/^\d+$/.test(segment)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment)) {
    return true;
  }
  if (segment.length >= 12 && /^[a-z0-9_-]+$/i.test(segment)) return true;
  if (previous === "reader" || previous === "highlights" || previous === "lists" || previous === "items") {
    return true;
  }
  if (beforePrevious === "admin" && (previous === "articles" || previous === "tags" || previous === "members")) {
    return true;
  }
  return false;
}

function sanitizeRouteSegment(segment: string): string {
  return normalizeLabelValue(segment, "segment").replace(/\.+/g, ".");
}

/**
 * Map a raw request pathname to a low-cardinality route group string.
 *
 * Non-API paths become "/other". Dynamic API segments become "[id]". Paths
 * longer than 7 segments are capped with "[...]" to bound cardinality further.
 */
export function routeGroupFromPath(pathname: string): string {
  const cleanPath = pathname.split("?")[0] ?? pathname;
  const segments = cleanPath.split("/").filter(Boolean);
  if (segments[0] !== "api") return "/other";
  const grouped = segments.map((segment, index) =>
    isDynamicApiSegment(segment, index, segments) ? "[id]" : sanitizeRouteSegment(segment),
  );
  const capped = grouped.length > 7 ? [...grouped.slice(0, 7), "[...]"] : grouped;
  return `/${capped.join("/")}`;
}
