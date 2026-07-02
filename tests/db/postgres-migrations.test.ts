import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { prisma } from "@/lib/prisma";

import { enabled, isPostgres } from "./support/db-config";
import { applySql, quoteIdentifier, readPostgresMigrations, registerIntegrationCleanup } from "./support/db-helpers";

registerIntegrationCleanup();

test("PostgreSQL baseline migration is applied and includes the article FTS index", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const migrations = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
    SELECT migration_name, finished_at
    FROM "_prisma_migrations"
    WHERE rolled_back_at IS NULL
  `;

  assert.ok(
    migrations.some((migration) => migration.migration_name === "20260625010000_init"),
    "PostgreSQL baseline migration should be recorded",
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

test("PostgreSQL baseline applies from scratch with representative rows", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const migrations = await readPostgresMigrations();
  assert.equal(migrations[0]?.name, "20260625010000_init");
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
          ('fixture-owner-a', 'Fixture Owner A', 'fixture-a@example.invalid', 'Reader', CURRENT_TIMESTAMP),
          ('fixture-owner-b', 'Fixture Owner B', 'fixture-b@example.invalid', 'Reader', CURRENT_TIMESTAMP);

        INSERT INTO "Article" (
          "id", "slug", "title", "excerpt", "content", "sourceUrl", "visibility", "sourceType", "status", "createdAt", "updatedAt", "ownerId"
        ) VALUES
          (
            'fixture-public',
            'fixture-public',
            'Fixture Public Article',
            'Public excerpt',
            'Migrated public article body',
            'https://example.invalid/fixture-public',
            'PUBLIC',
            'SCRAPED',
            'published',
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP,
            NULL
          ),
          (
            'fixture-private-a',
            'fixture-private-a',
            'Fixture Private Article A',
            'Private excerpt',
            'Migrated private article body',
            'https://example.invalid/fixture-private',
            'PRIVATE',
            'IMPORTED',
            'draft',
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP,
            'fixture-owner-a'
          ),
          (
            'fixture-private-b',
            'fixture-private-b',
            'Fixture Private Article B',
            'Private excerpt',
            'Migrated private article body',
            'https://example.invalid/fixture-private',
            'PRIVATE',
            'IMPORTED',
            'published',
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP,
            'fixture-owner-b'
          );

        INSERT INTO "Tag" ("id", "name", "slug", "createdAt", "updatedAt") VALUES
          ('fixture-tag-shared', 'Shared', 'shared', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
          ('fixture-tag-secret', 'Secret', 'secret', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
          ('fixture-tag-orphan', 'Orphan', 'orphan', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

        INSERT INTO "ArticleTag" ("articleId", "tagId") VALUES
          ('fixture-public', 'fixture-tag-shared'),
          ('fixture-private-a', 'fixture-tag-shared'),
          ('fixture-private-a', 'fixture-tag-secret'),
          ('fixture-private-b', 'fixture-tag-secret');

        INSERT INTO "Profile" ("id", "userId", "englishLevel", "topics", "updatedAt")
        VALUES ('fixture-profile-a', 'fixture-owner-a', 'B1', '["science","technology"]', CURRENT_TIMESTAMP);

        INSERT INTO "QuizQuestion" ("id", "articleId", "question", "options", "correctIndex", "updatedAt")
        VALUES ('fixture-quiz-a', 'fixture-private-a', 'Ready?', '["Yes","No"]', 0, CURRENT_TIMESTAMP);

        INSERT INTO "ArticleSpeech" (
          "id", "articleId", "voice", "format", "mimeType", "storageKey", "plainText", "words", "updatedAt"
        )
        VALUES (
          'fixture-speech-a',
          'fixture-private-a',
          'test-voice',
          'mp3',
          'audio/mpeg',
          'speech/fixture-private-a.mp3',
          'Hello',
          '[{"word":"Hello","offset":0,"duration":500}]',
          CURRENT_TIMESTAMP
        );

        INSERT INTO "ReadingProgress" ("id", "userId", "articleId", "percent", "createdAt", "updatedAt")
        VALUES ('fixture-progress-a', 'fixture-owner-a', 'fixture-private-a', 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
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
          id: "fixture-private-a",
          visibility: "PRIVATE",
          source_type: "IMPORTED",
          status: "draft",
          ownerId: "fixture-owner-a",
        },
        {
          id: "fixture-private-b",
          visibility: "PRIVATE",
          source_type: "IMPORTED",
          status: "published",
          ownerId: "fixture-owner-b",
        },
        {
          id: "fixture-public",
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
        JOIN "QuizQuestion" q ON q."id" = 'fixture-quiz-a'
        JOIN "ArticleSpeech" s ON s."id" = 'fixture-speech-a'
        WHERE p."id" = 'fixture-profile-a'
      `);
      assert.deepEqual(jsonRows[0]?.topics, ["science", "technology"]);
      assert.deepEqual(jsonRows[0]?.options, ["Yes", "No"]);
      assert.deepEqual(jsonRows[0]?.words, [{ word: "Hello", offset: 0, duration: 500 }]);

      const scopedTagCounts = await tx.$queryRawUnsafe<
        Array<{ public_shared: number; private_owner_a: number; private_owner_b: number; wrong_links: number }>
      >(`
        SELECT
          COUNT(*) FILTER (WHERE "slug" = 'shared' AND "scope"::text = 'PUBLIC' AND "namespace" = 'public')::int AS "public_shared",
          COUNT(*) FILTER (WHERE "scope"::text = 'PRIVATE' AND "namespace" = 'user:fixture-owner-a' AND "ownerId" = 'fixture-owner-a')::int AS "private_owner_a",
          COUNT(*) FILTER (WHERE "scope"::text = 'PRIVATE' AND "namespace" = 'user:fixture-owner-b' AND "ownerId" = 'fixture-owner-b')::int AS "private_owner_b",
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
        VALUES ('fixture-audit-a', 'article.delete', 'fixture-owner-a', 'Reader', 'Article', 'fixture-private-a', '{"source":"migration-fixture"}');
        DELETE FROM "User" WHERE "id" = 'fixture-owner-a';
      `,
      );
      const postDelete = await tx.$queryRawUnsafe<
        Array<{ audit_logs: number; owner_articles: number; owner_tags: number; progress: number }>
      >(`
        SELECT
          (SELECT COUNT(*)::int FROM "AuditLog" WHERE "id" = 'fixture-audit-a') AS "audit_logs",
          (SELECT COUNT(*)::int FROM "Article" WHERE "ownerId" = 'fixture-owner-a') AS "owner_articles",
          (SELECT COUNT(*)::int FROM "Tag" WHERE "ownerId" = 'fixture-owner-a') AS "owner_tags",
          (SELECT COUNT(*)::int FROM "ReadingProgress" WHERE "userId" = 'fixture-owner-a') AS "progress"
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
