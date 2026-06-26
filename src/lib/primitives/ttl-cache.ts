/**
 * Shared TTL Map primitive with bounded LRU eviction.
 *
 * Standardises the Map+expiry hit/miss/set pattern used across the codebase
 * (robots.txt cache, etc.). Entries expire after `ttlMs` milliseconds. When
 * `maxSize` is reached the oldest entry (by insertion order, i.e. approximate
 * LRU) is evicted before the new one is inserted. This keeps memory bounded
 * regardless of how many distinct keys are produced over the lifetime of the
 * process.
 *
 * NOTE: This primitive is intentionally kept OUT of Next's Data Cache. It is
 * designed for in-process caches that carry network-origin TTLs (e.g. fetched
 * robots.txt files) or other data that must NOT participate in tag-based
 * invalidation. For tag-invalidatable listing caches use
 * `createTenantCachedListing` from `@/lib/cache` instead.
 */

export interface TtlCacheOptions {
  /** Entry lifetime in milliseconds. */
  ttlMs: number;
  /** Maximum number of live entries; oldest entry is evicted when limit is hit. */
  maxSize?: number;
}

type Entry<V> = { value: V; expiresAt: number };

/** Typed TTL Map with bounded LRU eviction. */
export class TtlCache<K, V> {
  private readonly store: Map<K, Entry<V>>;
  private readonly ttlMs: number;
  private readonly maxSize: number;

  constructor(opts: TtlCacheOptions) {
    this.store = new Map();
    this.ttlMs = opts.ttlMs;
    this.maxSize = opts.maxSize ?? Infinity;
  }

  /**
   * Returns the cached value for `key` if it exists and has not expired.
   * Stale entries are lazily deleted on access.
   */
  get(key: K, now = Date.now()): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (now >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * Stores `value` under `key` for `ttlMs` milliseconds.
   * Re-inserting an existing key refreshes its TTL and moves it to the end of
   * the eviction queue. When `maxSize` is reached the oldest entry is evicted.
   */
  set(key: K, value: V, now = Date.now()): void {
    // Re-insert at the end to refresh position in eviction order.
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxSize) {
      const oldest = this.store.keys().next().value as K | undefined;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: now + this.ttlMs });
  }

  /** Removes an entry. Returns true if the key existed. */
  delete(key: K): boolean {
    return this.store.delete(key);
  }

  /** Removes all entries (used by test seams). */
  clear(): void {
    this.store.clear();
  }

  /** Number of entries currently in the cache (may include some stale). */
  get size(): number {
    return this.store.size;
  }
}

/** Convenience factory — avoids `new TtlCache(...)` at call sites. */
export function createTtlCache<K, V>(opts: TtlCacheOptions): TtlCache<K, V> {
  return new TtlCache<K, V>(opts);
}
