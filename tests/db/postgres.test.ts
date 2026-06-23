import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { after, afterEach, test } from "node:test";
import { ArticleStatus, ArticleVisibility, TagScope, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const enabled = process.env.RUN_DB_INTEGRATION === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
const isPostgres = databaseUrl.startsWith("postgresql://") || databaseUrl.startsWith("postgres://");
const PREFIX = "dbit_";
const ROOT = process.cwd();

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

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarQuote: string | null = null;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];

    if (dollarQuote) {
      if (sql.startsWith(dollarQuote, i)) {
        i += dollarQuote.length - 1;
        dollarQuote = null;
      }
      continue;
    }
    if (inLineComment) {
      if (char === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        i += 1;
        inBlockComment = false;
      }
      continue;
    }
    if (inSingleQuote) {
      if (char === "'" && next === "'") {
        i += 1;
      } else if (char === "'") {
        inSingleQuote = false;
      }
      continue;
    }
    if (inDoubleQuote) {
      if (char === '"' && next === '"') {
        i += 1;
      } else if (char === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (char === "-" && next === "-") {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (char === "'") {
      inSingleQuote = true;
      continue;
    }
    if (char === '"') {
      inDoubleQuote = true;
      continue;
    }
    if (char === "$") {
      const match = sql.slice(i).match(/^\$[A-Za-z_][A-Za-z_0-9]*\$|^\$\$/);
      if (match) {
        dollarQuote = match[0];
        i += dollarQuote.length - 1;
      }
      continue;
    }
    if (char === ";") {
      const statement = sql.slice(start, i).trim();
      if (statement.length > 0) statements.push(statement);
      start = i + 1;
    }
  }

  const trailing = sql.slice(start).trim();
  if (trailing.length > 0) statements.push(trailing);
  return statements;
}

async function applySql(db: Prisma.TransactionClient, sql: string): Promise<void> {
  for (const statement of splitSqlStatements(sql)) {
    await db.$executeRawUnsafe(statement);
  }
}

async function readPostgresMigrations(): Promise<Array<{ name: string; sql: string }>> {
  const migrationsRoot = join(ROOT, "prisma/postgresql/migrations");
  const migrationNames = (await readdir(migrationsRoot))
    .filter((name) => name !== "migration_lock.toml")
    .sort();

  return Promise.all(
    migrationNames.map(async (name) => ({
      name,
      sql: await readFile(join(migrationsRoot, name, "migration.sql"), "utf8"),
    })),
  );
}

afterEach(async () => {
  if (enabled) await cleanIntegrationRows();
});

after(async () => {
  await prisma.$disconnect();
});

type ExplainRow = { "QUERY PLAN": unknown };
type PlanNode = Record<string, unknown>;

function asPlanNodes(value: unknown): PlanNode[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) {
    throw new Error("EXPLAIN JSON result should be an array");
  }
  return parsed as PlanNode[];
}

function collectIndexNames(node: unknown, result = new Set<string>()): Set<string> {
  if (!node || typeof node !== "object") {
    return result;
  }
  const record = node as PlanNode;
  const indexName = record["Index Name"];
  if (typeof indexName === "string") {
    result.add(indexName);
  }
  const plans = record.Plans;
  if (Array.isArray(plans)) {
    for (const child of plans) {
      collectIndexNames(child, result);
    }
  }
  return result;
}

function indexesFromExplainRows(rows: ExplainRow[]): Set<string> {
  const indexes = new Set<string>();
  for (const row of rows) {
    for (const plan of asPlanNodes(row["QUERY PLAN"])) {
      collectIndexNames(plan.Plan, indexes);
    }
  }
  return indexes;
}

async function explainIndexNames(sql: string, ...params: unknown[]): Promise<Set<string>> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
    const rows = await tx.$queryRawUnsafe<ExplainRow[]>(
      `EXPLAIN (FORMAT JSON, COSTS OFF) ${sql}`,
      ...params,
    );
    return indexesFromExplainRows(rows);
  });
}

