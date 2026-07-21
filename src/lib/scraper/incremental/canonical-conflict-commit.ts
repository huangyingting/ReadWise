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
 * TYPE A vs TYPE B (issue #1135): this module resolves BOTH conflict kinds through
 * the ONE `resolveCanonicalConflict` entry point, detected from the conflict's
 * `incumbentCandidateId` (`null` ⇒ baseline Type A; SET ⇒ runtime Type B):
 *   - Type A (baseline) — the operator names the surviving public Article
 *     (`survivingArticleId`); losers are archived, the survivor claims the slot.
 *   - Type B (runtime) — the operator makes an explicit incumbent-vs-challenger
 *     decision (`canonical`). Keeping the incumbent folds the challenger as a
 *     DUPLICATE; promoting the challenger transfers the canonical claim onto it,
 *     folds the incumbent's aliases, and archives (retains) the incumbent's
 *     produced Article. A body whose shape does not match the conflict's kind is
 *     rejected `wrong-conflict-type` (never a silent wrong-type write).
 *
 * PRIVACY: every persisted/returned value is a sanitized id, versioned key, count,
 * timestamp, or reason CATEGORY — never a URL, body, secret, or article content.
 */
import {
  ArticleStatus,
  CanonicalConflictStatus,
  CrawlCandidateStatus,
  Prisma,
  UrlAliasKind,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { stripTags } from "@/lib/scraper/extract";

import type { DeriveReaderText } from "./annotation-migrator";
import {
  CONFLICT_LOSER_GOVERNANCE_ACTION,
  CONFLICT_LOSER_TERMINAL_REASON,
  CONFLICT_SURVIVOR_TERMINAL_REASON,
  TYPE_B_CONFLICT_LOSER_TERMINAL_REASON,
  TYPE_B_INCUMBENT_ARCHIVED_ACTION,
  classifyConflictKind,
  decideConflictResolution,
  decideTypeBResolution,
  type ConflictResolveIllegalReason,
  type ConflictResolveNoopReason,
  type ConflictResolveTypeBIllegalReason,
  type TypeBCanonicalChoice,
} from "./canonical-conflict-policy";
import {
  migrateReaderDataInTx,
  type ReaderDataMigrationSummary,
} from "./canonical-conflict-migrate";
import { resolveConflictParticipants } from "./canonical-conflict-query";
import { foldLoserInTx } from "./final-identity-commit";

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
      /** A runtime (Type B) conflict resolved by an explicit canonical decision (#1135). */
      ok: true;
      kind: "applied-type-b";
      conflictId: string;
      /** Which candidate the operator declared canonical. */
      canonical: TypeBCanonicalChoice;
      /** The candidate that keeps / receives the canonical claim. */
      winnerCandidateId: string;
      /** The folded candidate (challenger when incumbent wins; incumbent when challenger wins). */
      loserCandidateId: string | null;
      /** The incumbent's produced Article archived when the challenger was promoted, else null. */
      archivedArticleId: string | null;
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
      illegal: ConflictResolveIllegalReason | ConflictResolveTypeBIllegalReason;
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
  /**
   * TYPE A (baseline): the operator-selected surviving public Article id. Exactly
   * one of `survivingArticleId` / `canonical` is supplied, validated against the
   * conflict's detected kind (a mismatch is rejected `wrong-conflict-type`).
   */
  survivingArticleId?: string;
  /** TYPE B (runtime): the explicit incumbent-vs-challenger canonical decision (#1135). */
  canonical?: TypeBCanonicalChoice;
  /** Operator user id recorded as `resolvedBy` and on the ContentReview rows. */
  resolvedBy: string;
  /**
   * OPT-IN (issue #1134, Type A only): when true, actively re-point the losers'
   * article-level reader/learning data onto the survivor (collision-safe). Default
   * false keeps #1104's retain-on-loser behavior byte-for-byte.
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
 * Resolves ONE canonical conflict. Detects the conflict KIND from its
 * `incumbentCandidateId` and dispatches:
 *   - TYPE A (baseline, `incumbentCandidateId = null`): resolve onto the operator's
 *     chosen surviving public Article — reads the conflict + its contested public
 *     Article ids, asks {@link decideConflictResolution}, and runs the guarded,
 *     convergence-wrapped transaction. Behavior is byte-identical to #1104/#1134.
 *   - TYPE B (runtime, `incumbentCandidateId` SET): apply the explicit
 *     incumbent-vs-challenger `canonical` decision (issue #1135).
 * A body whose selector does not match the conflict's kind is rejected
 * `wrong-conflict-type`; a concurrently-resolved conflict returns an idempotent
 * `noop` / `stale`. Exactly one public identity owner always remains (AC4).
 */
export async function resolveCanonicalConflict(
  params: ResolveParams,
  deps: ResolveDeps = {},
): Promise<ConflictResolveOutcome> {
  const { conflictId, resolvedBy } = params;
  const now = params.now ?? new Date();

  const conflict = await prisma.canonicalConflict.findUnique({
    where: { id: conflictId },
    select: CONFLICT_SELECT,
  });
  if (!conflict) return { ok: false, reason: "not-found", conflictId };

  if (classifyConflictKind(conflict.incumbentCandidateId) === "type-b") {
    return resolveTypeBConflict(conflict, params, resolvedBy, now);
  }

  // TYPE A — require the Type-A selector shape (survivingArticleId, no canonical).
  if (params.survivingArticleId === undefined || params.canonical !== undefined) {
    return { ok: false, reason: "illegal", conflictId, illegal: "wrong-conflict-type", status: conflict.status };
  }
  const survivingArticleId = params.survivingArticleId;
  const migrate: MigrateOptions = {
    migrateReaderData: params.migrateReaderData ?? false,
    deriveReaderText: deps.deriveReaderText ?? stripTags,
  };

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

  return convergeConflictTx(conflict.id, () =>
    runResolveTx(conflict, survivingArticleId, decision.loserArticleIds, resolvedBy, now, migrate),
  );
}

/**
 * Resolves a runtime (Type B) conflict from an explicit incumbent-vs-challenger
 * decision (issue #1135). Requires the Type-B selector shape (`canonical`, no
 * `survivingArticleId`); reads the incumbent + parked challenger candidates
 * OUTSIDE the tx, asks {@link decideTypeBResolution}, and — only for an `apply` —
 * runs the guarded, convergence-wrapped transaction.
 */
async function resolveTypeBConflict(
  conflict: ConflictRow,
  params: ResolveParams,
  resolvedBy: string,
  now: Date,
): Promise<ConflictResolveOutcome> {
  const conflictId = conflict.id;
  if (params.canonical === undefined || params.survivingArticleId !== undefined) {
    return { ok: false, reason: "illegal", conflictId, illegal: "wrong-conflict-type", status: conflict.status };
  }
  const canonical = params.canonical;

  // Reads-before-tx: does the incumbent still exist, and which parked challenger
  // candidate matches the conflict's challengerKey? (`prisma` client — not the tx.)
  const [incumbent, challenger] = await Promise.all([
    conflict.incumbentCandidateId
      ? prisma.crawlCandidate.findUnique({
          where: { id: conflict.incumbentCandidateId },
          select: { id: true },
        })
      : Promise.resolve(null),
    prisma.crawlCandidate.findUnique({
      where: {
        providerKey_identityVersion_provisionalKey: {
          providerKey: conflict.providerKey,
          identityVersion: conflict.identityVersion,
          provisionalKey: conflict.challengerKey,
        },
      },
      select: { id: true },
    }),
  ]);

  const decision = decideTypeBResolution({
    status: conflict.status,
    canonical,
    incumbentCandidateId: conflict.incumbentCandidateId,
    incumbentExists: incumbent != null,
    challengerCandidateId: challenger?.id ?? null,
  });

  if (decision.kind === "illegal") {
    return { ok: false, reason: "illegal", conflictId, illegal: decision.reason, status: decision.status };
  }
  if (decision.kind === "noop") {
    return { ok: true, kind: "noop", conflictId, reason: decision.reason, status: decision.status };
  }

  // `incumbentCandidateId` is non-null for a Type-B conflict (guarded by the policy).
  const incumbentCandidateId = conflict.incumbentCandidateId as string;
  return convergeConflictTx(conflict.id, () =>
    runTypeBResolveTx(conflict, canonical, incumbentCandidateId, resolvedBy, now),
  );
}

/**
 * Standalone convergence wrapper shared by Type-A and Type-B resolution: retries
 * the guarded transaction on a canonical-slot `@@unique` race (P2002 is NEVER
 * caught inside the tx) and maps the OPEN-guard loss to an idempotent noop/stale.
 */
async function convergeConflictTx(
  conflictId: string,
  run: () => Promise<ConflictResolveOutcome>,
): Promise<ConflictResolveOutcome> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_CONVERGENCE_RETRIES; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (error instanceof ConflictRaceError) {
        return afterRace(conflictId);
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
  if (fresh.status === CanonicalConflictStatus.RESOLVED) {
    return { ok: true, kind: "noop", conflictId, reason: "already-resolved", status: fresh.status };
  }
  if (fresh.status === CanonicalConflictStatus.DISMISSED) {
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
      where: { id: conflict.id, status: CanonicalConflictStatus.OPEN },
      data: { status: CanonicalConflictStatus.RESOLVED, resolvedAt: now, resolvedBy, updatedAt: now },
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
 * Applies an explicit incumbent-vs-challenger decision to a runtime (Type B)
 * conflict inside ONE guarded transaction (issue #1135), in this ORDER:
 *
 *   1. Claim the conflict: guarded `updateMany` OPEN → RESOLVED (zero rows ⇒ a
 *      concurrent operator won → roll back).
 *   2. Re-read the incumbent + parked challenger candidates under the lock (AC4).
 *   3a. `canonical === "incumbent"` — the incumbent KEEPS its canonical claim +
 *       Article untouched; the challenger is folded as a DUPLICATE onto it
 *       (`foldLoserInTx`). A vanished challenger is a safe no-op.
 *   3b. `canonical === "challenger"` — PROMOTE the challenger: fold the incumbent's
 *       aliases onto it (freeing the incumbent's canonical slot), transfer the
 *       canonical claim to the challenger (P2002 ⇒ standalone convergence), re-attach
 *       the CANONICAL alias, and archive + RETAIN the incumbent's produced Article.
 *
 * Sequential awaits only (never `Promise.all` on the tx client); P2002 is never
 * caught inside the tx (it rolls back to the convergence wrapper).
 */
async function runTypeBResolveTx(
  conflict: ConflictRow,
  canonical: TypeBCanonicalChoice,
  incumbentCandidateId: string,
  resolvedBy: string,
  now: Date,
): Promise<ConflictResolveOutcome> {
  return prisma.$transaction(async (tx) => {
    // (1) Claim the conflict under the lock — only ONE resolver can win.
    const claimed = await tx.canonicalConflict.updateMany({
      where: { id: conflict.id, status: CanonicalConflictStatus.OPEN },
      data: { status: CanonicalConflictStatus.RESOLVED, resolvedAt: now, resolvedBy, updatedAt: now },
    });
    if (claimed.count === 0) throw new ConflictRaceError();

    // (2) Re-read the incumbent + parked challenger under the lock.
    const incumbent = await tx.crawlCandidate.findUnique({
      where: { id: incumbentCandidateId },
      select: { id: true, articleId: true },
    });
    if (!incumbent) throw new ConflictRaceError();

    const challenger = await tx.crawlCandidate.findUnique({
      where: {
        providerKey_identityVersion_provisionalKey: {
          providerKey: conflict.providerKey,
          identityVersion: conflict.identityVersion,
          provisionalKey: conflict.challengerKey,
        },
      },
      select: { id: true },
    });

    if (canonical === "incumbent") {
      // (3a) Incumbent stays canonical; fold the challenger as a DUPLICATE onto it.
      let loserCandidateId: string | null = null;
      if (challenger && challenger.id !== incumbent.id) {
        await foldLoserInTx(tx, challenger.id, incumbent.id, now, TYPE_B_CONFLICT_LOSER_TERMINAL_REASON);
        loserCandidateId = challenger.id;
      }
      return {
        ok: true as const,
        kind: "applied-type-b" as const,
        conflictId: conflict.id,
        canonical,
        winnerCandidateId: incumbent.id,
        loserCandidateId,
        archivedArticleId: null,
      };
    }

    // (3b) Promote the challenger. The parked challenger must still exist (the
    // policy guaranteed it reads-before-tx; re-validate under the lock).
    if (!challenger || challenger.id === incumbent.id) throw new ConflictRaceError();

    // Fold the incumbent onto the challenger: re-points the incumbent's aliases
    // (relabelled DUPLICATE) + observations onto the challenger, marks the
    // incumbent DUPLICATE_ALIAS terminal, cancels its ingest jobs, and CLEARS its
    // canonical slot (freeing it before the transfer below).
    await foldLoserInTx(tx, incumbent.id, challenger.id, now, TYPE_B_CONFLICT_LOSER_TERMINAL_REASON);

    // Transfer the canonical claim to the challenger + return it to the normal
    // candidate pipeline (its produced Article is a separate, explicit ingest —
    // this flow only moves the CLAIM). A concurrent claim throws P2002 → rollback
    // → the standalone wrapper re-queries + converges.
    await tx.crawlCandidate.update({
      where: { id: challenger.id },
      data: {
        canonicalKey: conflict.canonicalKey,
        status: CrawlCandidateStatus.DISCOVERED,
        terminalReason: null,
        terminalAt: null,
        updatedAt: now,
      },
    });

    // The fold relabelled the incumbent's canonical alias DUPLICATE; upsert it back
    // to a CANONICAL alias owned by the challenger.
    await attachCanonicalAliasInTx(tx, {
      candidateId: challenger.id,
      providerKey: conflict.providerKey,
      identityVersion: conflict.identityVersion,
      aliasKey: conflict.canonicalKey,
      now,
    });

    // Apply loser-governance to the incumbent's produced Article if one exists
    // (archive out of public feeds; data RETAINED, never deleted).
    let archivedArticleId: string | null = null;
    if (incumbent.articleId) {
      await archiveLoserInTx(tx, incumbent.articleId, resolvedBy, now, TYPE_B_INCUMBENT_ARCHIVED_ACTION);
      archivedArticleId = incumbent.articleId;
    }

    return {
      ok: true as const,
      kind: "applied-type-b" as const,
      conflictId: conflict.id,
      canonical,
      winnerCandidateId: challenger.id,
      loserCandidateId: incumbent.id,
      archivedArticleId,
    };
  });
}

/**
 * Archives ONE loser Article out of public feeds using the EXISTING content
 * governance semantics (`takedownState = archived`; a PUBLISHED Article is forced
 * to DRAFT) and records a ContentReview audit row. Nothing is deleted, so all
 * dependent reader/learning data is retained. A vanished Article (concurrent
 * delete) is a safe no-op. `action` tags the ContentReview row so a Type-A loser
 * and a Type-B promoted-over incumbent are distinguishable in the audit history.
 */
async function archiveLoserInTx(
  tx: Prisma.TransactionClient,
  loserId: string,
  reviewerId: string,
  now: Date,
  action: string = CONFLICT_LOSER_GOVERNANCE_ACTION,
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
      action,
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
