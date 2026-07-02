process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { ArticleStatus } from "@prisma/client";

const DIFFICULTY_ALGORITHM_VERSION = "deterministic-cefr/wordfreq-v1";

type Candidate = {
  id: string;
  difficulty: string | null;
  lexileApprox: number | null;
  difficultyVersion: string | null;
  translations: { targetLang: string }[];
  speech: { articleId: string } | null;
  _count: {
    tags: number;
    vocabulary: number;
    quizQuestions: number;
    grammarExplanations: number;
  };
};

type ProcessorArticle = {
  id: string;
  title: string;
  status: string;
  difficulty: string | null;
  lexileApprox: number | null;
  difficultyVersion: string | null;
  _count: { tags: number; vocabulary: number; quizQuestions: number };
  translations: { targetLang: string }[];
  speech: { articleId: string } | null;
};

let candidateRows: Candidate[] = [];
let activeDedupeKeys: string[] = [];
let articleFindManyArgs: unknown[] = [];
let jobFindManyArgs: unknown[] = [];
let transactionCalls: string[] = [];
let enqueuedJobs: Array<{ type: string; payload: Record<string, unknown>; opts: Record<string, unknown> }> = [];

let processorArticle: ProcessorArticle | null = null;
let updatedArticles: unknown[] = [];
let stateWrites: Array<{ kind: "begin" | "finish"; step: string; status?: string; meta?: unknown }> = [];
let helperFailure: string | null = null;
let listRows: Array<{ id: string }> = [];
let aiProcessableWhereArgs: unknown[] = [];

function candidate(partial: Partial<Candidate> = {}): Candidate {
  return {
    id: "article-1",
    difficulty: null,
    lexileApprox: null,
    difficultyVersion: null,
    translations: [],
    speech: null,
    _count: { tags: 0, vocabulary: 0, quizQuestions: 0, grammarExplanations: 0 },
    ...partial,
  };
}

function processorState(partial: Partial<ProcessorArticle> = {}): ProcessorArticle {
  return {
    id: "article-1",
    title: "Pipeline article",
    status: ArticleStatus.DRAFT,
    difficulty: null,
    lexileApprox: null,
    difficultyVersion: null,
    _count: { tags: 0, vocabulary: 0, quizQuestions: 0 },
    translations: [],
    speech: null,
    ...partial,
  };
}

