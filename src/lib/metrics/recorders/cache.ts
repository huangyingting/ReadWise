/**
 * Cache hit/miss metrics recorder.
 *
 * Tracks lookups and misses per named cache. The cache name is normalised so
 * it stays low-cardinality. Hit/miss counts are derived at snapshot time from
 * the raw lookup and miss accumulators.
 */

import { normalizeLabelValue, incCacheLookup, incCacheMiss } from "@/lib/metrics/registry";

export function recordCacheLookup(cache: string): void {
  incCacheLookup(normalizeLabelValue(cache));
}

export function recordCacheMiss(cache: string): void {
  incCacheMiss(normalizeLabelValue(cache));
}

export function recordCacheAccess(cache: string, outcome: "hit" | "miss"): void {
  recordCacheLookup(cache);
  if (outcome === "miss") recordCacheMiss(cache);
}
