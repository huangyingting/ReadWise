process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { ArticleStatus } from "@prisma/client";
import { DIFFICULTY_ALGORITHM_VERSION } from "@/lib/difficulty/version";

type TrustSource = {
  providerKey: string;
  autoPublishTrusted: boolean;
  canRepublishPublicly: boolean;
} | null;

type GateArticle = {
  id: string;
  title: string;
  status: ArticleStatus;
  difficulty: string | null;
  lexileApprox: number | null;
  difficultyVersion: string | null;
  _count: { tags: number; vocabulary: number; quizQuestions: number };
  translations: { targetLang: string }[];
  speech: { articleId: string } | null;
  wordCount: number | null;
  content: string;
  sourceUrl: string | null;
  crawlCandidates: { providerKey: string; source: TrustSource }[];
};

let article: GateArticle;
let updateCalls: Array<Record<string, unknown>> = [];
let revalidateCalls = 0;
let speechFails = false;
let quizFails = false;
let tagsFallback = false;
let vocabularyFallback = false;
let quizFallback = false;

// >= 50 words of benign prose so the body-quality + content-safety checks pass.
const SAFE_BODY =
  "This is a calm and ordinary article about gardening in the spring. " +
  "It describes how to plant seeds, water them gently, and wait for them to grow. " +
  "The writer explains that patience and sunlight help the small green shoots become " +
  "healthy plants over many weeks of careful and steady attention in the quiet garden.";

function makeArticle(overrides: Partial<GateArticle> = {}): GateArticle {
  return {
    id: "article-gate-1",
    title: "Spring gardening basics",
    status: ArticleStatus.DRAFT,
    difficulty: null,
    lexileApprox: null,
    difficultyVersion: null,
    _count: { tags: 0, vocabulary: 0, quizQuestions: 0 },
    translations: [],
    speech: null,
    wordCount: 60,
    content: SAFE_BODY,
    sourceUrl: "https://provider.example/story",
    crawlCandidates: [
      {
        providerKey: "trusted-provider",
        source: {
          providerKey: "trusted-provider",
          autoPublishTrusted: true,
          canRepublishPublicly: true,
        },
      },
    ],
    ...overrides,
  };
}

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findFirst: async () => article,
          update: async (args: Record<string, unknown>) => {
            updateCalls.push(args);
            article.status = ArticleStatus.PUBLISHED;
            return {};
          },
          findMany: async () => [],
        },
      },
    },
  });
  mock.module("@/lib/cache", {
    namedExports: {
      revalidateArticlesCache: () => {
        revalidateCalls += 1;
      },
    },
  });
  mock.module("@/lib/difficulty", {
    namedExports: {
      getOrCreateArticleDifficulty: async () => {
        article.difficulty = "B1";
        article.lexileApprox = 760;
        article.difficultyVersion = DIFFICULTY_ALGORITHM_VERSION;
        return { level: "B1", source: "deterministic" };
      },
    },
  });
  mock.module("@/lib/article-library/collections/tags", {
    namedExports: {
      getOrCreateArticleTags: async () => {
        if (tagsFallback) return { tags: [], fallback: true, fallbackReason: "provider_unconfigured" };
        article._count.tags = 1;
        return { tags: [{ id: "t1" }], fallback: false };
      },
    },
  });
  mock.module("@/lib/vocabulary/service", {
    namedExports: {
      getOrCreateArticleVocabulary: async () => {
        if (vocabularyFallback) return { items: [], fallback: true, fallbackReason: "provider_unconfigured" };
        article._count.vocabulary = 1;
        return { items: [{ word: "seed" }], fallback: false };
      },
    },
  });
  mock.module("@/lib/quiz", {
    namedExports: {
      getOrCreateArticleQuiz: async () => {
        if (quizFails) throw new Error("quiz failed");
        if (quizFallback) return { questions: [], fallback: true, fallbackReason: "provider_unconfigured" };
        article._count.quizQuestions = 1;
        return { questions: [{ question: "Q?" }], fallback: false };
      },
    },
  });
  mock.module("@/lib/translation", {
    namedExports: {
      getOrCreateTranslation: async (_id: string, lang: string) => ({
        languageLabel: lang.toUpperCase(),
        fallback: false,
      }),
    },
  });
  mock.module("@/lib/speech", {
    namedExports: {
      getOrCreateArticleSpeech: async () => {
        if (speechFails) throw new Error("speech unavailable");
        return { words: [{ word: "seed" }], fallback: false };
      },
    },
  });
});

beforeEach(() => {
  article = makeArticle();
  updateCalls = [];
  revalidateCalls = 0;
  speechFails = false;
  quizFails = false;
  tagsFallback = false;
  vocabularyFallback = false;
  quizFallback = false;
});

function publishStep(steps: Array<{ step: string; status: string; detail?: string }>) {
  return steps.find((s) => s.step === "publish");
}

test("trusted provider draft auto-publishes and revalidates cache exactly once", async () => {
  const { processArticle } = await import("@/lib/processing/processor");
  const result = await processArticle("article-gate-1");

  assert.equal(result?.published, true);
  assert.equal(updateCalls.length, 1);
  assert.equal(revalidateCalls, 1);
  assert.equal(publishStep(result!.steps)?.status, "generated");
});

