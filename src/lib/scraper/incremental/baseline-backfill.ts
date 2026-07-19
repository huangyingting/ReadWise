/**
 * Baseline seed of the incremental discovery ledger (issue #1083, Phase 1.3).
 *
 * Initializes the candidate ledger from EXISTING public scraped Articles WITHOUT
 * any network fetch and without merging historical data. For every eligible
 * public provider Article we derive its provisional identity (via the PURE
 * #1082 module), then:
 *
 *   - a UNIQUE identity (exactly one Article) becomes one permanent
 *     `CrawlCandidate` (status `INGESTED`, `observedInBaseline = true`,
 *     `articleId` set, terminal existing-article reason) plus one PROVISIONAL
 *     `UrlAlias`. `observedInBaseline = true` is the governing invariant: a
 *     known, pre-existing identity that normal incremental runs must NEVER
 *     auto-refetch, update, recreate, or revive.
 *   - a CONFLICT identity (two or more Articles normalize to one identity)
 *     becomes ONE `CanonicalConflict` (status `OPEN`) and NO candidates — we
 *     leave those public keys unset and FAIL CLOSED for that identity ONLY.
 *     Unrelated identities/providers continue normally.
 *
 * Contract:
 *   - No network fetch and no scraper fetch dependency (imports only the pure
 *     url-identity module). Dry-run performs ZERO writes.
 *   - Idempotent / rerun- and interrupt-safe: writes are keyed on the #1081
 *     unique constraints, so reruns converge to identical final counts with no
 *     duplicate candidates, aliases, or conflicts.
 *   - The produced report is METADATA ONLY: Article IDs, a controlled conflict
 *     reason, and counts — never article content, titles, URLs, or private data.
 *
 * Private / user-owned imports are OUTSIDE the selection predicate, so a private
 * copy sharing a `sourceUrl` never occupies the public identity nor blocks a
 * public provider Article (`Article @@unique([sourceUrl, ownerId])` keeps the
 * two rows distinct).
 */
import {
  ArticleSourceType,
  ArticleVisibility,
  CanonicalConflictStatus,
  CrawlCandidateStatus,
  Prisma,
  UrlAliasKind,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  URL_IDENTITY_VERSION,
  UrlIdentityError,
  deriveProvisionalIdentity,
} from "@/lib/scraper/url-identity";

/** Controlled terminal reason stamped on every backfilled baseline candidate. */
export const BASELINE_TERMINAL_REASON = "baseline-existing-article";

/**
 * Controlled reason written on a `CanonicalConflict` when two or more existing
 * public Articles normalize to a single provisional identity during the seed.
 */
export const BASELINE_CONFLICT_REASON = "baseline-duplicate-provisional-identity";

/** Minimal, metadata-only projection of an eligible Article. */
export type BaselineArticleInput = {
  id: string;
  sourceUrl: string | null;
  publishedAt: Date | null;
  createdAt: Date;
};

/** Machine-readable reasons an eligible Article is skipped (metadata only). */
export type BaselineSkipReason =
  | "missing-source-url"
  | "no-registered-provider"
  | "invalid-url"
  | "unsupported-scheme";

/** A single provisional identity together with the Articles that map to it. */
export type BaselineIdentityGroup = {
  providerKey: string;
  identityVersion: number;
  /** Full versioned identity key (`"v1:<sha256hex>"`), never a raw URL. */
  provisionalKey: string;
  /** Article IDs mapping to this identity, in deterministic (input) order. */
  articleIds: string[];
};

/** A skipped Article and its controlled reason. */
export type BaselineSkip = {
  articleId: string;
  reason: BaselineSkipReason;
};

/** Pure classification of eligible Articles into unique/conflict/skipped sets. */
export type BaselineClassification = {
  /** Identities backed by exactly one Article → one candidate each. */
  unique: BaselineIdentityGroup[];
  /** Identities backed by two or more Articles → one conflict, no candidate. */
  conflicts: BaselineIdentityGroup[];
  /** Articles excluded from identity assignment, with a controlled reason. */
  skipped: BaselineSkip[];
};

/** Metadata-only outcome report. Contains NO content, URLs, or private data. */
export type BaselineBackfillReport = {
  dryRun: boolean;
  eligibleArticles: number;
  /** Distinct provisional identities among eligible Articles (unique + conflict). */
  identities: number;
  candidatesCreated: number;
  candidatesExisting: number;
  aliasesCreated: number;
  aliasesExisting: number;
  /** Conflict identities detected (two or more Articles → one identity). */
  conflicts: number;
  conflictsCreated: number;
  conflictsExisting: number;
  /** Count of Articles left with no candidate because their identity conflicts. */
  conflictedArticles: number;
  skipped: BaselineSkip[];
  /** Per-conflict metadata: controlled reason plus the contested Article IDs. */
  conflictDetails: Array<{ reason: string; articleIds: string[] }>;
};

export type BaselineBackfillOptions = {
  /** When true, perform NO writes and invoke NO fetch dependency (report only). */
  dryRun?: boolean;
  /**
   * Optional scope: restrict the seed to these Article IDs (the eligibility
   * predicate still applies on top). Undefined seeds every eligible Article;
   * useful for batched/targeted re-runs. An empty array selects nothing.
   */
  articleIds?: string[];
};

