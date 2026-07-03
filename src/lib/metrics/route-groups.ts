/**
 * Route path normalization for low-cardinality API metrics grouping.
 *
 * Dynamic segments (UUIDs, numeric IDs, Cuid-style IDs, and known positional
 * slots) are replaced with "[id]" so the resulting route group is safe to use
 * as a metric label without unbounded cardinality.
 */

import { normalizeLabelValue } from "@/lib/metrics/registry";

const API_PREFIX = "api";
const DYNAMIC_SEGMENT_LABEL = "[id]";
const STATIC_INGEST_SEGMENT = "ingest";
const MAX_GROUPED_SEGMENTS = 7;
const TRUNCATED_SEGMENT_LABEL = "[...]";
const UUID_SEGMENT_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_ID_SEGMENT_PATTERN = /^[a-z0-9_-]+$/i;
const POSITIONAL_DYNAMIC_PARENTS = new Set<string>([
  "reader",
  "highlights",
  "lists",
  "items",
]);
const ADMIN_DYNAMIC_RESOURCES = new Set<string>(["articles", "tags", "members"]);

function isKnownDynamicSlot(previous: string | undefined, beforePrevious: string | undefined): boolean {
  if (previous && POSITIONAL_DYNAMIC_PARENTS.has(previous)) return true;
  return beforePrevious === "admin" && previous !== undefined && ADMIN_DYNAMIC_RESOURCES.has(previous);
}

function isDynamicApiSegment(segment: string, index: number, segments: string[]): boolean {
  const previous = segments[index - 1];
  const beforePrevious = segments[index - 2];
  if (segment === DYNAMIC_SEGMENT_LABEL) return true;
  if (segment === STATIC_INGEST_SEGMENT) return false;
  if (/^\d+$/.test(segment)) return true;
  if (UUID_SEGMENT_PATTERN.test(segment)) {
    return true;
  }
  if (segment.length >= 12 && OPAQUE_ID_SEGMENT_PATTERN.test(segment)) return true;
  return isKnownDynamicSlot(previous, beforePrevious);
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
  if (segments[0] !== API_PREFIX) return "/other";
  const grouped = segments.map((segment, index) =>
    isDynamicApiSegment(segment, index, segments) ? DYNAMIC_SEGMENT_LABEL : sanitizeRouteSegment(segment),
  );
  const capped =
    grouped.length > MAX_GROUPED_SEGMENTS
      ? [...grouped.slice(0, MAX_GROUPED_SEGMENTS), TRUNCATED_SEGMENT_LABEL]
      : grouped;
  return `/${capped.join("/")}`;
}
