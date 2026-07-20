/**
 * OPT-IN reader/learning-data migration for canonical-conflict resolution
 * (issue #1134, Phase 3.5 follow-up to #1104).
 *
 * #1104 RESOLVES a conflict by archiving the loser Articles and RETAINING their
 * reader/learning data in place. #1134 adds a strictly OPT-IN follow-up: when the
 * operator asks for it, the losers' article-level reader data is actively
 * re-pointed onto the surviving Article, resolving every `@@unique` collision
 * WITHOUT ever catching P2002 inside the resolution transaction.
 *
 * The migration runs INSIDE the guarded resolution `$transaction` (so it is atomic
 * with the archive + identity claim). Collisions are resolved by READING the
 * survivor's occupied slots first and then deterministically choosing to repoint,
 * merge (keep the documented "winner" and drop the redundant duplicate), or — for
 * highlights that cannot be reliably re-anchored — SKIP (leave on the loser).
 *
 * PER-MODEL RULES (documented in `docs/content/incremental-provider-scraping-design.md`):
 *   - ReadingProgress `@@unique([userId, articleId])`: collision keeps the
 *     MORE-ADVANCED record (completed > in-progress, then higher `percent`, then
 *     more-recent `updatedAt`); no collision repoints.
 *   - ReadingListItem `@@unique([listId, articleId])`: if the list already holds
 *     the survivor, DELETE the loser's duplicate; else repoint.
 *   - Highlight `@@unique([userId, articleId, startOffset, endOffset])`: RE-ANCHOR
 *     each loser highlight onto the survivor's current content (the #1103 engine),
 *     dedupe exact-offset collisions with the survivor's existing highlights, and
 *     SKIP (leave on loser, count) any that cannot be reliably re-anchored.
 *   - ArticleMastery `@@unique([userId, articleId])`: collision keeps the
 *     most-recent (`lastActivityAt`, then higher `comprehensionScore`); else repoint.
 *   - ArticleDifficultyFeedback `@@unique([userId, articleId])`: collision keeps the
 *     most-recent (`updatedAt`); else repoint.
 *   - TutorMessage / QuizAttempt / PronunciationAttempt: no article-scoped unique —
 *     a simple append-only repoint (`updateMany`).
 *
 * PRIVACY (AGENTS.md): every returned/logged value is an id or a COUNT. Highlight
 * quote/prefix/suffix text is read only in-memory to compute re-anchor offsets and
 * is NEVER logged or persisted anew.
 */
import type { Prisma } from "@prisma/client";

import { assessAnchors, type ReanchorAnchorInput } from "./annotation-reanchor";
import type { DeriveReaderText } from "./annotation-migrator";

/** Per-model migration tally (metadata only — never content). */
export type ModelMigrationCounts = {
  /** Rows moved onto the survivor with no collision. */
  repointed: number;
  /** Collisions resolved by keeping one record and dropping the redundant duplicate. */
  merged: number;
  /** Rows left on the loser (highlights that could not be reliably re-anchored). */
  skipped: number;
};

/** Aggregate counts for every migrated reader/learning model (metadata only). */
export type ReaderDataMigrationSummary = {
  readingProgress: ModelMigrationCounts;
  readingListItems: ModelMigrationCounts;
  highlights: ModelMigrationCounts;
  articleMastery: ModelMigrationCounts;
  difficultyFeedback: ModelMigrationCounts;
  tutorMessages: ModelMigrationCounts;
  quizAttempts: ModelMigrationCounts;
  pronunciationAttempts: ModelMigrationCounts;
};

type MigrateParams = {
  loserArticleIds: string[];
  survivingArticleId: string;
  /** HTML → Reader plain text for highlight re-anchoring (injected — boundary rule). */
  deriveReaderText: DeriveReaderText;
  now: Date;
};

function zeroCounts(): ModelMigrationCounts {
  return { repointed: 0, merged: 0, skipped: 0 };
}

/** A loser/survivor row reduced to its collision scope key + comparator payload. */
type ScopedRow<Payload> = { id: string; scopeKey: string; payload: Payload };

/**
 * Collision-safe fold of loser rows onto the survivor for a model with ONE
 * article-scoped `@@unique` slot. Reads the survivor's occupied scope keys, then
 * for each loser row (deterministic order): repoints when the survivor has no row
 * for that scope, otherwise keeps the documented winner (copying the loser's
 * payload onto the survivor's row when `preferLoser`) and deletes the redundant
 * loser duplicate. Never blind-writes into an occupied slot, so P2002 is
 * impossible inside the transaction.
 */
