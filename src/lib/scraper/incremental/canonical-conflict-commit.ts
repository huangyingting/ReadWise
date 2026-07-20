/**
 * THIN, guarded persistence that RESOLVES one canonical-identity conflict onto an
 * operator-selected surviving public Article (issue #1104, Phase 3.5).
 *
 * The pure DECISION (legality + idempotency) lives in
 * `canonical-conflict-policy.ts`; the contested Article ids are computed
 * reads-before-tx by `canonical-conflict-query.ts`. This module owns only the
 * atomic, concurrency-safe effects, applied in the ORDER the issue requires
 * (AC1/AC4):
 *
 *   1. Claim the conflict: guarded `updateMany` OPEN → RESOLVED (a zero-row
 *      result means a concurrent operator won → roll back).
 *   2. Migrate/retain dependent data per the DOCUMENTED rule (below).
 *   3. Archive every loser Article out of public feeds (governance state, NEVER
 *      deleted) + a ContentReview audit row — so exactly ONE public identity
 *      owner remains, with all reader/learning data preserved.
 *   4. ONLY THEN populate the unique public identity key: upsert the surviving
 *      identity's CrawlCandidate (claiming `@@unique([providerKey, canonicalKey])`)
 *      and attach a CANONICAL UrlAlias + fold any challenger candidate history.
 *
 * DEPENDENT-DATA RULE (requirement #2 — "migrate OR deliberately retain"): by
 * DEFAULT (opt-in flag absent/false) losers are ARCHIVED, never deleted, so BOTH
 * content-position-derived data (translations, vocabulary, quiz, speech, tags,
 * grammar, processing steps — kept on each Article) AND article-level reader data
 * (highlights, reading progress, lists, mastery, quiz attempts, pronunciation,
 * tutor messages, difficulty feedback) are RETAINED intact. Nothing is erased; the
 * survivor keeps its own data and becomes the sole public identity owner.
 *
 * When the operator OPTS IN (`migrateReaderData: true`, issue #1134), the losers'
 * article-level reader data is additionally RE-POINTED onto the survivor inside the
 * same transaction, resolving every `@@unique` collision by the documented rule
 * (see `canonical-conflict-migrate.ts`) — highlights are re-anchored onto the
 * survivor's current content, unreliable ones are skipped (left on the loser). The
 * migration is atomic with the archive + identity claim and returns COUNTS only.
 *
 * CONCURRENCY (mirrors `final-identity-commit.ts`): reads-before-tx, a single
 * interactive `$transaction`, guarded `updateMany`, idempotent `upsert` — and a
 * STANDALONE convergence wrapper that retries the identity claim on the canonical
 * `@@unique` slot (P2002 is NEVER caught inside the tx).
 *
 * PRIVACY: every persisted/returned value is a sanitized id, versioned key, count,
 * timestamp, or reason CATEGORY — never a URL, body, secret, or article content.
 */
import { ArticleStatus, CrawlCandidateStatus, Prisma, UrlAliasKind } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { stripTags } from "@/lib/scraper/extract";

import type { DeriveReaderText } from "./annotation-migrator";
import {
  CONFLICT_LOSER_GOVERNANCE_ACTION,
  CONFLICT_LOSER_TERMINAL_REASON,
  CONFLICT_SURVIVOR_TERMINAL_REASON,
  decideConflictResolution,
  type ConflictResolveIllegalReason,
  type ConflictResolveNoopReason,
} from "./canonical-conflict-policy";
import {
  migrateReaderDataInTx,
  type ReaderDataMigrationSummary,
} from "./canonical-conflict-migrate";
import { resolveConflictParticipants } from "./canonical-conflict-query";

/** Bounded retries for convergence-after-conflict on the canonical unique slot. */
const MAX_CONVERGENCE_RETRIES = 5;

const CONFLICT_SELECT = {
  id: true,
  providerKey: true,
  identityVersion: true,
  canonicalKey: true,
  challengerKey: true,
  incumbentCandidateId: true,
  status: true,
} satisfies Prisma.CanonicalConflictSelect;

type ConflictRow = Prisma.CanonicalConflictGetPayload<{ select: typeof CONFLICT_SELECT }>;

