import assert from "node:assert/strict";
import { test } from "node:test";

import { ArticleStatus, ArticleVisibility } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { enabled, isPostgres } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";

registerIntegrationCleanup();

const POSTGRES_REQUIRED = "test:db requires a PostgreSQL DATABASE_URL";

type CountCase = readonly [label: string, count: () => Promise<number>];

function requirePostgres(): void {
  assert.equal(isPostgres, true, POSTGRES_REQUIRED);
}

async function createPublishedPrivateArticle({
  articleId,
  ownerId,
  title,
  content,
}: {
  articleId: string;
  ownerId: string;
  title: string;
  content: string;
}): Promise<void> {
  await prisma.article.create({
    data: {
      id: articleId,
      title,
      content,
      status: ArticleStatus.PUBLISHED,
      publishedAt: new Date(),
      ownerId,
      visibility: ArticleVisibility.PRIVATE,
    },
  });
}

function derivedArticleCounts(articleId: string): CountCase[] {
  return [
    ["article tags", () => prisma.articleTag.count({ where: { articleId } })],
    ["translations", () => prisma.translation.count({ where: { articleId } })],
    ["sentence translations", () => prisma.sentenceTranslation.count({ where: { articleId } })],
    ["vocabulary", () => prisma.vocabularyItem.count({ where: { articleId } })],
    ["quiz questions", () => prisma.quizQuestion.count({ where: { articleId } })],
    ["speech", () => prisma.articleSpeech.count({ where: { articleId } })],
    ["progress", () => prisma.readingProgress.count({ where: { articleId } })],
    ["reading list items", () => prisma.readingListItem.count({ where: { articleId } })],
    ["highlights", () => prisma.highlight.count({ where: { articleId } })],
    ["tutor messages", () => prisma.tutorMessage.count({ where: { articleId } })],
    ["quiz attempts", () => prisma.quizAttempt.count({ where: { articleId } })],
    ["pronunciation attempts", () => prisma.pronunciationAttempt.count({ where: { articleId } })],
    ["grammar explanations", () => prisma.grammarExplanation.count({ where: { articleId } })],
    ["difficulty feedback", () => prisma.articleDifficultyFeedback.count({ where: { articleId } })],
  ];
}

async function assertAllCascadeDeleted(cases: CountCase[]): Promise<void> {
  const counts = await Promise.all(cases.map(([, count]) => count()));
  cases.forEach(([label], index) => {
    assert.equal(counts[index], 0, `${label} should be cascade-deleted with the article`);
  });
}

test("article deletes cascade derived data but keep saved-word study history", { skip: !enabled }, async () => {
  requirePostgres();

  const userId = id("cascade_user");
  const articleId = id("cascade_article");
  const tagId = id("cascade_tag");

  await prisma.user.create({ data: { id: userId, name: "DB Integration User", role: "Reader" } });
  await createPublishedPrivateArticle({
    articleId,
    ownerId: userId,
    title: "Cascade Article",
    content: "A long enough body for derived data.",
  });
  await prisma.tag.create({ data: { id: tagId, name: `Integration ${tagId}`, slug: tagId } });

  await Promise.all([
    prisma.articleTag.create({ data: { articleId, tagId } }),
    prisma.translation.create({ data: { articleId, targetLang: "es", content: "Texto" } }),
    prisma.sentenceTranslation.create({
      data: {
        articleId,
        sourceHash: id("hash"),
        targetLang: "es",
        sourceText: "Hello",
        translation: "Hola",
      },
    }),
    prisma.vocabularyItem.create({
      data: { articleId, word: "cascade", explanation: "test", example: "cascade test" },
    }),
    prisma.quizQuestion.create({
      data: { articleId, question: "Question?", options: ["A", "B"], correctIndex: 0 },
    }),
    prisma.articleSpeech.create({
      data: {
        articleId,
        format: "mp3",
        mimeType: "audio/mpeg",
        storageKey: "speech/test.mp3",
        words: [],
      },
    }),
    prisma.readingProgress.create({ data: { userId, articleId, percent: 50 } }),
    prisma.readingList.create({
      data: { id: id("list"), userId, name: "Integration List", items: { create: { articleId } } },
    }),
    prisma.highlight.create({ data: { userId, articleId, quote: "long", startOffset: 0, endOffset: 4 } }),
    prisma.tutorMessage.create({ data: { userId, articleId, role: "user", content: "Explain this." } }),
    prisma.quizAttempt.create({ data: { userId, articleId, correctCount: 1, totalQuestions: 2, scorePct: 50 } }),
    prisma.pronunciationAttempt.create({
      data: {
        userId,
        articleId,
        referenceText: "Hello",
        accuracyScore: 90,
        fluencyScore: 90,
        completenessScore: 90,
        pronScore: 90,
      },
    }),
    prisma.grammarExplanation.create({ data: { articleId, phrase: "because of", explanation: "Grammar note" } }),
    prisma.articleDifficultyFeedback.create({ data: { userId, articleId, vote: "just_right" } }),
    prisma.savedWord.create({ data: { userId, word: "cascade", articleId, explanation: "study item" } }),
  ]);

  await prisma.article.delete({ where: { id: articleId } });

  await assertAllCascadeDeleted(derivedArticleCounts(articleId));
  const savedWord = await prisma.savedWord.findUnique({ where: { userId_word: { userId, word: "cascade" } } });
  assert.equal(savedWord?.articleId, articleId);
});

test("ArticleMastery row is cascade-deleted when its article is deleted", { skip: !enabled }, async () => {
  requirePostgres();

  const userId = id("mastery_casc_user");
  const articleId = id("mastery_casc_article");

  await prisma.user.create({ data: { id: userId, name: "DB Integration Mastery Cascade User", role: "Reader" } });
  await createPublishedPrivateArticle({
    articleId,
    ownerId: userId,
    title: "Mastery Cascade Article",
    content: "A body long enough for reading mastery.",
  });
  await prisma.articleMastery.create({
    data: {
      userId,
      articleId,
      readingCompletion: 0.75,
      timeSpentMs: 120_000,
      comprehensionScore: 0.8,
    },
  });

  assert.equal(await prisma.articleMastery.count({ where: { articleId } }), 1);

  await prisma.article.delete({ where: { id: articleId } });

  assert.equal(
    await prisma.articleMastery.count({ where: { articleId } }),
    0,
    "ArticleMastery should be cascade-deleted with its article",
  );
});