before(() => {
  mock.module("@/lib/jobs", {
    namedExports: {
      JobType: { ARTICLE_PROCESS: "ARTICLE_PROCESS", AI_REBUILD: "AI_REBUILD" },
      ACTIVE_STATUSES: ["PENDING", "RUNNING"],
      enqueueJob: async (type: string, payload: Record<string, unknown>, opts: Record<string, unknown>) => {
        enqueuedJobs.push({ type, payload, opts });
        return { id: `job-${enqueuedJobs.length}` };
      },
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findMany: async (args: unknown) => {
            articleFindManyArgs.push(args);
            return listRows.length > 0 ? listRows : candidateRows;
          },
          update: async (args: unknown) => {
            updatedArticles.push(args);
            transactionCalls.push("article.update");
            return {};
          },
        },
        job: {
          findMany: async (args: { where: { dedupeKey: { in: string[] } } }) => {
            jobFindManyArgs.push(args);
            return args.where.dedupeKey.in
              .filter((dedupeKey) => activeDedupeKeys.includes(dedupeKey))
              .map((dedupeKey) => ({ dedupeKey }));
          },
        },
        $transaction: async (fn: (tx: Record<string, unknown>) => Promise<void>) => {
          const tx = {
            article: {
              update: async () => {
                transactionCalls.push("tx.article.update");
              },
            },
            translation: {
              deleteMany: async (args: unknown) => {
                transactionCalls.push(`tx.translation.deleteMany:${JSON.stringify(args)}`);
              },
            },
            articleSpeech: {
              deleteMany: async () => {
                transactionCalls.push("tx.articleSpeech.deleteMany");
              },
            },
            articleProcessingStep: {
              deleteMany: async (args: unknown) => {
                transactionCalls.push(`tx.articleProcessingStep.deleteMany:${JSON.stringify(args)}`);
              },
            },
            articleTag: { deleteMany: async () => transactionCalls.push("tx.articleTag.deleteMany") },
            vocabularyItem: { deleteMany: async () => transactionCalls.push("tx.vocabularyItem.deleteMany") },
            quizQuestion: { deleteMany: async () => transactionCalls.push("tx.quizQuestion.deleteMany") },
            grammarExplanation: { deleteMany: async () => transactionCalls.push("tx.grammarExplanation.deleteMany") },
          };
          await fn(tx);
        },
      },
    },
  });
  mock.module("@/lib/article-library/policy", {
    namedExports: {
      SYSTEM_ARTICLE_CONTEXT: { role: "system" },
      aiProcessableArticleWhere: (_context: unknown, where: unknown) => {
        aiProcessableWhereArgs.push(where);
        return { readable: true, ...(where as object) };
      },
      getAiProcessableArticleById: async () => processorArticle,
    },
  });
  mock.module("@/lib/processing/state", {
    namedExports: {
      beginStep: async (_articleId: string, step: string) => {
        stateWrites.push({ kind: "begin", step });
      },
      finishStep: async (_articleId: string, step: string, status: string, meta?: unknown) => {
        stateWrites.push({ kind: "finish", step, status, meta });
      },
      translationStepKey: (lang: string) => `translation:${lang}`,
    },
  });
  mock.module("@/lib/ai", {
    namedExports: {
      aiModelName: () => "test-model",
      runWithAiContext: async (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
    },
  });
  mock.module("@/lib/difficulty", {
    namedExports: {
      getOrCreateArticleDifficulty: async () => {
        if (helperFailure === "difficulty") throw new Error("difficulty failed");
        return { level: "B1", source: "deterministic" };
      },
    },
  });
  mock.module("@/lib/article-library/collections/tags", {
    namedExports: {
      getOrCreateArticleTags: async () => {
        if (helperFailure === "tags") throw new Error("tags failed");
        return { tags: [{ id: "tag-1" }], fallback: false };
      },
    },
  });
  mock.module("@/lib/vocabulary", {
    namedExports: {
      getOrCreateArticleVocabulary: async () => {
        if (helperFailure === "vocabulary") throw new Error("vocabulary failed");
        return { items: [{ word: "pipeline" }], fallback: false };
      },
    },
  });
  mock.module("@/lib/quiz", {
    namedExports: {
      getOrCreateArticleQuiz: async () => {
        if (helperFailure === "quiz") throw new Error("quiz failed");
        return { questions: [{ question: "Q?" }], fallback: false };
      },
    },
  });
  mock.module("@/lib/translation", {
    namedExports: {
      getOrCreateTranslation: async (_articleId: string, lang: string) => {
        if (helperFailure === "translation") throw new Error("translation failed");
        return { languageLabel: lang.toUpperCase(), fallback: false };
      },
    },
  });
  mock.module("@/lib/speech", {
    namedExports: {
      getOrCreateArticleSpeech: async () => {
        if (helperFailure === "speech") throw new Error("speech failed");
        return { words: [{ word: "audio" }], fallback: false };
      },
    },
  });
  mock.module("@/lib/cache", {
    namedExports: { revalidateArticlesCache: () => {} },
  });
  mock.module("@/lib/metrics", {
    namedExports: {
      recordContentProcessingRun: () => {},
      recordContentProcessingStep: () => {},
    },
  });
});

beforeEach(() => {
  candidateRows = [];
  activeDedupeKeys = [];
  articleFindManyArgs = [];
  jobFindManyArgs = [];
  transactionCalls = [];
  enqueuedJobs = [];
  processorArticle = null;
  updatedArticles = [];
  stateWrites = [];
  helperFailure = null;
  listRows = [];
  aiProcessableWhereArgs = [];
});

test("runBackfill default deps load, clear derived caches, and enqueue background rebuilds", async () => {
  const { runBackfill } = await import("@/lib/processing/backfill");
  candidateRows = [candidate()];

  const result = await runBackfill({
    features: ["difficulty", "translation", "speech"],
    mode: "rebuild",
    reason: "refresh derived data",
    operatorId: "operator-1",
    translateLangs: ["es"],
    filter: { status: "DRAFT", category: "science", articleIds: ["article-1"] },
  });

  assert.equal(result.scanned, 1);
  assert.equal(result.matched, 3);
  assert.equal(result.skippedExisting, 0);
  assert.equal(result.cleared, 1);
  assert.deepEqual(result.jobIds, ["job-1", "job-2", "job-3"]);
  assert.equal(enqueuedJobs[0].type, "AI_REBUILD");
  assert.equal(enqueuedJobs[0].opts.priority, -1);
  assert.deepEqual(enqueuedJobs.map((job) => job.payload.feature), [
    "difficulty",
    "translation:es",
    "speech",
  ]);
  assert.ok(transactionCalls.includes("tx.article.update"));
  assert.ok(transactionCalls.some((call) => call.includes("tx.translation.deleteMany")));
  assert.ok(transactionCalls.includes("tx.articleSpeech.deleteMany"));
  assert.ok(jobFindManyArgs.length > 0);
  const findArgs = articleFindManyArgs[0] as { where: Record<string, unknown>; take: number };
  assert.equal(findArgs.where.status, "DRAFT");
  assert.equal(findArgs.where.category, "science");
  assert.equal(findArgs.take, 1000);
});

