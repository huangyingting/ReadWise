/**
 * Offset/limit window for the admin discovery queues (candidate review,
 * canonical conflicts, deleted identities, backfill). Matches the API
 * contract: offset ≥ 0, limit 1–200, default 50.
 */
export function adminQueueWindow(filter: { offset?: number; limit?: number }): {
  offset: number;
  limit: number;
} {
  return {
    offset: Math.max(0, filter.offset ?? 0),
    limit: Math.min(Math.max(1, filter.limit ?? 50), 200),
  };
}
