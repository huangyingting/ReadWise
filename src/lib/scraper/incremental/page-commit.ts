/**
 * Atomic paged discovery commit (issue #1085, Phase 1.5).
 *
 * Commits one bounded, already-fetched discovery page so that EVERY item is
 * durably classified BEFORE the source's continuation checkpoint can advance.
 * This is the keystone replay-safety boundary of Phase 1: routes, scripts, and
 * workers call {@link commitDiscoveryPage} and MUST NOT re-implement the
 * classification rules (see `classify.ts`).
 *
 * Invariants enforced here:
 *   1. Network reads stay OUTSIDE the transaction. The page is fetched via the
 *      #1084 seam by the caller; only DB writes + lease revalidation run inside
 *      the single interactive transaction.
 *   2. The checkpoint advances ONLY after every item's writes succeed, inside
 *      the same transaction — so a fault after any write boundary rolls the
 *      whole page back and the checkpoint never advances with a missing outcome.
 *   3. Every page commit revalidates lease ownership + `definitionVersion`
 *      (both before opening the transaction AND via a guarded conditional update
 *      when advancing the checkpoint). A lost lease aborts without writing.
 *   4. Idempotent races are cross-engine safe: candidate/alias/observation writes
 *      use `upsert` (INSERT … ON CONFLICT), never a catch-P2002-inside-tx (which
 *      would poison a PostgreSQL transaction). Replaying the same page produces
 *      NO extra candidate, alias, observation, or (Phase-2) ingest job.
 *   5. Baseline/shadow commits create NO Article, NO body fetch, and NO
 *      `ARTICLE_INGEST` job — Phase 1 is discovery-only (ingest is #1091/Phase 2).
 */
import { CrawlCandidateStatus, Prisma, UrlAliasKind } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import {
  classifyPage,
  identityCompositeKey,
  type ClassifiedIdentity,
  type ClassifiedPageItem,
  type DiscoveryPageResult,
  type PageClassificationContext,
  type PageItemOutcomeKind,
} from "./classify";

/** Options for {@link commitDiscoveryPage}. */
export type CommitDiscoveryPageOptions = {
  /** Target `DiscoverySource.id`. */
  sourceId: string;
  /** Opaque worker lease token. Must still match `DiscoverySource.leaseOwner`. */
  leaseOwner: string;
  /** Expected `DiscoverySource.definitionVersion`. Mismatch = a stale definition. */
  definitionVersion: number;
  /** The already-fetched page (network read done by the caller, outside the tx). */
  page: DiscoveryPageResult;
  /** Sanitized CrawlRun reference recorded on each observation (never a secret). */
  runId?: string;
  /** Override "now" (testing / determinism). */
  now?: Date;
  /**
   * Override the frontier window lower bound. Defaults to the source's
   * `watermarkAt ?? baselineCompletedAt`.
   */
  windowStart?: Date | null;
  /** Provider resolver override forwarded to classification (tests). */
  resolveProvider?: PageClassificationContext["resolveProvider"];
  /** Identity deriver override forwarded to classification (tests). */
  deriveIdentity?: PageClassificationContext["deriveIdentity"];
  /**
   * TEST-ONLY fault-injection hooks invoked at write boundaries INSIDE the
   * transaction, receiving the live transaction client. Throwing from a hook
   * proves the whole page rolls back atomically (the checkpoint never advances);
   * mutating the source via `tx` proves a mid-commit lease steal is caught by the
   * guarded checkpoint advance. Never set in production.
   */
  debugHooks?: {
    afterItemWrite?: (index: number, tx: Prisma.TransactionClient) => void | Promise<void>;
    beforeCheckpoint?: (tx: Prisma.TransactionClient) => void | Promise<void>;
  };
};

/** Per-outcome tally for the committed page. */
export type PageOutcomeCounts = Record<PageItemOutcomeKind, number>;

