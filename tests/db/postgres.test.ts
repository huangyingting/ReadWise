import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, test } from "node:test";
import { ArticleStatus, ArticleVisibility } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const enabled = process.env.RUN_DB_INTEGRATION === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
const isPostgres = databaseUrl.startsWith("postgresql://") || databaseUrl.startsWith("postgres://");
const PREFIX = "dbit_";

function id(label: string): string {
  return `${PREFIX}${label}_${randomUUID().replace(/-/g, "")}`;
}

async function cleanIntegrationRows(): Promise<void> {
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: PREFIX } } });
  await prisma.savedWord.deleteMany({ where: { userId: { startsWith: PREFIX } } });
  await prisma.article.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.tag.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

afterEach(async () => {
  if (enabled) await cleanIntegrationRows();
});

after(async () => {
  await prisma.$disconnect();
});

test("PostgreSQL migrations are applied and include the article FTS index", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const migrations = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
    SELECT migration_name, finished_at
    FROM "_prisma_migrations"
    WHERE rolled_back_at IS NULL
  `;

  assert.ok(
    migrations.some((migration) => migration.migration_name === "20260623000000_postgresql_baseline"),
    "PostgreSQL baseline migration should be recorded",
  );
  assert.ok(
    migrations.some((migration) => migration.migration_name === "20260623004106_privacy_article_model"),
    "PostgreSQL privacy migration should be recorded separately from the baseline",
  );
  assert.ok(
    migrations.some((migration) => migration.migration_name === "20260623004100_json_field_cleanup"),
    "PostgreSQL JSON cleanup migration should be recorded separately from the baseline",
  );
  assert.ok(
    migrations.some((migration) => migration.migration_name === "20260623004100_add_audit_logs"),
    "PostgreSQL audit-log migration should be recorded",
  );
  assert.equal(migrations.filter((migration) => migration.finished_at == null).length, 0);

  const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND (
        (tablename = 'Article' AND indexname = 'Article_search_vector_idx')
        OR (tablename = 'AuditLog' AND indexname IN (
          'AuditLog_createdAt_idx',
          'AuditLog_actorId_createdAt_idx',
          'AuditLog_action_createdAt_idx',
          'AuditLog_targetType_targetId_idx'
        ))
      )
  `;
  assert.deepEqual(
    indexes.map((index) => index.indexname).sort(),
    [
      "Article_search_vector_idx",
      "AuditLog_action_createdAt_idx",
      "AuditLog_actorId_createdAt_idx",
      "AuditLog_createdAt_idx",
      "AuditLog_targetType_targetId_idx",
    ],
  );
});

test("audit logs persist security event details on PostgreSQL", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const actorId = id("audit_actor");
  const row = await prisma.auditLog.create({
    data: {
      action: "admin.audit_logs.read",
      actorId,
      actorRole: "Admin",
      targetType: "AuditLog",
      targetId: id("audit_target"),
      metadata: "{\"scope\":\"integration\"}",
      requestId: id("request"),
      ipAddress: "127.0.0.1",
      userAgent: "node:test",
    },
  });

  const found = await prisma.auditLog.findUnique({ where: { id: row.id } });

  assert.equal(found?.actorId, actorId);
  assert.equal(found?.action, "admin.audit_logs.read");
  assert.equal(found?.targetType, "AuditLog");
});