test("runBackfill validates unknown feature keys before scanning", async () => {
  const { runBackfill, BackfillError } = await import("@/lib/processing/backfill");

  await assert.rejects(
    () => runBackfill({ features: ["unknown" as never], reason: "bad feature" }),
    (err: unknown) => err instanceof BackfillError && /Unknown feature/.test(err.message),
  );
  assert.equal(articleFindManyArgs.length, 0);
});

test("registry step helpers expand translations and clear all derived feature stores", async () => {
  const { FEATURE_REGISTRY, stepKeysFor } = await import("@/lib/processing/registry");
  assert.deepEqual(stepKeysFor("translation", ["es", "fr"]), ["translation:es", "translation:fr"]);
  assert.deepEqual(stepKeysFor("quiz"), ["quiz"]);

  const tx = {
    article: { update: async () => transactionCalls.push("direct.article.update") },
    articleTag: { deleteMany: async () => transactionCalls.push("direct.articleTag.deleteMany") },
    vocabularyItem: { deleteMany: async () => transactionCalls.push("direct.vocabularyItem.deleteMany") },
    quizQuestion: { deleteMany: async () => transactionCalls.push("direct.quizQuestion.deleteMany") },
    articleSpeech: { deleteMany: async () => transactionCalls.push("direct.articleSpeech.deleteMany") },
    grammarExplanation: { deleteMany: async () => transactionCalls.push("direct.grammarExplanation.deleteMany") },
  };
  for (const key of ["tags", "vocabulary", "quiz", "grammar"] as const) {
    await FEATURE_REGISTRY.find((feature) => feature.key === key)?.clearFrom?.(tx as never, "article-1");
  }

  assert.ok(transactionCalls.includes("direct.articleTag.deleteMany"));
  assert.ok(transactionCalls.includes("direct.vocabularyItem.deleteMany"));
  assert.ok(transactionCalls.includes("direct.quizQuestion.deleteMany"));
  assert.ok(transactionCalls.includes("direct.grammarExplanation.deleteMany"));
});

test("processor skips already completed feature steps and published articles", async () => {
  const { processArticle } = await import("@/lib/processing/processor");
  processorArticle = processorState({
    status: ArticleStatus.PUBLISHED,
    difficulty: "B1",
    lexileApprox: 760,
    difficultyVersion: DIFFICULTY_ALGORITHM_VERSION,
    _count: { tags: 1, vocabulary: 2, quizQuestions: 3 },
    translations: [{ targetLang: "es" }],
    speech: { articleId: "article-1" },
  });

  const result = await processArticle("article-1", { translateLangs: ["es"], tts: true });

  assert.equal(result?.ok, true);
  assert.equal(result?.published, true);
  assert.deepEqual(
    result?.steps.map((step) => [step.step, step.status]),
    [
      ["difficulty", "skipped"],
      ["tags", "skipped"],
      ["vocabulary", "skipped"],
      ["quiz", "skipped"],
      ["translation", "skipped"],
      ["tts", "skipped"],
      ["publish", "skipped"],
    ],
  );
  assert.equal(updatedArticles.length, 0);
  assert.ok(stateWrites.some((write) => write.kind === "finish" && write.status === "skipped"));
});

test("processor records failed feature steps and withholds publishing", async () => {
  const { processArticle } = await import("@/lib/processing/processor");
  processorArticle = processorState();
  helperFailure = "tags";

  const result = await processArticle("article-1", { translateLangs: ["fr"], tts: true });

  assert.equal(result?.ok, false);
  assert.equal(result?.published, false);
  assert.equal(updatedArticles.length, 0);
  const failed = result?.steps.find((step) => step.step === "tags");
  assert.equal(failed?.status, "failed");
  assert.match(failed?.detail ?? "", /tags failed/);
  assert.ok(stateWrites.some((write) => write.kind === "finish" && write.status === "failed"));
});

test("processor handles missing articles and selection queries", async () => {
  const { articleNeedsProcessing, listUnprocessedArticleIds, processArticle } =
    await import("@/lib/processing/processor");

  processorArticle = null;
  assert.equal(await processArticle("missing"), null);
  assert.equal(await articleNeedsProcessing("missing"), false);

  listRows = [{ id: "a1" }, { id: "a2" }];
  assert.deepEqual(await listUnprocessedArticleIds({ includePublished: true, limit: 2 }), ["a1", "a2"]);
  const selectArgs = articleFindManyArgs.at(-1) as { where: Record<string, unknown>; take: number };
  assert.equal(selectArgs.take, 2);
  assert.ok("OR" in (aiProcessableWhereArgs.at(-1) as Record<string, unknown>));
});
