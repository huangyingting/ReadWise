/**
 * PURE discovery-canary reconciliation (issue #1090, Phase 1.10).
 *
 * Compares the ledger's OBSERVATIONS for a canary against a CONTROLLED
 * provider-published SAMPLE (the ground truth of what should be observable in the
 * current window) and classifies every item, so the exit gates can assert there
 * were NO unexplained misses. This module contains NO database, network, or clock
 * access; the thin `scripts/reconcile-discovery-canary.ts` runner assembles the
 * two sets from metadata-only reads and hands them here.
 *
 * METADATA ONLY (AC4): the only identifiers used are SANITIZED identity keys
 * (versioned digests, never a raw URL), plus counts and sanitized category
 * labels. Nothing here accepts or emits a raw URL, article body, or secret.
 *
 * Outcome vocabulary (exactly one per compared identity):
 *   - `hit`              — a sample item present in the ledger observations.
 *   - `explained-miss`   — a sample item absent from the ledger but NOT expected
 *                          to be observable now (outside the window / not yet
 *                          observable / policy-excluded). An acceptable absence.
 *   - `unexplained-miss` — a sample item that SHOULD be observable now but is
 *                          absent from the ledger. The gate-breaking case.
 *   - `extra`            — a ledger observation not present in the sample
 *                          (informational; never fails a gate on its own).
 */

/** A single controlled provider-published sample item (ground truth). */
export type ReconciliationSampleItem = {
  /** Sanitized versioned identity key (never a raw URL). */
  identityKey: string;
  /** Ground truth: whether this identity SHOULD be observable in the current window. */
  expectedObservable: boolean;
  /** Optional sanitized category label for a per-category rollup. */
  category?: string;
};

/** A single ledger observation for the canary (what discovery actually saw). */
export type ReconciliationLedgerEntry = {
  /** Sanitized versioned identity key (never a raw URL). */
  identityKey: string;
};

/** Exactly one outcome per compared identity. */
export type ReconciliationOutcome = "hit" | "explained-miss" | "unexplained-miss" | "extra";

/** Per-category counts (sanitized category → outcome tallies). */
export type ReconciliationCategoryCounts = Record<
  string,
  { hits: number; explainedMisses: number; unexplainedMisses: number }
>;

/** The metadata-only reconciliation result consumed by the exit gates. */
export type ReconciliationResult = {
  sampleSize: number;
  ledgerSize: number;
  hits: number;
  explainedMisses: number;
  unexplainedMisses: number;
  extras: number;
  /** Sanitized identity keys of unexplained misses (safe to record; never URLs). */
  unexplainedMissIds: string[];
  /** Sanitized identity keys of extras (observed but not in the sample). */
  extraIds: string[];
  byCategory: ReconciliationCategoryCounts;
};

const UNCATEGORIZED = "uncategorized";

/**
 * Reconciles a canary's ledger observations against a controlled sample. Pure and
 * deterministic: identical inputs always yield an identical result. Duplicate
 * identity keys within either set are collapsed (each identity is compared once).
 */
export function reconcile(
  sample: readonly ReconciliationSampleItem[],
  ledger: readonly ReconciliationLedgerEntry[],
): ReconciliationResult {
  const ledgerKeys = new Set(ledger.map((entry) => entry.identityKey));
  // Collapse duplicate sample items by identity key (first occurrence wins).
  const sampleByKey = new Map<string, ReconciliationSampleItem>();
  for (const item of sample) {
    if (!sampleByKey.has(item.identityKey)) sampleByKey.set(item.identityKey, item);
  }

  const byCategory: ReconciliationCategoryCounts = {};
  const bump = (category: string, field: "hits" | "explainedMisses" | "unexplainedMisses"): void => {
    const bucket = (byCategory[category] ??= { hits: 0, explainedMisses: 0, unexplainedMisses: 0 });
    bucket[field] += 1;
  };

  let hits = 0;
  let explainedMisses = 0;
  let unexplainedMisses = 0;
  const unexplainedMissIds: string[] = [];

  for (const item of sampleByKey.values()) {
    const category = item.category ?? UNCATEGORIZED;
    if (ledgerKeys.has(item.identityKey)) {
      hits += 1;
      bump(category, "hits");
    } else if (item.expectedObservable) {
      unexplainedMisses += 1;
      unexplainedMissIds.push(item.identityKey);
      bump(category, "unexplainedMisses");
    } else {
      explainedMisses += 1;
      bump(category, "explainedMisses");
    }
  }

  const extraIds: string[] = [];
  for (const key of ledgerKeys) {
    if (!sampleByKey.has(key)) extraIds.push(key);
  }

  return {
    sampleSize: sampleByKey.size,
    ledgerSize: ledgerKeys.size,
    hits,
    explainedMisses,
    unexplainedMisses,
    extras: extraIds.length,
    unexplainedMissIds: unexplainedMissIds.sort(),
    extraIds: extraIds.sort(),
    byCategory,
  };
}

/** A zero/empty reconciliation result (no sample compared). */
export function emptyReconciliation(): ReconciliationResult {
  return {
    sampleSize: 0,
    ledgerSize: 0,
    hits: 0,
    explainedMisses: 0,
    unexplainedMisses: 0,
    extras: 0,
    unexplainedMissIds: [],
    extraIds: [],
    byCategory: {},
  };
}