function assertUsesIndexes(actual: Set<string>, expected: string[]): void {
  for (const indexName of expected) {
    assert.ok(
      actual.has(indexName),
      `expected plan to use ${indexName}; used indexes: ${[...actual].sort().join(", ") || "(none)"}`,
    );
  }
}

function assertUsesAnyIndex(actual: Set<string>, expected: string[]): void {
  assert.ok(
    expected.some((indexName) => actual.has(indexName)),
    `expected plan to use one of ${expected.join(", ")}; used indexes: ${[...actual].sort().join(", ") || "(none)"}`,
  );
}

async function seedQueryPlanFixture(): Promise<{ userId: string }> {
  const userId = id("plan_user");
  await prisma.user.create({ data: { id: userId, name: "DB Plan User", role: "Reader" } });

  const now = Date.now();
  const categories = ["science", "technology", "business", "culture"];
  const levels = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const articleRows = Array.from({ length: 720 }, (_, i) => {
    const published = i % 9 !== 0;
    return {
      id: id(`plan_article_${i}`),
      title: published && i % 17 === 0 ? `Nebula planning ${i}` : `Plan article ${i}`,
      author: `Author ${i % 11}`,
      source: `Source ${i % 7}`,
      excerpt: i % 17 === 0 ? "Nebula evidence excerpt" : "Index evidence excerpt",
      content: i % 17 === 0
        ? "Nebula search evidence body with astronomy vocabulary."
        : "Representative index evidence body.",
      category: categories[i % categories.length],
      difficulty: levels[i % levels.length],
      difficultyScore: (i % 100) + 0.5,
      readingMinutes: 4,
      wordCount: 800,
      status: published ? ArticleStatus.PUBLISHED : ArticleStatus.DRAFT,
      visibility: ArticleVisibility.PUBLIC,
      publishedAt: published ? new Date(now - i * 60_000) : null,
      createdAt: new Date(now - i * 120_000),
      updatedAt: new Date(now - i * 60_000),
    };
  });
  await prisma.article.createMany({ data: articleRows });

  await prisma.readingProgress.createMany({
    data: articleRows.slice(0, 500).map((article, i) => ({
      id: id(`plan_progress_${i}`),
      userId,
      articleId: article.id,
      percent: i % 3 === 0 ? 100 : 35,
      completed: i % 3 === 0,
      completedAt: i % 3 === 0 ? new Date(now - i * 90_000) : null,
      createdAt: new Date(now - i * 120_000),
      updatedAt: new Date(now - i * 45_000),
    })),
  });

  await prisma.savedWord.createMany({
    data: Array.from({ length: 420 }, (_, i) => ({
      id: id(`plan_word_${i}`),
      userId,
      word: `planword${i}`,
      explanation: "A representative saved word for query-plan tests.",
      example: "The saved word appears in a deterministic plan fixture.",
      articleId: articleRows[i % articleRows.length].id,
      dueAt: i % 4 === 0 ? null : new Date(now - i * 30_000),
      createdAt: new Date(now - i * 60_000),
      updatedAt: new Date(now - i * 30_000),
    })),
  });

  await Promise.all([
    prisma.$executeRawUnsafe('ANALYZE "Article"'),
    prisma.$executeRawUnsafe('ANALYZE "ReadingProgress"'),
    prisma.$executeRawUnsafe('ANALYZE "SavedWord"'),
  ]);

  return { userId };
}

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
    migrations.some((migration) => migration.migration_name === "20260623004100_add_audit_logs"),
    "PostgreSQL audit-log migration should be recorded",
  );
  assert.ok(
    migrations.some((migration) => migration.migration_name === "20260623035600_query_plan_indexes"),
    "PostgreSQL query-plan index migration should be recorded",
  );
  assert.equal(migrations.filter((migration) => migration.finished_at == null).length, 0);

  const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND (
        (tablename = 'Article' AND indexname IN (
          'Article_search_vector_idx',
          'Article_public_feed_idx',
          'Article_public_category_feed_idx',
          'Article_public_level_feed_idx'
        ))
        OR (tablename = 'SavedWord' AND indexname = 'SavedWord_user_created_idx')
        OR (tablename = 'ReadingProgress' AND indexname = 'ReadingProgress_user_completedAt_idx')
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
      "Article_public_category_feed_idx",
      "Article_public_feed_idx",
      "Article_public_level_feed_idx",
      "Article_search_vector_idx",
      "AuditLog_action_createdAt_idx",
      "AuditLog_actorId_createdAt_idx",
      "AuditLog_createdAt_idx",
      "AuditLog_targetType_targetId_idx",
      "ReadingProgress_user_completedAt_idx",
      "SavedWord_user_created_idx",
    ],
  );
});