/** Result of a page commit. */
export type CommitDiscoveryPageResult =
  | { committed: false; reason: "source-not-found" | "lease-lost" }
  | {
      committed: true;
      /** Count of items assigned to each outcome. */
      outcomes: PageOutcomeCounts;
      /** Distinct items committed (deduplicated by observation key). */
      itemsCommitted: number;
      /** Candidate rows ensured (eligible + baseline-shadow + re-observed existing). */
      candidatesUpserted: number;
      /** Alias rows ensured. */
      aliasesUpserted: number;
      /** Distinct observation rows ensured. */
      observationsUpserted: number;
      /** The checkpoint the source now points at. */
      checkpoint: { cursor: string | null; page: number | null };
      boundaryReached: boolean;
    };

/** Internal signal used to roll back the whole transaction on a lost lease. */
class LeaseLostError extends Error {
  constructor() {
    super("discovery source lease/version lost during page commit");
    this.name = "LeaseLostError";
  }
}

function emptyOutcomeCounts(): PageOutcomeCounts {
  return {
    "eligible": 0,
    "baseline-shadow": 0,
    "existing-identity": 0,
    "policy-rejected": 0,
    "outside-window": 0,
    "review-required": 0,
  };
}

/** Outcomes that ensure (create or keep) a permanent candidate identity. */
function outcomeCreatesCandidate(outcome: PageItemOutcomeKind): boolean {
  return outcome === "eligible" || outcome === "baseline-shadow";
}

async function loadKnownIdentityKeys(
  identities: ClassifiedIdentity[],
): Promise<ReadonlySet<string>> {
  if (identities.length === 0) return new Set();
  const rows = await prisma.crawlCandidate.findMany({
    where: {
      OR: identities.map((identity) => ({
        providerKey: identity.providerKey,
        identityVersion: identity.identityVersion,
        provisionalKey: identity.provisionalKey,
      })),
    },
    select: { providerKey: true, identityVersion: true, provisionalKey: true },
  });
  return new Set(
    rows.map((row) => identityCompositeKey(row.providerKey, row.identityVersion, row.provisionalKey)),
  );
}

type ItemWriteTally = { candidate: boolean; alias: boolean; observation: boolean };