/** Outcome of {@link resolveCanonicalConflict} (route maps failures to HTTP status). */
export type ConflictResolveOutcome =
  | {
      ok: true;
      kind: "applied";
      conflictId: string;
      survivingArticleId: string;
      loserArticleIds: string[];
      survivorCandidateId: string;
      /** Present ONLY when `migrateReaderData` was requested (issue #1134). Counts only. */
      migration?: ReaderDataMigrationSummary;
    }
  | {
      ok: true;
      kind: "noop";
      conflictId: string;
      reason: ConflictResolveNoopReason;
      status: ConflictRow["status"];
    }
  | { ok: false; reason: "not-found"; conflictId: string }
  | {
      ok: false;
      reason: "illegal";
      conflictId: string;
      illegal: ConflictResolveIllegalReason;
      status: ConflictRow["status"];
    }
  | { ok: false; reason: "stale"; conflictId: string; status: ConflictRow["status"] };

/** Internal signal: the OPEN-conflict guard matched zero rows → roll back. */
class ConflictRaceError extends Error {
  constructor() {
    super("canonical conflict changed concurrently during resolution");
    this.name = "ConflictRaceError";
  }
}

/** True when a thrown error is a unique conflict on the candidate canonical slot. */
function isCanonicalUniqueConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  const asText = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return asText.includes("canonicalKey") || asText.includes("provisionalKey");
}

type ResolveParams = {
  conflictId: string;
  survivingArticleId: string;
  /** Operator user id recorded as `resolvedBy` and on the ContentReview rows. */
  resolvedBy: string;
  /**
   * OPT-IN (issue #1134): when true, actively re-point the losers' article-level
   * reader/learning data onto the survivor (collision-safe). Default false keeps
   * #1104's retain-on-loser behavior byte-for-byte.
   */
  migrateReaderData?: boolean;
  now?: Date;
};

/** Injectable seams (boundary rule: scraper cannot import `@/lib/content-pipeline`). */
type ResolveDeps = {
  /**
   * HTML → Reader plain text for highlight re-anchoring during an opt-in migration.
   * The route supplies `articleHtmlToReaderText`; the module default is the
   * in-boundary {@link stripTags}.
   */
  deriveReaderText?: DeriveReaderText;
};

/** Options threaded into the transaction to drive the opt-in reader-data migration. */
type MigrateOptions = {
  migrateReaderData: boolean;
  deriveReaderText: DeriveReaderText;
};

/**
 * Resolves ONE canonical conflict onto the operator's chosen survivor. Reads the
 * conflict + its contested public Article ids, asks the pure policy for the
 * decision, and (only for an `apply`) runs the guarded, convergence-wrapped
 * transaction. A concurrently-resolved conflict returns an idempotent `noop`
 * (already-resolved) or `stale`; the winner still owns exactly one public
 * identity key (AC4).
 */
export async function resolveCanonicalConflict(
  params: ResolveParams,
  deps: ResolveDeps = {},
): Promise<ConflictResolveOutcome> {
  const { conflictId, survivingArticleId, resolvedBy } = params;
  const now = params.now ?? new Date();
  const migrate: MigrateOptions = {
    migrateReaderData: params.migrateReaderData ?? false,
    deriveReaderText: deps.deriveReaderText ?? stripTags,
  };

  const conflict = await prisma.canonicalConflict.findUnique({
    where: { id: conflictId },
    select: CONFLICT_SELECT,
  });
  if (!conflict) return { ok: false, reason: "not-found", conflictId };

  const participantArticleIds = await resolveConflictParticipants(conflict);
  const decision = decideConflictResolution({
    status: conflict.status,
    survivingArticleId,
    participantArticleIds,
  });

  if (decision.kind === "illegal") {
    return { ok: false, reason: "illegal", conflictId, illegal: decision.reason, status: decision.status };
  }
  if (decision.kind === "noop") {
    return { ok: true, kind: "noop", conflictId, reason: decision.reason, status: decision.status };
  }

  return convergeResolve(conflict, survivingArticleId, decision.loserArticleIds, resolvedBy, now, migrate);
}