async function mergeScoped<Payload>(config: {
  survivorRows: ScopedRow<Payload>[];
  loserRows: ScopedRow<Payload>[];
  preferLoser: (loser: Payload, current: Payload) => boolean;
  repoint: (loserRowId: string) => Promise<void>;
  overwriteSurvivor: (survivorRowId: string, loser: Payload) => Promise<void>;
  deleteLoser: (loserRowId: string) => Promise<void>;
}): Promise<ModelMigrationCounts> {
  const counts = zeroCounts();
  const claimed = new Map<string, ScopedRow<Payload>>();
  for (const row of config.survivorRows) claimed.set(row.scopeKey, row);

  for (const loser of config.loserRows) {
    const current = claimed.get(loser.scopeKey);
    if (!current) {
      await config.repoint(loser.id);
      // The repointed loser row now occupies the survivor's slot for this scope.
      claimed.set(loser.scopeKey, loser);
      counts.repointed += 1;
      continue;
    }
    if (config.preferLoser(loser.payload, current.payload)) {
      await config.overwriteSurvivor(current.id, loser.payload);
      // Keep the survivor's physical row id, but remember the winning payload so a
      // THIRD loser for the same scope compares against the up-to-date value.
      claimed.set(loser.scopeKey, { id: current.id, scopeKey: loser.scopeKey, payload: loser.payload });
    }
    await config.deleteLoser(loser.id);
    counts.merged += 1;
  }
  return counts;
}

type ReadingProgressPayload = {
  percent: number;
  completed: boolean;
  completedAt: Date | null;
  updatedAt: Date;
};

async function migrateReadingProgress(
  tx: Prisma.TransactionClient,
  loserArticleIds: string[],
  survivingArticleId: string,
): Promise<ModelMigrationCounts> {
  const select = {
    id: true,
    userId: true,
    percent: true,
    completed: true,
    completedAt: true,
    updatedAt: true,
  } satisfies Prisma.ReadingProgressSelect;
  const survivorRows = await tx.readingProgress.findMany({
    where: { articleId: survivingArticleId },
    select,
  });
  const loserRows = await tx.readingProgress.findMany({
    where: { articleId: { in: loserArticleIds } },
    select,
    orderBy: [{ userId: "asc" }, { id: "asc" }],
  });
  const toScoped = (row: (typeof survivorRows)[number]): ScopedRow<ReadingProgressPayload> => ({
    id: row.id,
    scopeKey: row.userId,
    payload: {
      percent: row.percent,
      completed: row.completed,
      completedAt: row.completedAt,
      updatedAt: row.updatedAt,
    },
  });
  return mergeScoped<ReadingProgressPayload>({
    survivorRows: survivorRows.map(toScoped),
    loserRows: loserRows.map(toScoped),
    preferLoser: (loser, current) => {
      if (loser.completed !== current.completed) return loser.completed;
      if (loser.percent !== current.percent) return loser.percent > current.percent;
      return loser.updatedAt.getTime() > current.updatedAt.getTime();
    },
    repoint: async (id) => {
      await tx.readingProgress.update({ where: { id }, data: { articleId: survivingArticleId } });
    },
    overwriteSurvivor: async (id, loser) => {
      await tx.readingProgress.update({
        where: { id },
        data: { percent: loser.percent, completed: loser.completed, completedAt: loser.completedAt },
      });
    },
    deleteLoser: async (id) => {
      await tx.readingProgress.delete({ where: { id } });
    },
  });
}

async function migrateReadingListItems(
  tx: Prisma.TransactionClient,
  loserArticleIds: string[],
  survivingArticleId: string,
): Promise<ModelMigrationCounts> {
  const select = { id: true, listId: true } satisfies Prisma.ReadingListItemSelect;
  const survivorRows = await tx.readingListItem.findMany({
    where: { articleId: survivingArticleId },
    select,
  });
  const loserRows = await tx.readingListItem.findMany({
    where: { articleId: { in: loserArticleIds } },
    select,
    orderBy: [{ listId: "asc" }, { id: "asc" }],
  });
  const toScoped = (row: (typeof survivorRows)[number]): ScopedRow<null> => ({
    id: row.id,
    scopeKey: row.listId,
    payload: null,
  });
  return mergeScoped<null>({
    survivorRows: survivorRows.map(toScoped),
    loserRows: loserRows.map(toScoped),
    // A reading list can hold an article at most once — the survivor's membership
    // always wins; the loser's duplicate membership is dropped.
    preferLoser: () => false,
    repoint: async (id) => {
      await tx.readingListItem.update({ where: { id }, data: { articleId: survivingArticleId } });
    },
    overwriteSurvivor: async () => {
      /* unreachable: preferLoser is always false */
    },
    deleteLoser: async (id) => {
      await tx.readingListItem.delete({ where: { id } });
    },
  });
}

type MasteryPayload = {
  readingCompletion: number;
  quizScore: number | null;
  lookupDensity: number | null;
  timeSpentMs: number | null;
  difficultyFeedback: string | null;
  comprehensionScore: number;
  lastActivityAt: Date;
};

