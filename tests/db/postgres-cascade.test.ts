import assert from "node:assert/strict";
import { test } from "node:test";

import { ArticleStatus, ArticleVisibility } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { enabled, isPostgres } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";

registerIntegrationCleanup();

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
      data: { articleId, voice: "test", format: "mp3", mimeType: "audio/mpeg", storageKey: "speech/test.mp3", plainText: "Hello", words: [] },
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

test("ArticleMastery row is cascade-deleted when its article is deleted", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const userId = id("mastery_casc_user");
  const articleId = id("mastery_casc_article");

  await prisma.user.create({ data: { id: userId, name: "DB Integration Mastery Cascade User", role: "Reader" } });
  await prisma.article.create({
    data: {
      id: articleId,
      title: "Mastery Cascade Article",
      content: "A body long enough for reading mastery.",
      status: ArticleStatus.PUBLISHED,
      publishedAt: new Date(),
      ownerId: userId,
      visibility: ArticleVisibility.PRIVATE,
    },
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