async function commitClassifiedItem(
  tx: Prisma.TransactionClient,
  sourceId: string,
  runId: string | undefined,
  now: Date,
  classified: ClassifiedPageItem,
): Promise<ItemWriteTally> {
  const { identity, outcome, observationKey } = classified;
  const identityVersion = identity?.identityVersion ?? 1;
  const positionRank = classified.item.positionRank;
  const httpStatus = classified.item.httpStatus;

  let candidateId: string | null = null;
  let candidateEnsured = false;
  let aliasEnsured = false;

  if (identity) {
    const composite = {
      providerKey_identityVersion_provisionalKey: {
        providerKey: identity.providerKey,
        identityVersion: identity.identityVersion,
        provisionalKey: identity.provisionalKey,
      },
    };

    if (outcomeCreatesCandidate(outcome)) {
      const observedInBaseline = outcome === "baseline-shadow";
      const status =
        outcome === "baseline-shadow"
          ? CrawlCandidateStatus.BASELINE
          : CrawlCandidateStatus.DISCOVERED;
      // upsert is cross-engine race-safe (INSERT … ON CONFLICT): a concurrent
      // commit of the same page converges on ONE candidate, never a lost item.
      const candidate = await tx.crawlCandidate.upsert({
        where: composite,
        create: {
          providerKey: identity.providerKey,
          discoverySourceId: sourceId,
          identityVersion: identity.identityVersion,
          provisionalKey: identity.provisionalKey,
          status,
          observedInBaseline,
          firstObservedAt: classified.trustedPublishedAt ?? now,
          lastObservedAt: now,
          observationCount: 1,
          trustedPublishedAt: classified.trustedPublishedAt,
          dateProvenance: classified.dateProvenance,
        },
        // Idempotent re-observation: only advance lastObservedAt. NEVER change
        // status, observedInBaseline, articleId, or terminal fields (governing
        // invariant: a known identity is never revived or re-ingested here).
        update: { lastObservedAt: now },
        select: { id: true },
      });
      candidateId = candidate.id;
      candidateEnsured = true;
    } else if (outcome === "existing-identity") {
      const existing = await tx.crawlCandidate.findUnique({
        where: composite,
        select: { id: true },
      });
      if (existing) {
        // Guarded, no-throw touch of the re-observation timestamp only.
        await tx.crawlCandidate.updateMany({
          where: {
            providerKey: identity.providerKey,
            identityVersion: identity.identityVersion,
            provisionalKey: identity.provisionalKey,
          },
          data: { lastObservedAt: now },
        });
        candidateId = existing.id;
        candidateEnsured = true;
      }
    }
    // policy-rejected / outside-window / review-required create NO candidate:
    // observation-only records the explicit outcome without admitting a
    // permanent identity (rejections/frontier decisions stay re-evaluable).

    if (candidateId && outcome !== "policy-rejected") {
      await tx.urlAlias.upsert({
        where: {
          providerKey_identityVersion_aliasKey: {
            providerKey: identity.providerKey,
            identityVersion: identity.identityVersion,
            aliasKey: identity.provisionalKey,
          },
        },
        create: {
          candidateId,
          providerKey: identity.providerKey,
          identityVersion: identity.identityVersion,
          aliasKey: identity.provisionalKey,
          kind: UrlAliasKind.PROVISIONAL,
        },
        update: { lastSeenAt: now },
      });
      aliasEnsured = true;
    }
  }

  // Every item gets exactly one idempotent observation — the universal, durable
  // per-item outcome record. upsert makes replay + concurrent commits safe.
  await tx.discoveryObservation.upsert({
    where: {
      discoverySourceId_observationKey: {
        discoverySourceId: sourceId,
        observationKey,
      },
    },
    create: {
      discoverySourceId: sourceId,
      candidateId,
      runId,
      identityVersion,
      observationKey,
      ...(positionRank != null ? { positionRank } : {}),
      ...(httpStatus != null ? { httpStatus } : {}),
      observedAt: now,
    },
    update: candidateId ? { candidateId } : {},
  });

  return { candidate: candidateEnsured, alias: aliasEnsured, observation: true };
}

/**
 * Validates the source lease/version and commits the whole page in ONE
 * interactive transaction: revalidate lease → upsert candidates/aliases →
 * persist every observation outcome → advance the checkpoint (guarded). Returns
 * `{ committed: false }` without writing when the source is missing or the lease
 * was lost (before OR during the transaction).
 */