async function migrateArticleMastery(
  tx: Prisma.TransactionClient,
  loserArticleIds: string[],
  survivingArticleId: string,
): Promise<ModelMigrationCounts> {
  const select = {
    id: true,
    userId: true,
    readingCompletion: true,
    quizScore: true,
    lookupDensity: true,
    timeSpentMs: true,
    difficultyFeedback: true,
    comprehensionScore: true,
    lastActivityAt: true,
  } satisfies Prisma.ArticleMasterySelect;
  const survivorRows = await tx.articleMastery.findMany({
    where: { articleId: survivingArticleId },
    select,
  });
  const loserRows = await tx.articleMastery.findMany({
    where: { articleId: { in: loserArticleIds } },
    select,
    orderBy: [{ userId: "asc" }, { id: "asc" }],
  });
  const toScoped = (row: (typeof survivorRows)[number]): ScopedRow<MasteryPayload> => ({
    id: row.id,
    scopeKey: row.userId,
    payload: {
      readingCompletion: row.readingCompletion,
      quizScore: row.quizScore,
      lookupDensity: row.lookupDensity,
      timeSpentMs: row.timeSpentMs,
      difficultyFeedback: row.difficultyFeedback,
      comprehensionScore: row.comprehensionScore,
      lastActivityAt: row.lastActivityAt,
    },
  });
  return mergeScoped<MasteryPayload>({
    survivorRows: survivorRows.map(toScoped),
    loserRows: loserRows.map(toScoped),
    preferLoser: (loser, current) => {
      const delta = loser.lastActivityAt.getTime() - current.lastActivityAt.getTime();
      if (delta !== 0) return delta > 0;
      return loser.comprehensionScore > current.comprehensionScore;
    },
    repoint: async (id) => {
      await tx.articleMastery.update({ where: { id }, data: { articleId: survivingArticleId } });
    },
    overwriteSurvivor: async (id, loser) => {
      await tx.articleMastery.update({
        where: { id },
        data: {
          readingCompletion: loser.readingCompletion,
          quizScore: loser.quizScore,
          lookupDensity: loser.lookupDensity,
          timeSpentMs: loser.timeSpentMs,
          difficultyFeedback: loser.difficultyFeedback,
          comprehensionScore: loser.comprehensionScore,
          lastActivityAt: loser.lastActivityAt,
        },
      });
    },
    deleteLoser: async (id) => {
      await tx.articleMastery.delete({ where: { id } });
    },
  });
}

type DifficultyPayload = { vote: string; updatedAt: Date };

async function migrateDifficultyFeedback(
  tx: Prisma.TransactionClient,
  loserArticleIds: string[],
  survivingArticleId: string,
): Promise<ModelMigrationCounts> {
  const select = {
    id: true,
    userId: true,
    vote: true,
    updatedAt: true,
  } satisfies Prisma.ArticleDifficultyFeedbackSelect;
  const survivorRows = await tx.articleDifficultyFeedback.findMany({
    where: { articleId: survivingArticleId },
    select,
  });
  const loserRows = await tx.articleDifficultyFeedback.findMany({
    where: { articleId: { in: loserArticleIds } },
    select,
    orderBy: [{ userId: "asc" }, { id: "asc" }],
  });
  const toScoped = (row: (typeof survivorRows)[number]): ScopedRow<DifficultyPayload> => ({
    id: row.id,
    scopeKey: row.userId,
    payload: { vote: row.vote, updatedAt: row.updatedAt },
  });
  return mergeScoped<DifficultyPayload>({
    survivorRows: survivorRows.map(toScoped),
    loserRows: loserRows.map(toScoped),
    preferLoser: (loser, current) => loser.updatedAt.getTime() > current.updatedAt.getTime(),
    repoint: async (id) => {
      await tx.articleDifficultyFeedback.update({
        where: { id },
        data: { articleId: survivingArticleId },
      });
    },
    overwriteSurvivor: async (id, loser) => {
      await tx.articleDifficultyFeedback.update({ where: { id }, data: { vote: loser.vote } });
    },
    deleteLoser: async (id) => {
      await tx.articleDifficultyFeedback.delete({ where: { id } });
    },
  });
}

/** `${userId}:${startOffset}:${endOffset}` — the Highlight uniqueness slot per user. */
function highlightSlotKey(userId: string, startOffset: number, endOffset: number): string {
  return `${userId}:${startOffset}:${endOffset}`;
}

/**
 * Re-anchors each loser highlight onto the survivor's CURRENT content and moves
 * the reliable ones. Unreliable anchors (ambiguous/missing) are SKIPPED (left on
 * the loser, counted). Reliable anchors whose target slot is already occupied by
 * an existing survivor highlight (same user + offsets) are deduped (loser dropped).
 */