/** Standalone convergence wrapper: retry the identity claim on a canonical-slot race. */
async function convergeResolve(
  conflict: ConflictRow,
  survivingArticleId: string,
  loserArticleIds: string[],
  resolvedBy: string,
  now: Date,
  migrate: MigrateOptions,
): Promise<ConflictResolveOutcome> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_CONVERGENCE_RETRIES; attempt += 1) {
    try {
      return await runResolveTx(conflict, survivingArticleId, loserArticleIds, resolvedBy, now, migrate);
    } catch (error) {
      if (error instanceof ConflictRaceError) {
        return afterRace(conflict.id);
      }
      if (isCanonicalUniqueConflict(error) && attempt < MAX_CONVERGENCE_RETRIES) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new Error("canonical conflict resolution did not converge");
}

/** Re-reads a concurrently-changed conflict and maps it to a noop/stale outcome. */
async function afterRace(conflictId: string): Promise<ConflictResolveOutcome> {
  const fresh = await prisma.canonicalConflict.findUnique({
    where: { id: conflictId },
    select: { status: true },
  });
  if (!fresh) return { ok: false, reason: "not-found", conflictId };
  if (fresh.status === "RESOLVED") {
    return { ok: true, kind: "noop", conflictId, reason: "already-resolved", status: fresh.status };
  }
  if (fresh.status === "DISMISSED") {
    return { ok: true, kind: "noop", conflictId, reason: "already-dismissed", status: fresh.status };
  }
  return { ok: false, reason: "stale", conflictId, status: fresh.status };
}

async function runResolveTx(
  conflict: ConflictRow,
  survivingArticleId: string,
  loserArticleIds: string[],
  resolvedBy: string,
  now: Date,
  migrate: MigrateOptions,
): Promise<ConflictResolveOutcome> {
  return prisma.$transaction(async (tx) => {
    // (1) Claim the conflict under the lock — only ONE resolver can win.
    const claimed = await tx.canonicalConflict.updateMany({
      where: { id: conflict.id, status: "OPEN" },
      data: { status: "RESOLVED", resolvedAt: now, resolvedBy, updatedAt: now },
    });
    if (claimed.count === 0) throw new ConflictRaceError();

    // Re-validate the survivor still exists as a public Article under the lock.
    const survivor = await tx.article.findUnique({
      where: { id: survivingArticleId },
      select: { id: true },
    });
    if (!survivor) throw new ConflictRaceError();

    // (2) OPT-IN (#1134): re-point the losers' reader/learning data onto the
    // survivor (collision-safe) BEFORE archiving, inside this same transaction.
    let migration: ReaderDataMigrationSummary | undefined;
    if (migrate.migrateReaderData && loserArticleIds.length > 0) {
      migration = await migrateReaderDataInTx(tx, {
        loserArticleIds,
        survivingArticleId,
        deriveReaderText: migrate.deriveReaderText,
        now,
      });
    }

    // (3) Archive every loser out of public feeds (data RETAINED, never deleted).
    for (const loserId of loserArticleIds) {
      await archiveLoserInTx(tx, loserId, resolvedBy, now);
    }

    // (4) Populate the unique public identity key + attach aliases/history.
    const survivorCandidateId = await claimSurvivorIdentityInTx(tx, {
      providerKey: conflict.providerKey,
      identityVersion: conflict.identityVersion,
      canonicalKey: conflict.canonicalKey,
      articleId: survivingArticleId,
      now,
    });
    await attachCanonicalAliasInTx(tx, {
      candidateId: survivorCandidateId,
      providerKey: conflict.providerKey,
      identityVersion: conflict.identityVersion,
      aliasKey: conflict.canonicalKey,
      now,
    });
    await foldChallengerInTx(tx, {
      providerKey: conflict.providerKey,
      identityVersion: conflict.identityVersion,
      challengerKey: conflict.challengerKey,
      survivorCandidateId,
      now,
    });

    return {
      ok: true as const,
      kind: "applied" as const,
      conflictId: conflict.id,
      survivingArticleId,
      loserArticleIds,
      survivorCandidateId,
      ...(migration ? { migration } : {}),
    };
  });
}

/**
 * Archives ONE loser Article out of public feeds using the EXISTING content
 * governance semantics (`takedownState = archived`; a PUBLISHED Article is forced
 * to DRAFT) and records a ContentReview audit row. Nothing is deleted, so all
 * dependent reader/learning data is retained. A vanished Article (concurrent
 * delete) is a safe no-op.
 */
async function archiveLoserInTx(
  tx: Prisma.TransactionClient,
  loserId: string,
  reviewerId: string,
  now: Date,
): Promise<void> {
  const existing = await tx.article.findUnique({
    where: { id: loserId },
    select: { id: true, takedownState: true, status: true },
  });
  if (!existing) return;

  const previousState = existing.takedownState ?? "active";
  const nextStatus =
    existing.status === ArticleStatus.PUBLISHED ? ArticleStatus.DRAFT : existing.status;

  await tx.article.update({
    where: { id: loserId },
    data: { takedownState: "archived", status: nextStatus, updatedAt: now },
  });
  await tx.contentReview.create({
    data: {
      articleId: loserId,
      reviewerId,
      action: CONFLICT_LOSER_GOVERNANCE_ACTION,
      note: null,
      changes: {
        takedownState: { from: previousState, to: "archived" },
        ...(existing.status !== nextStatus
          ? { status: { from: existing.status, to: nextStatus } }
          : {}),
      },
    },
  });
}

/**
 * Populates the unique public identity key: finds (or creates) the CrawlCandidate
 * that owns the surviving identity, links it to the survivor Article, and marks it
 * an INGESTED baseline-known identity so normal discovery never re-ingests it. A
 * concurrent claim throws P2002 on the canonical/provisional unique slot, which
 * the standalone wrapper converges. Returns the survivor candidate id.
 */
async function claimSurvivorIdentityInTx(
  tx: Prisma.TransactionClient,
  params: {
    providerKey: string;
    identityVersion: number;
    canonicalKey: string;
    articleId: string;
    now: Date;
  },
): Promise<string> {
  const { providerKey, identityVersion, canonicalKey, articleId, now } = params;

  const existing = await tx.crawlCandidate.findFirst({
    where: {
      providerKey,
      identityVersion,
      OR: [{ canonicalKey }, { provisionalKey: canonicalKey }],
    },
    select: { id: true },
  });

  const shared = {
    canonicalKey,
    articleId,
    status: CrawlCandidateStatus.INGESTED,
    observedInBaseline: true,
    terminalReason: CONFLICT_SURVIVOR_TERMINAL_REASON,
    terminalAt: now,
    ingestedAt: now,
    updatedAt: now,
  };

  if (existing) {
    await tx.crawlCandidate.update({ where: { id: existing.id }, data: shared });
    return existing.id;
  }

  const created = await tx.crawlCandidate.create({
    data: {
      providerKey,
      identityVersion,
      provisionalKey: canonicalKey,
      firstObservedAt: now,
      lastObservedAt: now,
      ...shared,
    },
    select: { id: true },
  });
  return created.id;
}

/** Attaches (idempotently) a CANONICAL alias for the surviving identity. */
async function attachCanonicalAliasInTx(
  tx: Prisma.TransactionClient,
  params: {
    candidateId: string;
    providerKey: string;
    identityVersion: number;
    aliasKey: string;
    now: Date;
  },
): Promise<void> {
  const { candidateId, providerKey, identityVersion, aliasKey, now } = params;
  await tx.urlAlias.upsert({
    where: {
      providerKey_identityVersion_aliasKey: { providerKey, identityVersion, aliasKey },
    },
    create: {
      candidateId,
      providerKey,
      identityVersion,
      aliasKey,
      kind: UrlAliasKind.CANONICAL,
      firstSeenAt: now,
      lastSeenAt: now,
    },
    update: { candidateId, kind: UrlAliasKind.CANONICAL, lastSeenAt: now },
  });
}

/**
 * Folds a distinct challenger candidate (a runtime conflict's parked, no-Article
 * identity) onto the survivor: marks it DUPLICATE_ALIAS + terminal so its history
 * is preserved (never erased) and it is never independently ingested. Skips the
 * baseline case where the challenger IS the survivor identity, and never touches a
 * candidate that already links an Article (governing invariant).
 */
async function foldChallengerInTx(
  tx: Prisma.TransactionClient,
  params: {
    providerKey: string;
    identityVersion: number;
    challengerKey: string;
    survivorCandidateId: string;
    now: Date;
  },
): Promise<void> {
  const { providerKey, identityVersion, challengerKey, survivorCandidateId, now } = params;
  const challenger = await tx.crawlCandidate.findFirst({
    where: { providerKey, identityVersion, provisionalKey: challengerKey, articleId: null },
    select: { id: true },
  });
  if (!challenger || challenger.id === survivorCandidateId) return;

  await tx.crawlCandidate.updateMany({
    where: { id: challenger.id, articleId: null },
    data: {
      status: CrawlCandidateStatus.DUPLICATE_ALIAS,
      terminalReason: CONFLICT_LOSER_TERMINAL_REASON,
      terminalAt: now,
      updatedAt: now,
    },
  });
}