test("untrusted provider draft stays in review with a machine reason and no cache change", async () => {
  article = makeArticle({
    crawlCandidates: [
      {
        providerKey: "untrusted-provider",
        source: {
          providerKey: "untrusted-provider",
          autoPublishTrusted: false,
          canRepublishPublicly: false,
        },
      },
    ],
  });
  const { processArticle } = await import("@/lib/processing/processor");
  const result = await processArticle("article-gate-1");

  assert.equal(result?.published, false);
  assert.equal(updateCalls.length, 0);
  assert.equal(revalidateCalls, 0);
  const step = publishStep(result!.steps);
  assert.equal(step?.status, "skipped");
  assert.equal(step?.detail, "provider-not-auto-publish-trusted");
});

test("authenticated-only provider (no republish right) can never auto-publish", async () => {
  article = makeArticle({
    crawlCandidates: [
      {
        providerKey: "auth-provider",
        source: {
          providerKey: "auth-provider",
          autoPublishTrusted: true,
          canRepublishPublicly: false,
        },
      },
    ],
  });
  const { processArticle } = await import("@/lib/processing/processor");
  const result = await processArticle("article-gate-1");

  assert.equal(result?.published, false);
  assert.equal(updateCalls.length, 0);
  assert.equal(publishStep(result!.steps)?.detail, "public-republication-not-permitted");
});

test("failed OPTIONAL enrichment (TTS) does not block a publishable trusted article", async () => {
  speechFails = true;
  const { processArticle } = await import("@/lib/processing/processor");
  const result = await processArticle("article-gate-1", { tts: true });

  // Optional step failed → run is not ok (still retryable), but publication is
  // decoupled from optional enrichment, so the trusted article still publishes.
  assert.equal(result?.ok, false);
  assert.equal(result?.published, true);
  assert.equal(updateCalls.length, 1);
  assert.equal(result?.steps.find((s) => s.step === "tts")?.status, "failed");
});

test("failed REQUIRED enrichment (quiz) keeps a trusted draft in review", async () => {
  quizFails = true;
  const { processArticle } = await import("@/lib/processing/processor");
  const result = await processArticle("article-gate-1");

  assert.equal(result?.published, false);
  assert.equal(updateCalls.length, 0);
  assert.equal(publishStep(result!.steps)?.detail, "required-enrichment-incomplete");
});

test("empty fallback REQUIRED enrichment keeps a trusted draft in review", async () => {
  tagsFallback = true;
  vocabularyFallback = true;
  quizFallback = true;
  const { processArticle } = await import("@/lib/processing/processor");
  const result = await processArticle("article-gate-1");

  assert.equal(result?.published, false);
  assert.equal(updateCalls.length, 0);
  assert.equal(publishStep(result!.steps)?.detail, "required-enrichment-incomplete");
  assert.equal(result?.steps.find((s) => s.step === "tags")?.status, "fallback");
  assert.equal(result?.steps.find((s) => s.step === "vocabulary")?.status, "fallback");
  assert.equal(result?.steps.find((s) => s.step === "quiz")?.status, "fallback");
});

test("trusted draft with unsafe body content stays in review (content-safety check)", async () => {
  article = makeArticle({
    content: "Detailed instructions for how to make a bomb at home using common chemicals.",
    wordCount: 60,
  });
  const { processArticle } = await import("@/lib/processing/processor");
  const result = await processArticle("article-gate-1");

  assert.equal(result?.published, false);
  assert.equal(publishStep(result!.steps)?.detail, "required-check-failed:content-safety");
});

test("trusted draft with too-thin body stays in review (body-quality check)", async () => {
  article = makeArticle({ wordCount: 10 });
  const { processArticle } = await import("@/lib/processing/processor");
  const result = await processArticle("article-gate-1");

  assert.equal(result?.published, false);
  assert.equal(publishStep(result!.steps)?.detail, "required-check-failed:body-quality");
});

test("orphaned source chain fails the source-ownership check", async () => {
  article = makeArticle({
    crawlCandidates: [{ providerKey: "trusted-provider", source: null }],
  });
  const { processArticle } = await import("@/lib/processing/processor");
  const result = await processArticle("article-gate-1");

  // Trust resolves to untrusted first (source null), so the trust gate reports.
  assert.equal(result?.published, false);
  assert.equal(publishStep(result!.steps)?.detail, "provider-not-auto-publish-trusted");
});

test("already-published article is a no-op (no re-publish, no cache change)", async () => {
  article = makeArticle({
    status: ArticleStatus.PUBLISHED,
    difficulty: "B1",
    lexileApprox: 760,
    difficultyVersion: DIFFICULTY_ALGORITHM_VERSION,
    _count: { tags: 1, vocabulary: 1, quizQuestions: 1 },
  });
  const { processArticle } = await import("@/lib/processing/processor");
  const result = await processArticle("article-gate-1");

  assert.equal(result?.published, true);
  assert.equal(updateCalls.length, 0);
  assert.equal(revalidateCalls, 0);
  assert.equal(publishStep(result!.steps)?.status, "skipped");
});

test("non-incremental draft (no candidates) preserves legacy publish-when-ok", async () => {
  article = makeArticle({ crawlCandidates: [] });
  const { processArticle } = await import("@/lib/processing/processor");
  const result = await processArticle("article-gate-1");

  assert.equal(result?.published, true);
  assert.equal(updateCalls.length, 1);
  assert.equal(revalidateCalls, 1);
});