export async function commitDiscoveryPage(
  options: CommitDiscoveryPageOptions,
): Promise<CommitDiscoveryPageResult> {
  const now = options.now ?? new Date();
  const { sourceId, leaseOwner, definitionVersion, page } = options;

  // --- Reads for classification happen BEFORE the transaction. -------------
  const source = await prisma.discoverySource.findUnique({
    where: { id: sourceId },
    select: {
      lifecycleMode: true,
      leaseOwner: true,
      definitionVersion: true,
      watermarkAt: true,
      baselineCompletedAt: true,
    },
  });
  if (!source) return { committed: false, reason: "source-not-found" };
  if (source.leaseOwner !== leaseOwner || source.definitionVersion !== definitionVersion) {
    return { committed: false, reason: "lease-lost" };
  }

  const windowStart =
    options.windowStart !== undefined
      ? options.windowStart
      : (source.watermarkAt ?? source.baselineCompletedAt ?? null);

  const baseContext = {
    lifecycleMode: source.lifecycleMode,
    windowStart,
    resolveProvider: options.resolveProvider,
    deriveIdentity: options.deriveIdentity,
  };

  // Probe pass (empty known set) resolves identities so we can read which are
  // already in the ledger, then the final pass classifies with that knowledge.
  const probe = classifyPage(page.items, { ...baseContext, knownIdentityKeys: new Set() });
  const probeIdentities = probe
    .map((entry) => entry.identity)
    .filter((identity): identity is ClassifiedIdentity => identity != null);
  const knownIdentityKeys = await loadKnownIdentityKeys(probeIdentities);

  const classified = classifyPage(page.items, { ...baseContext, knownIdentityKeys });

  // Deduplicate identical identities within the page: one observation key ⇒ one
  // write (converges on a single candidate/observation regardless of dupes).
  const outcomes = emptyOutcomeCounts();
  const seen = new Set<string>();
  const uniqueItems: ClassifiedPageItem[] = [];
  for (const entry of classified) {
    outcomes[entry.outcome] += 1;
    if (seen.has(entry.observationKey)) continue;
    seen.add(entry.observationKey);
    uniqueItems.push(entry);
  }

  const checkpoint = {
    cursor: page.continuation ? (page.continuation.cursor ?? null) : null,
    page: page.continuation ? (page.continuation.page ?? null) : null,
  };
  const validatorVersion = page.validators?.validatorVersion;

  // --- Single transaction: writes + lease revalidation only. ---------------
  try {
    const tally = await prisma.$transaction(async (tx) => {
      // Re-read the source inside the tx so a lease/version lost before any
      // write aborts without touching the ledger.
      const current = await tx.discoverySource.findUnique({
        where: { id: sourceId },
        select: { leaseOwner: true, definitionVersion: true },
      });
      if (
        !current ||
        current.leaseOwner !== leaseOwner ||
        current.definitionVersion !== definitionVersion
      ) {
        throw new LeaseLostError();
      }

      let candidatesUpserted = 0;
      let aliasesUpserted = 0;
      let observationsUpserted = 0;

      for (let index = 0; index < uniqueItems.length; index += 1) {
        const result = await commitClassifiedItem(tx, sourceId, options.runId, now, uniqueItems[index]);
        if (result.candidate) candidatesUpserted += 1;
        if (result.alias) aliasesUpserted += 1;
        if (result.observation) observationsUpserted += 1;
        await options.debugHooks?.afterItemWrite?.(index, tx);
      }

      await options.debugHooks?.beforeCheckpoint?.(tx);

      // Guarded checkpoint advance: succeeds ONLY while we still own the lease at
      // the recorded definition version. A zero-row update means the lease was
      // stolen mid-commit → abort and roll back every write above.
      const advanceData: Prisma.DiscoverySourceUpdateManyMutationInput = {
        checkpointCursor: checkpoint.cursor,
        checkpointPage: checkpoint.page,
        updatedAt: now,
        ...(validatorVersion ? { validatorVersion } : {}),
      };
      const advanced = await tx.discoverySource.updateMany({
        where: { id: sourceId, leaseOwner, definitionVersion },
        data: advanceData,
      });
      if (advanced.count === 0) throw new LeaseLostError();

      return { candidatesUpserted, aliasesUpserted, observationsUpserted };
    });

    return {
      committed: true,
      outcomes,
      itemsCommitted: uniqueItems.length,
      candidatesUpserted: tally.candidatesUpserted,
      aliasesUpserted: tally.aliasesUpserted,
      observationsUpserted: tally.observationsUpserted,
      checkpoint,
      boundaryReached: page.boundaryReached,
    };
  } catch (error) {
    if (error instanceof LeaseLostError) return { committed: false, reason: "lease-lost" };
    throw error;
  }
}

// Re-export the pure classification surface so callers import one module.
export {
  classifyPage,
  identityCompositeKey,
  pageItemFromDiscoveredUrl,
} from "./classify";
export type {
  ClassifiedIdentity,
  ClassifiedPageItem,
  DiscoveryPageItem,
  DiscoveryPageResult,
  PageClassificationContext,
  PageItemOutcomeKind,
  PolicyRejectionReason,
} from "./classify";
