/**
 * Thin persistence op that REQUESTS an incremental discovery run for a
 * provider's discovery sources (issue #1097, Phase 2.7).
 *
 * The normal admin trigger and provider CLI no longer synchronously discover +
 * scrape URLs (which could rescrape a KNOWN public Article). Instead they mark
 * the provider's claimable-mode discovery sources DUE (`nextRunAt = now`) so the
 * worker's discovery loop (`runDiscoveryLoop` → `claimDueDiscoverySource` →
 * `runClaimedDiscoverySource`) picks them up and runs bounded, ledger-based
 * discovery pages. Bodies are fetched later by the candidate-ingest job
 * pipeline. NO body is fetched and NO Article is written here — only
 * ledger-safe identities first observed AFTER a completed baseline are ever
 * ingested (the governing invariant).
 *
 * Only sources already in a CLAIMABLE lifecycle mode (`SHADOW`/`BASELINE`/
 * `ACTIVE`) are woken; `DISABLED`/`PAUSED`/`RETIRED` sources require an explicit
 * lifecycle action first, so a trigger can never resurrect a stopped source.
 * PRIVACY: only provider keys, counts, and timestamps cross this seam — never a
 * URL or article content.
 */
import { prisma } from "@/lib/prisma";

import { CLAIMABLE_LIFECYCLE_MODES } from "./schedule";

/** Outcome of an incremental-run request. */
export type IncrementalRunRequestResult = {
  /** Number of discovery sources made due (`nextRunAt = now`) by this request. */
  requested: number;
};

/**
 * Marks the given providers' claimable-mode discovery sources due so the
 * discovery loop runs them. Idempotent (setting `nextRunAt = now` again is a
 * no-op re-request) and safe: it never changes a source's lifecycle mode,
 * lease, or watermark, and never touches a non-claimable source.
 */
export async function requestIncrementalRun(
  providerKeys: readonly string[],
  now: Date = new Date(),
): Promise<IncrementalRunRequestResult> {
  if (providerKeys.length === 0) return { requested: 0 };

  const updated = await prisma.discoverySource.updateMany({
    where: {
      providerKey: { in: [...providerKeys] },
      lifecycleMode: { in: [...CLAIMABLE_LIFECYCLE_MODES] },
    },
    data: { nextRunAt: now, updatedAt: now },
  });

  return { requested: updated.count };
}