/**
 * Maps the #1082 string version tag (e.g. `"v1"`) to the #1081 numeric
 * `identityVersion` column (e.g. `1`). Throws on an unexpected shape so a
 * malformed version can never silently collapse distinct identities.
 */
export function identityVersionToInt(tag: string): number {
  const parsed = Number.parseInt(tag.replace(/^v/i, ""), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Unrecognized URL identity version tag: ${tag}`);
  }
  return parsed;
}

function groupKey(providerKey: string, identityVersion: number, provisionalKey: string): string {
  return `${providerKey}\u0000${identityVersion}\u0000${provisionalKey}`;
}

/**
 * PURE grouping/classification of eligible Articles by provisional identity.
 *
 * Derives each Article's provisional identity with the #1082 module (no network,
 * no DB), groups by `(providerKey, identityVersion, provisionalKey)`, and splits
 * groups into unique (one Article) and conflict (two or more) sets. Articles
 * with a missing `sourceUrl`, an unparseable/unsupported URL, or no registered
 * provider are recorded in `skipped` with a controlled reason — never assigned
 * an identity (a candidate's `providerKey` is NOT NULL and is never fabricated).
 *
 * Input order determines group member order, so the classification is
 * deterministic for a stable input ordering.
 */
export function classifyBaselineArticles(articles: BaselineArticleInput[]): BaselineClassification {
  const groups = new Map<string, BaselineIdentityGroup>();
  const skipped: BaselineSkip[] = [];

  for (const article of articles) {
    if (!article.sourceUrl) {
      skipped.push({ articleId: article.id, reason: "missing-source-url" });
      continue;
    }

    let identity;
    try {
      identity = deriveProvisionalIdentity(article.sourceUrl);
    } catch (error) {
      if (error instanceof UrlIdentityError && error.code === "unsupported-scheme") {
        skipped.push({ articleId: article.id, reason: "unsupported-scheme" });
      } else {
        // invalid-url (or any other identity failure): never echo the URL.
        skipped.push({ articleId: article.id, reason: "invalid-url" });
      }
      continue;
    }

    if (!identity.providerKey) {
      skipped.push({ articleId: article.id, reason: "no-registered-provider" });
      continue;
    }

    const identityVersion = identityVersionToInt(identity.identityVersion);
    const key = groupKey(identity.providerKey, identityVersion, identity.key);
    const existing = groups.get(key);
    if (existing) {
      existing.articleIds.push(article.id);
    } else {
      groups.set(key, {
        providerKey: identity.providerKey,
        identityVersion,
        provisionalKey: identity.key,
        articleIds: [article.id],
      });
    }
  }

  const unique: BaselineIdentityGroup[] = [];
  const conflicts: BaselineIdentityGroup[] = [];
  for (const group of groups.values()) {
    if (group.articleIds.length === 1) {
      unique.push(group);
    } else {
      conflicts.push(group);
    }
  }

  return { unique, conflicts, skipped };
}

const UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION;
}

/**
 * Loads the metadata-only projection of every eligible public provider Article:
 * `visibility = PUBLIC` AND `ownerId = null` AND `sourceType = SCRAPED`.
 * Private/user imports (`ownerId != null` or `visibility = PRIVATE`) are excluded
 * by construction. A null `sourceUrl` is intentionally NOT filtered in SQL so it
 * is surfaced (skipped + reported) by {@link classifyBaselineArticles} rather
 * than silently hidden. When `articleIds` is provided the same predicate is
 * applied but restricted to those IDs. Ordered by `createdAt` then `id` for a
 * deterministic, reproducible classification.
 */
export async function loadEligibleArticles(
  articleIds?: string[],
): Promise<BaselineArticleInput[]> {
  return prisma.article.findMany({
    where: {
      visibility: ArticleVisibility.PUBLIC,
      ownerId: null,
      sourceType: ArticleSourceType.SCRAPED,
      ...(articleIds ? { id: { in: articleIds } } : {}),
    },
    select: { id: true, sourceUrl: true, publishedAt: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

async function seedAlias(
  group: BaselineIdentityGroup,
  candidateId: string | null,
  dryRun: boolean,
  report: BaselineBackfillReport,
): Promise<void> {
  const existingAlias = await prisma.urlAlias.findUnique({
    where: {
      providerKey_identityVersion_aliasKey: {
        providerKey: group.providerKey,
        identityVersion: group.identityVersion,
        aliasKey: group.provisionalKey,
      },
    },
    select: { id: true },
  });

  if (existingAlias) {
    report.aliasesExisting += 1;
    return;
  }
  if (dryRun) {
    report.aliasesCreated += 1;
    return;
  }
  // Not created if the candidate could not be resolved (should not happen for a
  // unique group on a normal run); a rerun creates it once the candidate exists.
  if (!candidateId) return;

  try {
    await prisma.urlAlias.create({
      data: {
        candidateId,
        providerKey: group.providerKey,
        identityVersion: group.identityVersion,
        aliasKey: group.provisionalKey,
        kind: UrlAliasKind.PROVISIONAL,
      },
    });
    report.aliasesCreated += 1;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    report.aliasesExisting += 1;
  }
}

async function seedUniqueGroup(
  group: BaselineIdentityGroup,
  article: BaselineArticleInput,
  now: Date,
  dryRun: boolean,
  report: BaselineBackfillReport,
): Promise<void> {
  const observedAt = article.publishedAt ?? article.createdAt;

  const existingCandidate = await prisma.crawlCandidate.findUnique({
    where: {
      providerKey_identityVersion_provisionalKey: {
        providerKey: group.providerKey,
        identityVersion: group.identityVersion,
        provisionalKey: group.provisionalKey,
      },
    },
    select: { id: true },
  });

  let candidateId = existingCandidate?.id ?? null;
  if (existingCandidate) {
    report.candidatesExisting += 1;
  } else if (dryRun) {
    report.candidatesCreated += 1;
  } else {
    try {
      const created = await prisma.crawlCandidate.create({
        data: {
          providerKey: group.providerKey,
          identityVersion: group.identityVersion,
          provisionalKey: group.provisionalKey,
          status: CrawlCandidateStatus.INGESTED,
          observedInBaseline: true,
          articleId: article.id,
          firstObservedAt: observedAt,
          lastObservedAt: observedAt,
          observationCount: 1,
          ingestedAt: now,
          terminalReason: BASELINE_TERMINAL_REASON,
          terminalAt: now,
        },
        select: { id: true },
      });
      candidateId = created.id;
      report.candidatesCreated += 1;
    } catch (error) {
      // A concurrent/resumed run may have created it between check and write.
      if (!isUniqueViolation(error)) throw error;
      const raced = await prisma.crawlCandidate.findUnique({
        where: {
          providerKey_identityVersion_provisionalKey: {
            providerKey: group.providerKey,
            identityVersion: group.identityVersion,
            provisionalKey: group.provisionalKey,
          },
        },
        select: { id: true },
      });
      candidateId = raced?.id ?? null;
      report.candidatesExisting += 1;
    }
  }

  await seedAlias(group, candidateId, dryRun, report);
}

async function seedConflictGroup(
  group: BaselineIdentityGroup,
  dryRun: boolean,
  report: BaselineBackfillReport,
): Promise<void> {
  report.conflicts += 1;
  report.conflictedArticles += group.articleIds.length;
  report.conflictDetails.push({
    reason: BASELINE_CONFLICT_REASON,
    articleIds: [...group.articleIds],
  });

  const existingConflict = await prisma.canonicalConflict.findUnique({
    where: {
      providerKey_identityVersion_canonicalKey: {
        providerKey: group.providerKey,
        identityVersion: group.identityVersion,
        canonicalKey: group.provisionalKey,
      },
    },
    select: { id: true },
  });

  if (existingConflict) {
    report.conflictsExisting += 1;
    return;
  }
  if (dryRun) {
    report.conflictsCreated += 1;
    return;
  }

  try {
    await prisma.canonicalConflict.create({
      data: {
        providerKey: group.providerKey,
        identityVersion: group.identityVersion,
        canonicalKey: group.provisionalKey,
        challengerKey: group.provisionalKey,
        status: CanonicalConflictStatus.OPEN,
        reason: BASELINE_CONFLICT_REASON,
      },
    });
    report.conflictsCreated += 1;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    report.conflictsExisting += 1;
  }
}

/**
 * Runs the idempotent baseline seed end-to-end: selects eligible public provider
 * Articles, classifies them by provisional identity, then (unless `dryRun`)
 * writes one baseline candidate + provisional alias per unique identity and one
 * open conflict per contested identity. Returns a metadata-only report.
 */
export async function backfillDiscoveryBaseline(
  options: BaselineBackfillOptions = {},
): Promise<BaselineBackfillReport> {
  const dryRun = options.dryRun ?? false;
  const now = new Date();

  const articles = await loadEligibleArticles(options.articleIds);
  const byId = new Map(articles.map((article) => [article.id, article]));
  const classification = classifyBaselineArticles(articles);

  const report: BaselineBackfillReport = {
    dryRun,
    eligibleArticles: articles.length,
    identities: classification.unique.length + classification.conflicts.length,
    candidatesCreated: 0,
    candidatesExisting: 0,
    aliasesCreated: 0,
    aliasesExisting: 0,
    conflicts: 0,
    conflictsCreated: 0,
    conflictsExisting: 0,
    conflictedArticles: 0,
    skipped: classification.skipped,
    conflictDetails: [],
  };

  // Conflicts are handled BEFORE enforcing any identity value so a contested
  // identity never has a candidate created for it.
  for (const group of classification.conflicts) {
    await seedConflictGroup(group, dryRun, report);
  }

  for (const group of classification.unique) {
    const article = byId.get(group.articleIds[0]);
    if (!article) continue;
    await seedUniqueGroup(group, article, now, dryRun, report);
  }

  return report;
}

/** Identity-version tag this seed writes with, for CLI/report display. */
export const BASELINE_IDENTITY_VERSION = URL_IDENTITY_VERSION;