test("PostgreSQL migrations apply from scratch and preserve representative legacy rows", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const migrations = await readPostgresMigrations();
  assert.equal(migrations[0]?.name, "20260623000000_postgresql_baseline");
  const schemaName = `dbit_schema_${randomUUID().replace(/-/g, "")}`;
  const quotedSchema = quoteIdentifier(schemaName);

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA ${quotedSchema}`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${quotedSchema}, public`);

      await applySql(tx, migrations[0].sql);
      await applySql(
        tx,
        `
        INSERT INTO "User" ("id", "name", "email", "role", "updatedAt") VALUES
          ('legacy-owner-a', 'Legacy Owner A', 'legacy-a@example.invalid', 'Reader', CURRENT_TIMESTAMP),
          ('legacy-owner-b', 'Legacy Owner B', 'legacy-b@example.invalid', 'Reader', CURRENT_TIMESTAMP);

        INSERT INTO "Article" (
          "id", "slug", "title", "excerpt", "content", "sourceUrl", "status", "createdAt", "updatedAt", "ownerId"
        ) VALUES
          (
            'legacy-public',
            'legacy-public',
            'Legacy Public Article',
            'Public excerpt',
            'Migrated public article body',
            'https://example.invalid/legacy-public',
            'published',
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP,
            NULL
          ),
          (
            'legacy-private-a',
            'legacy-private-a',
            'Legacy Private Article A',
            'Private excerpt',
            'Migrated private article body',
            'https://example.invalid/legacy-private',
            'draft',
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP,
            'legacy-owner-a'
          ),
          (
            'legacy-private-b',
            'legacy-private-b',
            'Legacy Private Article B',
            'Private excerpt',
            'Migrated private article body',
            'https://example.invalid/legacy-private',
            'published',
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP,
            'legacy-owner-b'
          );

        INSERT INTO "Tag" ("id", "name", "slug", "createdAt", "updatedAt") VALUES
          ('legacy-tag-shared', 'Shared', 'shared', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
          ('legacy-tag-secret', 'Secret', 'secret', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
          ('legacy-tag-orphan', 'Orphan', 'orphan', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

        INSERT INTO "ArticleTag" ("articleId", "tagId") VALUES
          ('legacy-public', 'legacy-tag-shared'),
          ('legacy-private-a', 'legacy-tag-shared'),
          ('legacy-private-a', 'legacy-tag-secret'),
          ('legacy-private-b', 'legacy-tag-secret');

        INSERT INTO "Profile" ("id", "userId", "englishLevel", "topics", "updatedAt")
        VALUES ('legacy-profile-a', 'legacy-owner-a', 'B1', '["science","technology"]', CURRENT_TIMESTAMP);

        INSERT INTO "QuizQuestion" ("id", "articleId", "question", "options", "correctIndex", "updatedAt")
        VALUES ('legacy-quiz-a', 'legacy-private-a', 'Ready?', '["Yes","No"]', 0, CURRENT_TIMESTAMP);

        INSERT INTO "ArticleSpeech" (
          "id", "articleId", "voice", "format", "mimeType", "audioBase64", "spokenText", "words", "updatedAt"
        )
        VALUES (
          'legacy-speech-a',
          'legacy-private-a',
          'test-voice',
          'mp3',
          'audio/mpeg',
          'AA==',
          'Hello',
          '[{"textOffset":0,"length":5,"start":0,"end":0.5}]',
          CURRENT_TIMESTAMP
        );

        INSERT INTO "ReadingProgress" ("id", "userId", "articleId", "percent", "createdAt", "updatedAt")
        VALUES ('legacy-progress-a', 'legacy-owner-a', 'legacy-private-a', 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      `,
      );
      for (const migration of migrations.slice(1)) {
        await applySql(tx, migration.sql);
      }

      const rows = await tx.$queryRawUnsafe<
        Array<{ id: string; visibility: string; source_type: string; status: string; ownerId: string | null }>
      >(`
        SELECT "id", "visibility"::text AS "visibility", "sourceType"::text AS "source_type", "status"::text AS "status", "ownerId"
        FROM "Article"
        ORDER BY "id"
      `);
      assert.deepEqual(rows, [
        {
          id: "legacy-private-a",
          visibility: "PRIVATE",
          source_type: "IMPORTED",
          status: "draft",
          ownerId: "legacy-owner-a",
        },
        {
          id: "legacy-private-b",
          visibility: "PRIVATE",
          source_type: "IMPORTED",
          status: "published",
          ownerId: "legacy-owner-b",
        },
        {
          id: "legacy-public",
          visibility: "PUBLIC",
          source_type: "SCRAPED",
          status: "published",
          ownerId: null,
        },
      ]);

      const jsonRows = await tx.$queryRawUnsafe<
        Array<{ topics: unknown; options: unknown; words: unknown }>
      >(`
        SELECT p."topics", q."options", s."words"
        FROM "Profile" p
        JOIN "QuizQuestion" q ON q."id" = 'legacy-quiz-a'
        JOIN "ArticleSpeech" s ON s."id" = 'legacy-speech-a'
        WHERE p."id" = 'legacy-profile-a'
      `);
      assert.deepEqual(jsonRows[0]?.topics, ["science", "technology"]);
      assert.deepEqual(jsonRows[0]?.options, ["Yes", "No"]);
      assert.deepEqual(jsonRows[0]?.words, [{ textOffset: 0, length: 5, start: 0, end: 0.5 }]);

      const scopedTagCounts = await tx.$queryRawUnsafe<
        Array<{ public_shared: number; private_owner_a: number; private_owner_b: number; wrong_links: number }>
      >(`
        SELECT
          COUNT(*) FILTER (WHERE "slug" = 'shared' AND "scope"::text = 'PUBLIC' AND "namespace" = 'public')::int AS "public_shared",
          COUNT(*) FILTER (WHERE "scope"::text = 'PRIVATE' AND "namespace" = 'user:legacy-owner-a' AND "ownerId" = 'legacy-owner-a')::int AS "private_owner_a",
          COUNT(*) FILTER (WHERE "scope"::text = 'PRIVATE' AND "namespace" = 'user:legacy-owner-b' AND "ownerId" = 'legacy-owner-b')::int AS "private_owner_b",
          (
            SELECT COUNT(*)::int
            FROM "ArticleTag" at
            JOIN "Article" a ON a."id" = at."articleId"
            JOIN "Tag" t ON t."id" = at."tagId"
            WHERE (a."ownerId" IS NULL AND (t."scope"::text != 'PUBLIC' OR t."namespace" != 'public'))
               OR (a."ownerId" IS NOT NULL AND (t."scope"::text != 'PRIVATE' OR t."namespace" != 'user:' || a."ownerId"))
          ) AS "wrong_links"
        FROM "Tag"
      `);
      assert.deepEqual(scopedTagCounts[0], {
        public_shared: 1,
        private_owner_a: 2,
        private_owner_b: 1,
        wrong_links: 0,
      });

      const indexes = await tx.$queryRawUnsafe<Array<{ indexname: string; indexdef: string }>>(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = '${schemaName}'
          AND indexname IN ('Article_search_vector_idx', 'Article_visibility_feed_idx')
        ORDER BY indexname
      `);
      assert.deepEqual(indexes.map((index) => index.indexname), [
        "Article_search_vector_idx",
        "Article_visibility_feed_idx",
      ]);
      assert.match(indexes.find((index) => index.indexname === "Article_search_vector_idx")?.indexdef ?? "", /USING gin/i);

      await applySql(
        tx,
        `
        INSERT INTO "AuditLog" ("id", "action", "actorId", "actorRole", "targetType", "targetId", "metadata")
        VALUES ('legacy-audit-a', 'article.delete', 'legacy-owner-a', 'Reader', 'Article', 'legacy-private-a', '{"source":"migration-fixture"}');
        DELETE FROM "User" WHERE "id" = 'legacy-owner-a';
      `,
      );
      const postDelete = await tx.$queryRawUnsafe<
        Array<{ audit_logs: number; owner_articles: number; owner_tags: number; progress: number }>
      >(`
        SELECT
          (SELECT COUNT(*)::int FROM "AuditLog" WHERE "id" = 'legacy-audit-a') AS "audit_logs",
          (SELECT COUNT(*)::int FROM "Article" WHERE "ownerId" = 'legacy-owner-a') AS "owner_articles",
          (SELECT COUNT(*)::int FROM "Tag" WHERE "ownerId" = 'legacy-owner-a') AS "owner_tags",
          (SELECT COUNT(*)::int FROM "ReadingProgress" WHERE "userId" = 'legacy-owner-a') AS "progress"
      `);
      assert.deepEqual(postDelete[0], {
        audit_logs: 1,
        owner_articles: 0,
        owner_tags: 0,
        progress: 0,
      });

      await tx.$executeRawUnsafe(`DROP SCHEMA ${quotedSchema} CASCADE`);
    },
    { timeout: 60_000 },
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

test("audit logs are retained when actor or target rows are deleted", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const userId = id("audit_retention_user");
  const articleId = id("audit_retention_article");
  await prisma.user.create({ data: { id: userId, name: "DB Integration Audit Retention User" } });
  await prisma.article.create({
    data: {
      id: articleId,
      title: "Audit Retention Article",
      content: "Body",
      ownerId: userId,
      visibility: ArticleVisibility.PRIVATE,
    },
  });
  const audit = await prisma.auditLog.create({
    data: {
      action: "article.delete",
      actorId: userId,
      actorRole: "Reader",
      targetType: "Article",
      targetId: articleId,
      metadata: "{\"source\":\"integration\"}",
    },
  });

  await prisma.user.delete({ where: { id: userId } });

  const retained = await prisma.auditLog.findUnique({ where: { id: audit.id } });
  assert.equal(retained?.actorId, userId);
  assert.equal(retained?.targetId, articleId);
  assert.equal(await prisma.article.count({ where: { id: articleId } }), 0);
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

  const articleId = id("json_article");
  await prisma.article.create({
    data: {
      id: articleId,
      title: "JSON Speech Article",
      content: "Hello world",
      status: ArticleStatus.PUBLISHED,
      publishedAt: new Date(),
    },
  });
  await prisma.quizQuestion.create({
    data: { articleId, question: "Which word?", options: ["Hello", "Goodbye"], correctIndex: 0 },
  });
  await prisma.articleSpeech.create({
    data: {
      articleId,
      voice: "test",
      format: "mp3",
      mimeType: "audio/mpeg",
      audioBase64: "AA==",
      spokenText: "Hello",
      words: [{ textOffset: 0, length: 5, start: 0, end: 0.5 }],
    },
  });
  const jsonbMatches = await prisma.$queryRaw<Array<{ speech_matches: number; quiz_matches: number }>>`
    SELECT
      (SELECT COUNT(*)::int FROM "ArticleSpeech" WHERE "articleId" = ${articleId} AND "words" @> '[{"textOffset":0,"length":5}]'::jsonb) AS speech_matches,
      (SELECT COUNT(*)::int FROM "QuizQuestion" WHERE "articleId" = ${articleId} AND "options" @> '["Hello"]'::jsonb) AS quiz_matches
  `;
  assert.deepEqual(jsonbMatches[0], { speech_matches: 1, quiz_matches: 1 });
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

  await prisma.article.createMany({
    data: [
      {
        id: id("public_null_owner_a"),
        title: "Public Shared Source A",
        content: "Body",
        sourceUrl,
        visibility: ArticleVisibility.PUBLIC,
      },
      {
        id: id("public_null_owner_b"),
        title: "Public Shared Source B",
        content: "Body",
        sourceUrl,
        visibility: ArticleVisibility.PUBLIC,
      },
      {
        id: id("owner_null_source_a"),
        title: "Owned Null Source A",
        content: "Body",
        ownerId: ownerA,
        visibility: ArticleVisibility.PRIVATE,
      },
      {
        id: id("owner_null_source_b"),
        title: "Owned Null Source B",
        content: "Body",
        ownerId: ownerA,
        visibility: ArticleVisibility.PRIVATE,
      },
    ],
  });
});

test("scoped tag uniqueness allows duplicate slugs only across namespaces", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const ownerA = id("tag_owner_a");
  const ownerB = id("tag_owner_b");
  const slug = id("shared_slug");
  await prisma.user.createMany({
    data: [
      { id: ownerA, name: "DB Integration Tag Owner A", role: "Reader" },
      { id: ownerB, name: "DB Integration Tag Owner B", role: "Reader" },
    ],
  });

  await prisma.tag.create({ data: { id: id("public_tag"), name: "Public Scoped Tag", slug } });
  await assert.rejects(
    prisma.tag.create({ data: { id: id("public_tag_dup"), name: "Public Scoped Tag Duplicate", slug } }),
    /Unique constraint failed|Unique constraint|duplicate key value/,
  );

  await prisma.tag.create({
    data: {
      id: id("private_tag_a"),
      name: "Private Scoped Tag A",
      slug,
      scope: TagScope.PRIVATE,
      namespace: `user:${ownerA}`,
      ownerId: ownerA,
    },
  });
  await assert.rejects(
    prisma.tag.create({
      data: {
        id: id("private_tag_a_dup"),
        name: "Private Scoped Tag A Duplicate",
        slug,
        scope: TagScope.PRIVATE,
        namespace: `user:${ownerA}`,
        ownerId: ownerA,
      },
    }),
    /Unique constraint failed|Unique constraint|duplicate key value/,
  );

  await prisma.tag.create({
    data: {
      id: id("private_tag_b"),
      name: "Private Scoped Tag B",
      slug,
      scope: TagScope.PRIVATE,
      namespace: `user:${ownerB}`,
      ownerId: ownerB,
    },
  });

  await prisma.user.delete({ where: { id: ownerA } });
  assert.equal(await prisma.tag.count({ where: { ownerId: ownerA } }), 0);
  assert.equal(await prisma.tag.count({ where: { slug } }), 2);
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

test("PostgreSQL full-text article search is case-insensitive and privacy-filtered", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const articleId = id("fts_article");
  const ownerId = id("fts_owner");
  const privateArticleId = id("fts_private_article");
  const privateToken = id("fts_private_token");
  await prisma.user.create({ data: { id: ownerId, name: "DB Integration FTS Owner", role: "Reader" } });
  await prisma.article.create({
    data: {
      id: articleId,
      title: "Galactic Lanterns",
      content: "Astronomers study bright lantern-like stars.",
      status: ArticleStatus.PUBLISHED,
      publishedAt: new Date(),
    },
  });
  await prisma.article.create({
    data: {
      id: privateArticleId,
      title: "Private Search Article",
      content: `This private article contains ${privateToken}.`,
      ownerId,
      visibility: ArticleVisibility.PRIVATE,
      status: ArticleStatus.PUBLISHED,
      publishedAt: new Date(),
    },
  });

  const { searchPublishedArticles } = await import("@/lib/articles");
  const results = await searchPublishedArticles("galactic", { limit: 5 });
  const rawFts = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Article"
    WHERE "id" = ${articleId}
      AND to_tsvector('english', coalesce("title", '') || ' ' || coalesce("excerpt", '') || ' ' || coalesce("content", ''))
          @@ plainto_tsquery('english', 'ASTRONOMERS')
  `;

  assert.ok(results.articles.some((article) => article.id === articleId));
  assert.deepEqual(rawFts, [{ id: articleId }]);

  const anonymousPrivateResults = await searchPublishedArticles(privateToken, { limit: 5 });
  assert.equal(
    anonymousPrivateResults.articles.some((article) => article.id === privateArticleId),
    false,
  );
  const ownerPrivateResults = await searchPublishedArticles(privateToken, { limit: 5 }, ownerId);
  assert.equal(
    ownerPrivateResults.articles.some((article) => article.id === privateArticleId),
    true,
  );
});

