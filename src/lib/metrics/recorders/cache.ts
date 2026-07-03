/**
 * Cache hit/miss metrics recorder.
 *
 * Tracks lookups and misses per named cache. The cache name is normalised so
 * it stays low-cardinality. Hit/miss counts are derived at snapshot time from
 * the raw lookup and miss accumulators.
 */

import { normalizeLabelValue, incCacheLookup, incCacheMiss } from "@/lib/metrics/registry";

function normalizeCacheName(cache: string): string {
  return normalizeLabelValue(cache);
}

export function recordCacheLookup(cache: string): void {
  incCacheLookup(normalizeCacheName(cache));
}

export function recordCacheMiss(cache: string): void {
  incCacheMiss(normalizeCacheName(cache));
}

export function recordCacheAccess(cache: string, outcome: "hit" | "miss"): void {
  recordCacheLookup(cache);
  if (outcome === "miss") recordCacheMiss(cache);
}
