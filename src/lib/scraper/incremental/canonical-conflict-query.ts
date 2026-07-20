/**
 * Thin canonical-conflict QUEUE query layer (issue #1104, Phase 3.5).
 *
 * Reads the canonical-conflict queue as SANITIZED, metadata-only DTOs for the
 * capability-gated admin API (mirrors `candidate-review-query.ts`). Every field
 * is a controlled id, versioned identity HASH (`<version>:<sha256hex>` — never a
 * raw URL), status enum, count, timestamp, or sanitized reason CATEGORY. It never
 * reads or returns a raw URL, response body, secret, article text, or any
 * user-private content, and it NEVER mutates state or enqueues work.
 *
 * "Conflicting public Article ids" are computed by re-deriving each eligible
 * public Article's provisional identity with the SAME pure classifier the
 * baseline seed used (`classifyBaselineArticles`) and matching the conflict's
 * `(providerKey, identityVersion, canonicalKey)` — plus any Article already
 * linked to a candidate that claims that canonical identity (runtime conflicts).
 * Dependent-data figures are COUNTS ONLY (reader annotations, progress, lists,
 * mastery, attempts, tutor messages, difficulty feedback); never their content.
 */
import { CanonicalConflictStatus, type Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import {
  classifyBaselineArticles,
  loadEligibleArticles,
  type BaselineIdentityGroup,
} from "./baseline-backfill";

/** The sanitized identity of a conflict (versioned hash keys — never URLs). */
export type ConflictIdentity = {
  providerKey: string;
  identityVersion: number;
  canonicalKey: string;
};

/** COUNTS ONLY of the reader/learning data attached to the contested Articles. */
export type DependentDataCounts = {
  highlights: number;
  readingProgress: number;
  readingListItems: number;
  articleMastery: number;
  quizAttempts: number;
  pronunciationAttempts: number;
  tutorMessages: number;
  difficultyFeedback: number;
};

/** A single sanitized canonical-conflict DTO (list + detail share these fields). */
export type CanonicalConflictDto = {
  id: string;
  providerKey: string;
  identityVersion: number;
  /** Sanitized versioned identity hash (`<version>:<sha256hex>`) — never a URL. */
  canonicalKey: string;
  /** Sanitized provisional key of the challenger identity — never a URL. */
  challengerKey: string;
  incumbentCandidateId: string | null;
  status: CanonicalConflictStatus;
  /** Machine reason CATEGORY — never a URL/body. */
  reason: string | null;
  detectedAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  /** The contested public Article ids (the operator picks the survivor from these). */
  conflictingArticleIds: string[];
  /** Aggregate reader/learning COUNTS across every contested Article. */
  dependentData: DependentDataCounts;
};

/** The detail DTO adds a per-Article dependent-data breakdown. */
export type CanonicalConflictDetailDto = CanonicalConflictDto & {
  articles: Array<{ articleId: string; dependentData: DependentDataCounts }>;
};

/** A bounded, filtered page of canonical conflicts + the total match count. */
export type CanonicalConflictPage = {
  conflicts: CanonicalConflictDto[];
  total: number;
  offset: number;
  limit: number;
};

/** Filters for {@link listCanonicalConflicts}. */
export type CanonicalConflictFilter = {
  /** Which conflict status to list (defaults to OPEN). */
  status?: CanonicalConflictStatus;
  providerKey?: string;
  offset?: number;
  limit?: number;
};

const CONFLICT_SELECT = {
  id: true,
  providerKey: true,
  identityVersion: true,
  canonicalKey: true,
  challengerKey: true,
  incumbentCandidateId: true,
  status: true,
  reason: true,
  detectedAt: true,
  resolvedAt: true,
  resolvedBy: true,
} satisfies Prisma.CanonicalConflictSelect;

type ConflictRow = Prisma.CanonicalConflictGetPayload<{ select: typeof CONFLICT_SELECT }>;

function compositeKey(providerKey: string, identityVersion: number, key: string): string {
  return `${providerKey}\u0000${identityVersion}\u0000${key}`;
}

function zeroCounts(): DependentDataCounts {
  return {
    highlights: 0,
    readingProgress: 0,
    readingListItems: 0,
    articleMastery: 0,
    quizAttempts: 0,
    pronunciationAttempts: 0,
    tutorMessages: 0,
    difficultyFeedback: 0,
  };
}

function addCounts(into: DependentDataCounts, from: DependentDataCounts): void {
  into.highlights += from.highlights;
  into.readingProgress += from.readingProgress;
  into.readingListItems += from.readingListItems;
  into.articleMastery += from.articleMastery;
  into.quizAttempts += from.quizAttempts;
  into.pronunciationAttempts += from.pronunciationAttempts;
  into.tutorMessages += from.tutorMessages;
  into.difficultyFeedback += from.difficultyFeedback;
}

/**
 * Builds a composite-key → contested Article ids index from a SINGLE pass of the
 * pure baseline classifier over every eligible public Article, so a page of
 * conflicts is resolved without re-deriving identities per conflict.
 */
async function buildBaselineParticipantIndex(): Promise<Map<string, string[]>> {
  const eligible = await loadEligibleArticles();
  const { unique, conflicts } = classifyBaselineArticles(eligible);
  const index = new Map<string, string[]>();
  const add = (group: BaselineIdentityGroup): void => {
    const key = compositeKey(group.providerKey, group.identityVersion, group.provisionalKey);
    const existing = index.get(key);
    if (existing) existing.push(...group.articleIds);
    else index.set(key, [...group.articleIds]);
  };
  for (const group of unique) add(group);
  for (const group of conflicts) add(group);
  return index;
}

/**
 * Loads the Article ids already linked to a candidate that CLAIMS one of the
 * given canonical identities (runtime conflicts, where the challenger was parked
 * before Article creation but an incumbent identity already owns an Article).
 */
async function loadCandidateLinkedParticipants(
  identities: ConflictIdentity[],
): Promise<Map<string, string[]>> {
  const index = new Map<string, string[]>();
  if (identities.length === 0) return index;
  const rows = await prisma.crawlCandidate.findMany({
    where: {
      OR: identities.map((identity) => ({
        providerKey: identity.providerKey,
        identityVersion: identity.identityVersion,
        canonicalKey: identity.canonicalKey,
      })),
      articleId: { not: null },
    },
    select: { providerKey: true, identityVersion: true, canonicalKey: true, articleId: true },
  });
  for (const row of rows) {
    if (!row.articleId || !row.canonicalKey) continue;
    const key = compositeKey(row.providerKey, row.identityVersion, row.canonicalKey);
    const existing = index.get(key);
    if (existing) existing.push(row.articleId);
    else index.set(key, [row.articleId]);
  }
  return index;
}

/**
 * Resolves the contested public Article ids for ONE conflict identity by
 * re-deriving identities with the baseline classifier and unioning any
 * candidate-linked Article. Used reads-before-tx by the resolution commit and by
 * the single-conflict detail DTO. Deterministic (sorted) output.
 */
export async function resolveConflictParticipants(identity: ConflictIdentity): Promise<string[]> {
  const key = compositeKey(identity.providerKey, identity.identityVersion, identity.canonicalKey);
  const [baselineIndex, linkedIndex] = await Promise.all([
    buildBaselineParticipantIndex(),
    loadCandidateLinkedParticipants([identity]),
  ]);
  const ids = new Set<string>([...(baselineIndex.get(key) ?? []), ...(linkedIndex.get(key) ?? [])]);
  return [...ids].sort();
}

/**
 * Returns per-Article dependent-data COUNTS for a set of Article ids in a bounded
 * number of grouped aggregate queries (never per-row content). Missing Articles
 * map to a zero record.
 */
export async function countDependentDataByArticle(
  articleIds: string[],
): Promise<Map<string, DependentDataCounts>> {
  const result = new Map<string, DependentDataCounts>();
  for (const articleId of articleIds) result.set(articleId, zeroCounts());
  if (articleIds.length === 0) return result;

  const where = { articleId: { in: articleIds } };
  const [
    highlights,
    readingProgress,
    readingListItems,
    articleMastery,
    quizAttempts,
    pronunciationAttempts,
    tutorMessages,
    difficultyFeedback,
  ] = await Promise.all([
    prisma.highlight.groupBy({ by: ["articleId"], where, _count: { _all: true } }),
    prisma.readingProgress.groupBy({ by: ["articleId"], where, _count: { _all: true } }),
    prisma.readingListItem.groupBy({ by: ["articleId"], where, _count: { _all: true } }),
    prisma.articleMastery.groupBy({ by: ["articleId"], where, _count: { _all: true } }),
    prisma.quizAttempt.groupBy({ by: ["articleId"], where, _count: { _all: true } }),
    prisma.pronunciationAttempt.groupBy({ by: ["articleId"], where, _count: { _all: true } }),
    prisma.tutorMessage.groupBy({ by: ["articleId"], where, _count: { _all: true } }),
    prisma.articleDifficultyFeedback.groupBy({ by: ["articleId"], where, _count: { _all: true } }),
  ]);

  const apply = (
    rows: Array<{ articleId: string | null; _count: { _all: number } }>,
    field: keyof DependentDataCounts,
  ): void => {
    for (const row of rows) {
      if (!row.articleId) continue;
      const counts = result.get(row.articleId);
      if (counts) counts[field] = row._count._all;
    }
  };
  apply(highlights, "highlights");
  apply(readingProgress, "readingProgress");
  apply(readingListItems, "readingListItems");
  apply(articleMastery, "articleMastery");
  apply(quizAttempts, "quizAttempts");
  apply(pronunciationAttempts, "pronunciationAttempts");
  apply(tutorMessages, "tutorMessages");
  apply(difficultyFeedback, "difficultyFeedback");
  return result;
}

function aggregate(
  articleIds: string[],
  byArticle: Map<string, DependentDataCounts>,
): DependentDataCounts {
  const total = zeroCounts();
  for (const articleId of articleIds) {
    const counts = byArticle.get(articleId);
    if (counts) addCounts(total, counts);
  }
  return total;
}

function whereFromFilter(filter: CanonicalConflictFilter): Prisma.CanonicalConflictWhereInput {
  const where: Prisma.CanonicalConflictWhereInput = {
    status: filter.status ?? CanonicalConflictStatus.OPEN,
  };
  if (filter.providerKey) where.providerKey = filter.providerKey;
  return where;
}

/**
 * Lists canonical conflicts (default OPEN) with an optional provider filter and
 * offset/limit pagination, oldest-first. Each row carries its contested public
 * Article ids and aggregate reader/learning COUNTS so an operator can pick the
 * survivor without ever seeing article content.
 */
export async function listCanonicalConflicts(
  filter: CanonicalConflictFilter = {},
): Promise<CanonicalConflictPage> {
  const where = whereFromFilter(filter);
  const offset = Math.max(0, filter.offset ?? 0);
  const limit = Math.min(Math.max(1, filter.limit ?? 50), 200);

  const [total, rows] = await Promise.all([
    prisma.canonicalConflict.count({ where }),
    prisma.canonicalConflict.findMany({
      where,
      select: CONFLICT_SELECT,
      orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
      skip: offset,
      take: limit,
    }),
  ]);

  const [baselineIndex, linkedIndex] = await Promise.all([
    buildBaselineParticipantIndex(),
    loadCandidateLinkedParticipants(rows),
  ]);

  const perConflictArticleIds = new Map<string, string[]>();
  const allArticleIds = new Set<string>();
  for (const row of rows) {
    const key = compositeKey(row.providerKey, row.identityVersion, row.canonicalKey);
    const ids = [...new Set([...(baselineIndex.get(key) ?? []), ...(linkedIndex.get(key) ?? [])])].sort();
    perConflictArticleIds.set(row.id, ids);
    for (const id of ids) allArticleIds.add(id);
  }

  const byArticle = await countDependentDataByArticle([...allArticleIds]);

  const conflicts = rows.map((row): CanonicalConflictDto => {
    const conflictingArticleIds = perConflictArticleIds.get(row.id) ?? [];
    return {
      ...toDtoBase(row),
      conflictingArticleIds,
      dependentData: aggregate(conflictingArticleIds, byArticle),
    };
  });

  return { conflicts, total, offset, limit };
}

function toDtoBase(row: ConflictRow): Omit<CanonicalConflictDto, "conflictingArticleIds" | "dependentData"> {
  return {
    id: row.id,
    providerKey: row.providerKey,
    identityVersion: row.identityVersion,
    canonicalKey: row.canonicalKey,
    challengerKey: row.challengerKey,
    incumbentCandidateId: row.incumbentCandidateId,
    status: row.status,
    reason: row.reason,
    detectedAt: row.detectedAt,
    resolvedAt: row.resolvedAt,
    resolvedBy: row.resolvedBy,
  };
}

/**
 * Returns the sanitized detail DTO (conflict + contested Article ids + per-Article
 * dependent-data COUNTS) for ONE conflict, or `null` when it does not exist. Not
 * status-restricted so an operator can inspect an already-resolved conflict.
 */
export async function getCanonicalConflict(id: string): Promise<CanonicalConflictDetailDto | null> {
  const row = await prisma.canonicalConflict.findUnique({ where: { id }, select: CONFLICT_SELECT });
  if (!row) return null;

  const conflictingArticleIds = await resolveConflictParticipants(row);
  const byArticle = await countDependentDataByArticle(conflictingArticleIds);

  return {
    ...toDtoBase(row),
    conflictingArticleIds,
    dependentData: aggregate(conflictingArticleIds, byArticle),
    articles: conflictingArticleIds.map((articleId) => ({
      articleId,
      dependentData: byArticle.get(articleId) ?? zeroCounts(),
    })),
  };
}
