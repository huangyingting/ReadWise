import assert from "node:assert/strict";
import { test } from "node:test";

import { ArticleStatus, ArticleVisibility, TagScope } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { enabled, isPostgres } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";

registerIntegrationCleanup();

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

test("PostgreSQL JSON fields use jsonb columns", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

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
      plainText: "Hello",
      words: [{ word: "Hello", offset: 0, duration: 500 }],
    },
  });
  const jsonbMatches = await prisma.$queryRaw<Array<{ speech_matches: number; quiz_matches: number }>>`
    SELECT
      (SELECT COUNT(*)::int FROM "ArticleSpeech" WHERE "articleId" = ${articleId} AND "words" @> '[{"word":"Hello","offset":0}]'::jsonb) AS speech_matches,
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