async function migrateHighlights(
  tx: Prisma.TransactionClient,
  loserArticleIds: string[],
  survivingArticleId: string,
  survivorPlainText: string,
): Promise<ModelMigrationCounts> {
  const counts = zeroCounts();
  const loserRows = await tx.highlight.findMany({
    where: { articleId: { in: loserArticleIds } },
    select: {
      id: true,
      userId: true,
      quote: true,
      startOffset: true,
      endOffset: true,
      prefix: true,
      suffix: true,
    },
    orderBy: [{ userId: "asc" }, { startOffset: "asc" }, { id: "asc" }],
  });
  if (loserRows.length === 0) return counts;

  const anchors: ReanchorAnchorInput[] = loserRows.map((row) => ({
    id: row.id,
    userId: row.userId,
    quote: row.quote,
    startOffset: row.startOffset,
    endOffset: row.endOffset,
    prefix: row.prefix,
    suffix: row.suffix,
  }));
  const assessmentById = new Map(assessAnchors(anchors, survivorPlainText).map((a) => [a.id, a]));

  const survivorHighlights = await tx.highlight.findMany({
    where: { articleId: survivingArticleId },
    select: { userId: true, startOffset: true, endOffset: true },
  });
  const occupied = new Set<string>();
  for (const h of survivorHighlights) {
    occupied.add(highlightSlotKey(h.userId, h.startOffset, h.endOffset));
  }

  for (const row of loserRows) {
    const assessment = assessmentById.get(row.id);
    if (!assessment || !assessment.reliable) {
      // Cannot re-anchor confidently — leave it on the loser, never silently drop.
      counts.skipped += 1;
      continue;
    }
    const slot = highlightSlotKey(row.userId, assessment.targetStartOffset, assessment.targetEndOffset);
    if (occupied.has(slot)) {
      // The survivor already owns this exact anchor for this user — drop the dup.
      await tx.highlight.delete({ where: { id: row.id } });
      counts.merged += 1;
      continue;
    }
    await tx.highlight.update({
      where: { id: row.id },
      data: {
        articleId: survivingArticleId,
        startOffset: assessment.targetStartOffset,
        endOffset: assessment.targetEndOffset,
      },
    });
    occupied.add(slot);
    counts.repointed += 1;
  }
  return counts;
}

/** Append-only repoint for a model with no article-scoped unique constraint. */
async function repointAll(
  repoint: (where: { articleId: { in: string[] } }, data: { articleId: string }) => Promise<{ count: number }>,
  loserArticleIds: string[],
  survivingArticleId: string,
): Promise<ModelMigrationCounts> {
  const { count } = await repoint(
    { articleId: { in: loserArticleIds } },
    { articleId: survivingArticleId },
  );
  return { repointed: count, merged: 0, skipped: 0 };
}

/**
 * Migrates every article-level reader/learning row from the loser Articles onto
 * the survivor, resolving each model's uniqueness collisions by the documented
 * rule. MUST run inside the resolution `$transaction` (atomic with archive +
 * identity claim). Returns per-model COUNTS only.
 */
export async function migrateReaderDataInTx(
  tx: Prisma.TransactionClient,
  params: MigrateParams,
): Promise<ReaderDataMigrationSummary> {
  const { loserArticleIds, survivingArticleId, deriveReaderText } = params;

  const survivor = await tx.article.findUnique({
    where: { id: survivingArticleId },
    select: { content: true },
  });
  const survivorPlainText = deriveReaderText(survivor?.content ?? "");

  const [
    readingProgress,
    readingListItems,
    highlights,
    articleMastery,
    difficultyFeedback,
    tutorMessages,
    quizAttempts,
    pronunciationAttempts,
  ] = [
    await migrateReadingProgress(tx, loserArticleIds, survivingArticleId),
    await migrateReadingListItems(tx, loserArticleIds, survivingArticleId),
    await migrateHighlights(tx, loserArticleIds, survivingArticleId, survivorPlainText),
    await migrateArticleMastery(tx, loserArticleIds, survivingArticleId),
    await migrateDifficultyFeedback(tx, loserArticleIds, survivingArticleId),
    await repointAll((where, data) => tx.tutorMessage.updateMany({ where, data }), loserArticleIds, survivingArticleId),
    await repointAll((where, data) => tx.quizAttempt.updateMany({ where, data }), loserArticleIds, survivingArticleId),
    await repointAll(
      (where, data) => tx.pronunciationAttempt.updateMany({ where, data }),
      loserArticleIds,
      survivingArticleId,
    ),
  ];

  return {
    readingProgress,
    readingListItems,
    highlights,
    articleMastery,
    difficultyFeedback,
    tutorMessages,
    quizAttempts,
    pronunciationAttempts,
  };
}