test("PostgreSQL JSON fields migrate to jsonb columns", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const migrations = await prisma.$queryRaw<Array<{ migration_name: string }>>`
    SELECT migration_name
    FROM "_prisma_migrations"
    WHERE migration_name = '20260623023200_json_field_parity'
      AND rolled_back_at IS NULL
      AND finished_at IS NOT NULL
  `;
  assert.equal(migrations.length, 1);

  const columns = await prisma.$queryRaw<
    Array<{ table_name: string; column_name: string; data_type: string; column_default: string | null }>
  >`
    SELECT table_name, column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (table_name, column_name) IN (
        ('Profile', 'topics'),
        ('QuizQuestion', 'options'),
        ('ArticleSpeech', 'words')
      )
  `;

  const byColumn = new Map(columns.map((column) => [`${column.table_name}.${column.column_name}`, column]));
  assert.equal(byColumn.get("Profile.topics")?.data_type, "jsonb");
  assert.match(byColumn.get("Profile.topics")?.column_default ?? "", /'\[\]'::jsonb/);
  assert.equal(byColumn.get("QuizQuestion.options")?.data_type, "jsonb");
  assert.equal(byColumn.get("ArticleSpeech.words")?.data_type, "jsonb");

  const userId = id("json_user");
  await prisma.user.create({ data: { id: userId, name: "DB Integration JSON User", role: "Reader" } });
  const profile = await prisma.profile.create({
    data: { userId, englishLevel: "B1", topics: ["technology", "science"] },
    select: { topics: true },
  });
  assert.deepEqual(profile.topics, ["technology", "science"]);
});

test("ownership uniqueness matches PostgreSQL semantics", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const ownerA = id("owner_a");
  const ownerB = id("owner_b");
  const sourceUrl = `https://example.invalid/${id("source")}`;

  await prisma.user.createMany({
    data: [
      { id: ownerA, name: "DB Integration Owner A", role: "Reader" },
      { id: ownerB, name: "DB Integration Owner B", role: "Reader" },
    ],
  });

  await prisma.article.create({
    data: {
      id: id("article_a"),
      title: "Owned Article A",
      content: "Body",
      sourceUrl,
      ownerId: ownerA,
      visibility: ArticleVisibility.PRIVATE,
    },
  });

  await assert.rejects(
    prisma.article.create({
      data: {
        id: id("article_dup"),
        title: "Duplicate Owner Article",
        content: "Body",
        sourceUrl,
        ownerId: ownerA,
        visibility: ArticleVisibility.PRIVATE,
      },
    }),
    /Unique constraint failed|Unique constraint|duplicate key value/,
  );

  await prisma.article.create({
    data: {
      id: id("article_b"),
      title: "Owned Article B",
      content: "Body",
      sourceUrl,
      ownerId: ownerB,
      visibility: ArticleVisibility.PRIVATE,
    },
  });
});

test("PostgreSQL privacy checks enforce owner and visibility invariants", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const ownerId = id("privacy_owner");
  await prisma.user.create({ data: { id: ownerId, name: "DB Integration Privacy Owner", role: "Reader" } });

  await assert.rejects(
    prisma.article.create({
      data: {
        id: id("private_without_owner"),
        title: "Invalid Private Article",
        content: "Body",
        visibility: ArticleVisibility.PRIVATE,
      },
    }),
    /Article_private_owner_check|check constraint|constraint failed/i,
  );

  await assert.rejects(
    prisma.article.create({
      data: {
        id: id("owned_public"),
        title: "Invalid Owned Public Article",
        content: "Body",
        ownerId,
        visibility: ArticleVisibility.PUBLIC,
      },
    }),
    /Article_owner_visibility_check|check constraint|constraint failed/i,
  );
});

