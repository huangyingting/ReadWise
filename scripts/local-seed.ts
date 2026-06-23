import {
  getLocalSeedPlan,
  isSafeLocalDatabaseUrl,
  LOCAL_SEED_DATASET,
  type LocalSeedDataset,
} from "@/lib/local-dev";
import type { Prisma } from "@prisma/client";

type Args = {
  dryRun: boolean;
  help: boolean;
};

type Tx = Prisma.TransactionClient;

const FIXED_NOW = new Date("2026-01-06T12:00:00.000Z");

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, help: false };
  for (const arg of argv) {
    switch (arg) {
      case "--dry-run":
        args.dryRun = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`ReadWise local deterministic seeder

Seeds admin/reader users, reusable NextAuth sessions, articles, reading
progress, saved words, and admin workflow fixtures. It never scrapes, calls AI,
or reads provider secrets.

Usage:
  npm run local:seed -- --dry-run
  npm run local:pg:seed

Safety:
  Refuses DATABASE_URL values outside the local SQLite dev database or the
  docker-compose PostgreSQL parity database.`);
}

function assertSafeTarget(): void {
  if (!isSafeLocalDatabaseUrl(process.env.DATABASE_URL)) {
    throw new Error(
      "Refusing to seed a non-local database. Use file:./dev.db or the local " +
        "docker-compose PostgreSQL URL documented in docs/database.md.",
    );
  }
}

function ids<T extends { id: string }>(rows: T[]): string[] {
  return rows.map((row) => row.id);
}

function date(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

async function seedLocalData(tx: Tx, dataset: LocalSeedDataset): Promise<void> {
  const userIds = ids(dataset.users);
  const userEmails = dataset.users.map((u) => u.email);
  const sessionIds = ids(dataset.sessions);
  const sessionTokens = dataset.sessions.map((s) => s.sessionToken);
  const articleIds = ids(dataset.articles);
  const sourceUrls = dataset.articles.map((a) => a.sourceUrl);
  const tagIds = ids(dataset.tags);
  const tagSlugs = dataset.tags.map((t) => t.slug);

  await tx.auditLog.deleteMany({ where: { id: { in: ids(dataset.auditLogs) } } });
  await tx.session.deleteMany({
    where: { OR: [{ id: { in: sessionIds } }, { sessionToken: { in: sessionTokens } }] },
  });
  await tx.user.deleteMany({
    where: { OR: [{ id: { in: userIds } }, { email: { in: userEmails } }] },
  });
  await tx.article.deleteMany({
    where: { OR: [{ id: { in: articleIds } }, { sourceUrl: { in: sourceUrls } }] },
  });
  await tx.tag.deleteMany({
    where: {
      OR: [
        { id: { in: tagIds } },
        { scope: "PUBLIC", namespace: "public", slug: { in: tagSlugs } },
      ],
    },
  });

  await tx.user.createMany({
    data: dataset.users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      emailVerified: FIXED_NOW,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })),
  });
  await tx.profile.createMany({
    data: dataset.users.map((u) => ({
      id: `profile-${u.id}`,
      userId: u.id,
      englishLevel: u.englishLevel,
      topics: u.topics,
      completedAt: FIXED_NOW,
      dailyGoal: u.role === "Admin" ? 1 : 2,
      timezone: "UTC",
      levelUpdatedAt: FIXED_NOW,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })),
  });
  await tx.session.createMany({
    data: dataset.sessions.map((s) => ({
      id: s.id,
      sessionToken: s.sessionToken,
      userId: s.userId,
      expires: date(s.expires) ?? FIXED_NOW,
    })),
  });
  await tx.article.createMany({
    data: dataset.articles.map((a) => ({
      id: a.id,
      slug: a.slug,
      title: a.title,
      author: a.author,
      source: a.source,
      sourceUrl: a.sourceUrl,
      excerpt: a.excerpt,
      content: a.content,
      category: a.category,
      wordCount: a.wordCount,
      readingMinutes: a.readingMinutes,
      difficulty: a.difficulty,
      difficultyScore: a.difficultyScore,
      visibility: a.visibility,
      status: a.status,
      sourceType: a.sourceType,
      publishedAt: date(a.publishedAt),
      ownerId: a.ownerId,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })),
  });
  await tx.tag.createMany({
    data: dataset.tags.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      scope: "PUBLIC",
      namespace: "public",
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })),
  });
  await tx.articleTag.createMany({
    data: dataset.articleTags.map((t) => ({
      articleId: t.articleId,
      tagId: t.tagId,
      createdAt: FIXED_NOW,
    })),
  });
  await tx.readingProgress.createMany({
    data: dataset.progress.map((p) => ({
      id: p.id,
      userId: p.userId,
      articleId: p.articleId,
      percent: p.percent,
      completed: p.completed,
      completedAt: date(p.completedAt),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })),
  });
  await tx.savedWord.createMany({
    data: dataset.savedWords.map((w) => ({
      id: w.id,
      userId: w.userId,
      word: w.word,
      explanation: w.explanation,
      example: w.example,
      articleId: w.articleId,
      dueAt: FIXED_NOW,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })),
  });
  await tx.vocabularyItem.createMany({
    data: dataset.vocabulary.map((v) => ({
      ...v,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })),
  });
  await tx.quizQuestion.createMany({
    data: dataset.quizQuestions.map((q) => ({
      id: q.id,
      articleId: q.articleId,
      question: q.question,
      options: q.options,
      correctIndex: q.correctIndex,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })),
  });
  await tx.translation.createMany({
    data: dataset.translations.map((t) => ({
      ...t,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })),
  });
  await tx.articleSpeech.createMany({
    data: dataset.speech.map((s) => ({
      ...s,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })),
  });
  await tx.readingList.createMany({
    data: dataset.readingLists.map((l) => ({
      ...l,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })),
  });
  await tx.readingListItem.createMany({
    data: dataset.readingListItems.map((i) => ({
      ...i,
      addedAt: FIXED_NOW,
    })),
  });
  await tx.highlight.createMany({
    data: dataset.highlights.map((h) => ({
      ...h,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })),
  });
  await tx.quizAttempt.createMany({
    data: dataset.quizAttempts.map((q) => ({
      ...q,
      completedAt: date(q.completedAt) ?? FIXED_NOW,
    })),
  });
  await tx.articleDifficultyFeedback.createMany({
    data: dataset.difficultyFeedback.map((f) => ({
      ...f,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })),
  });
  await tx.auditLog.createMany({
    data: dataset.auditLogs.map((log) => ({
      ...log,
      createdAt: FIXED_NOW,
    })),
  });
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }

  assertSafeTarget();
  const plan = getLocalSeedPlan();
  if (args.dryRun) {
    console.log(`Local seed dry-run ok: ${JSON.stringify(plan)}`);
    return 0;
  }

  const { prisma } = await import("@/lib/prisma");
  try {
    await prisma.$transaction((tx) => seedLocalData(tx, LOCAL_SEED_DATASET), {
      timeout: 30_000,
    });
  } finally {
    await prisma.$disconnect();
  }
  console.log(`Local seed complete: ${JSON.stringify(plan)}`);
  console.log("Admin session token: readwise-local-admin-session");
  console.log("Reader session token: readwise-local-reader-session");
  return 0;
}

main()
  .then(async (code) => {
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