test("worker/processor selection uses article state until a job table exists", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const publishedMissingId = id("processor_missing");
  const draftOldId = id("processor_draft_old");
  const draftNewId = id("processor_draft_new");
  const enrichedId = id("processor_enriched");
  const tagId = id("processor_tag");
  const now = new Date();
  const old = new Date(now.getTime() - 60_000);

  await prisma.article.createMany({
    data: [
      {
        id: draftOldId,
        title: "Old Draft",
        content: "Needs processing",
        status: ArticleStatus.DRAFT,
        createdAt: old,
      },
      {
        id: publishedMissingId,
        title: "Published Missing Enrichment",
        content: "Needs backfill",
        status: ArticleStatus.PUBLISHED,
        publishedAt: now,
        createdAt: new Date(now.getTime() - 30_000),
      },
      {
        id: draftNewId,
        title: "New Draft",
        content: "Needs processing",
        status: ArticleStatus.DRAFT,
        createdAt: now,
      },
      {
        id: enrichedId,
        title: "Enriched Published",
        content: "Already enriched",
        status: ArticleStatus.PUBLISHED,
        publishedAt: now,
        createdAt: new Date(now.getTime() - 15_000),
        difficulty: "B1",
        difficultyScore: 42,
      },
    ],
  });
  await prisma.tag.create({ data: { id: tagId, name: `Processor ${tagId}`, slug: tagId } });
  await Promise.all([
    prisma.articleTag.create({ data: { articleId: enrichedId, tagId } }),
    prisma.vocabularyItem.create({ data: { articleId: enrichedId, word: "enriched", explanation: "done", example: "done" } }),
    prisma.quizQuestion.create({ data: { articleId: enrichedId, question: "Done?", options: ["Yes", "No"], correctIndex: 0 } }),
  ]);

  const { listUnprocessedArticleIds } = await import("@/lib/processor");
  const draftsOnly = await listUnprocessedArticleIds();
  assert.deepEqual(
    draftsOnly.filter((articleId) => [draftOldId, draftNewId, publishedMissingId, enrichedId].includes(articleId)),
    [draftOldId, draftNewId],
  );

  const withPublishedBackfill = await listUnprocessedArticleIds({ includePublished: true });
  assert.deepEqual(
    withPublishedBackfill.filter((articleId) => [draftOldId, draftNewId, publishedMissingId, enrichedId].includes(articleId)),
    [draftOldId, publishedMissingId, draftNewId],
  );

  const jobTables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name ILIKE '%job%'
  `;
  assert.deepEqual(
    jobTables,
    [],
    "Row-level job locking tests are deferred until ADR-0005's persistent job table exists; current worker queue semantics are article-state selection only.",
  );
});

test("PostgreSQL core flow query plans use documented indexes", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const { userId } = await seedQueryPlanFixture();

  const feedIndexes = await explainIndexNames(
    `SELECT "id"
     FROM "Article"
     WHERE "status" = 'published'::"ArticleStatus"
       AND "visibility" = 'PUBLIC'::"ArticleVisibility"
       AND "ownerId" IS NULL
     ORDER BY "publishedAt" DESC, "createdAt" DESC
     LIMIT 20`,
  );
  assertUsesIndexes(feedIndexes, ["Article_public_feed_idx"]);

  const categoryIndexes = await explainIndexNames(
    `SELECT "id"
     FROM "Article"
     WHERE "status" = 'published'::"ArticleStatus"
       AND "visibility" = 'PUBLIC'::"ArticleVisibility"
       AND "ownerId" IS NULL
       AND "category" = 'science'
     ORDER BY "publishedAt" DESC, "createdAt" DESC
     LIMIT 20`,
  );
  assertUsesAnyIndex(categoryIndexes, [
    "Article_public_category_feed_idx",
    "Article_public_feed_idx",
  ]);

  const recommendationIndexes = await explainIndexNames(
    `SELECT "id"
     FROM "Article"
     WHERE "status" = 'published'::"ArticleStatus"
       AND "visibility" = 'PUBLIC'::"ArticleVisibility"
       AND "ownerId" IS NULL
       AND "difficulty" = 'B1'
     ORDER BY "difficultyScore" ASC, "publishedAt" DESC
     LIMIT 20`,
  );
  assertUsesIndexes(recommendationIndexes, ["Article_public_level_feed_idx"]);

  const workerIndexes = await explainIndexNames(
    `SELECT "id"
     FROM "Article"
     WHERE "status" = $1::"ArticleStatus"
     ORDER BY "createdAt" ASC
     LIMIT 20`,
    "draft",
  );
  assertUsesIndexes(workerIndexes, ["Article_status_created_idx"]);

  const progressIndexes = await explainIndexNames(
    `SELECT "articleId", "percent", "completed"
     FROM "ReadingProgress"
     WHERE "userId" = $1
       AND "completed" = false
     ORDER BY "updatedAt" DESC
     LIMIT 10`,
    userId,
  );
  assertUsesIndexes(progressIndexes, ["ReadingProgress_user_completed_updated_idx"]);

  const analyticsIndexes = await explainIndexNames(
    `SELECT "completedAt"
     FROM "ReadingProgress"
     WHERE "userId" = $1
       AND "completed" = true
       AND "completedAt" >= $2
     ORDER BY "completedAt" DESC
     LIMIT 50`,
    userId,
    new Date(Date.now() - 12 * 7 * 86_400_000),
  );
  assertUsesIndexes(analyticsIndexes, ["ReadingProgress_user_completedAt_idx"]);

  const savedWordsIndexes = await explainIndexNames(
    `SELECT "id", "word"
     FROM "SavedWord"
     WHERE "userId" = $1
     ORDER BY "createdAt" DESC
     LIMIT 20`,
    userId,
  );
  assertUsesIndexes(savedWordsIndexes, ["SavedWord_user_created_idx"]);

  const dueWordIndexes = await explainIndexNames(
    `SELECT "id", "word"
     FROM "SavedWord"
     WHERE "userId" = $1
       AND ("dueAt" IS NULL OR "dueAt" <= $2)
     ORDER BY "dueAt" ASC
     LIMIT 20`,
    userId,
    new Date(),
  );
  assertUsesIndexes(dueWordIndexes, ["SavedWord_due_idx"]);

  const searchIndexes = await explainIndexNames(
    `SELECT "id"
     FROM "Article"
     WHERE to_tsvector('english', coalesce("title", '') || ' ' || coalesce("excerpt", '') || ' ' || coalesce("content", ''))
       @@ plainto_tsquery('english', $1)
     LIMIT 20`,
    "nebula",
  );
  assertUsesIndexes(searchIndexes, ["Article_search_vector_idx"]);
});