test("article deletes cascade derived data but keep saved-word study history", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const userId = id("cascade_user");
  const articleId = id("cascade_article");
  const tagId = id("cascade_tag");

  await prisma.user.create({ data: { id: userId, name: "DB Integration User", role: "Reader" } });
  await prisma.article.create({
    data: {
      id: articleId,
      title: "Cascade Article",
      content: "A long enough body for derived data.",
      status: ArticleStatus.PUBLISHED,
      publishedAt: new Date(),
      ownerId: userId,
      visibility: ArticleVisibility.PRIVATE,
    },
  });
  await prisma.tag.create({ data: { id: tagId, name: `Integration ${tagId}`, slug: tagId } });

  await Promise.all([
    prisma.articleTag.create({ data: { articleId, tagId } }),
    prisma.translation.create({ data: { articleId, targetLang: "es", content: "Texto" } }),
    prisma.sentenceTranslation.create({
      data: { articleId, sourceHash: id("hash"), targetLang: "es", sourceText: "Hello", translation: "Hola" },
    }),
    prisma.vocabularyItem.create({ data: { articleId, word: "cascade", explanation: "test", example: "cascade test" } }),
    prisma.quizQuestion.create({ data: { articleId, question: "Question?", options: ["A", "B"], correctIndex: 0 } }),
    prisma.articleSpeech.create({
      data: { articleId, voice: "test", format: "mp3", mimeType: "audio/mpeg", audioBase64: "AA==", spokenText: "Hello", words: [] },
    }),
    prisma.readingProgress.create({ data: { userId, articleId, percent: 50 } }),
    prisma.readingList.create({ data: { id: id("list"), userId, name: "Integration List", items: { create: { articleId } } } }),
    prisma.highlight.create({ data: { userId, articleId, quote: "long", startOffset: 0, endOffset: 4 } }),
    prisma.tutorMessage.create({ data: { userId, articleId, role: "user", content: "Explain this." } }),
    prisma.quizAttempt.create({ data: { userId, articleId, correctCount: 1, totalQuestions: 2, scorePct: 50 } }),
    prisma.pronunciationAttempt.create({
      data: { userId, articleId, referenceText: "Hello", accuracyScore: 90, fluencyScore: 90, completenessScore: 90, pronScore: 90 },
    }),
    prisma.grammarExplanation.create({ data: { articleId, phrase: "because of", explanation: "Grammar note" } }),
    prisma.articleDifficultyFeedback.create({ data: { userId, articleId, vote: "just_right" } }),
    prisma.savedWord.create({ data: { userId, word: "cascade", articleId, explanation: "study item" } }),
  ]);

  await prisma.article.delete({ where: { id: articleId } });

  const [
    articleTags,
    translations,
    sentenceTranslations,
    vocabulary,
    quizQuestions,
    speech,
    progress,
    readingListItems,
    highlights,
    tutorMessages,
    quizAttempts,
    pronunciationAttempts,
    grammarExplanations,
    difficultyFeedback,
    savedWord,
  ] = await Promise.all([
    prisma.articleTag.count({ where: { articleId } }),
    prisma.translation.count({ where: { articleId } }),
    prisma.sentenceTranslation.count({ where: { articleId } }),
    prisma.vocabularyItem.count({ where: { articleId } }),
    prisma.quizQuestion.count({ where: { articleId } }),
    prisma.articleSpeech.count({ where: { articleId } }),
    prisma.readingProgress.count({ where: { articleId } }),
    prisma.readingListItem.count({ where: { articleId } }),
    prisma.highlight.count({ where: { articleId } }),
    prisma.tutorMessage.count({ where: { articleId } }),
    prisma.quizAttempt.count({ where: { articleId } }),
    prisma.pronunciationAttempt.count({ where: { articleId } }),
    prisma.grammarExplanation.count({ where: { articleId } }),
    prisma.articleDifficultyFeedback.count({ where: { articleId } }),
    prisma.savedWord.findUnique({ where: { userId_word: { userId, word: "cascade" } } }),
  ]);

  assert.deepEqual(
    [
      articleTags,
      translations,
      sentenceTranslations,
      vocabulary,
      quizQuestions,
      speech,
      progress,
      readingListItems,
      highlights,
      tutorMessages,
      quizAttempts,
      pronunciationAttempts,
      grammarExplanations,
      difficultyFeedback,
    ],
    Array(14).fill(0),
  );
  assert.equal(savedWord?.articleId, articleId);
});

test("PostgreSQL full-text article search is case-insensitive", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const articleId = id("fts_article");
  await prisma.article.create({
    data: {
      id: articleId,
      title: "Galactic Lanterns",
      content: "Astronomers study bright lantern-like stars.",
      status: ArticleStatus.PUBLISHED,
      publishedAt: new Date(),
    },
  });

  const { searchPublishedArticles } = await import("@/lib/articles");
  const results = await searchPublishedArticles("galactic", { limit: 5 });

  assert.ok(results.articles.some((article) => article.id === articleId));
});
