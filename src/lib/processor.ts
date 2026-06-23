import { prisma } from "@/lib/prisma";
import { getOrCreateArticleDifficulty } from "@/lib/difficulty";
import { getOrCreateArticleVocabulary } from "@/lib/vocabulary";
import { getOrCreateArticleQuiz } from "@/lib/quiz";
import { getOrCreateArticleTags } from "@/lib/tags";
import { getOrCreateTranslation } from "@/lib/translation";
import { getOrCreateArticleSpeech } from "@/lib/speech";
import { revalidateArticlesCache } from "@/lib/cache";
import { recordContentProcessingRun, recordContentProcessingStep } from "@/lib/metrics";

/**
 * Placeholder user id used when generating the shared (per-article) vocabulary
 * cache from a back-office context (no real user). `getOrCreateArticleVocabulary`
 * only uses the user id to compute per-user "saved" flags, which we discard here;
 * the AI extraction + caching it performs is user-agnostic.
 */
const PROCESSOR_USER_ID = "__processor__";

export type StepName =
  | "difficulty"
  | "tags"
  | "vocabulary"
  | "quiz"
  | "translation"
  | "tts"
  | "publish";

export type StepStatus = "generated" | "skipped" | "fallback" | "failed";

export type StepResult = {
  step: StepName;
  status: StepStatus;
  detail?: string;
};

export type ArticleProcessResult = {
  articleId: string;
  title: string;
  published: boolean;
  steps: StepResult[];
  ok: boolean;
};

export type ProcessOptions = {
  /** Generate text-to-speech narration (slow + uses Azure Speech). */
  tts?: boolean;
  /** Target language codes to pre-generate translations for. */
  translateLangs?: string[];
};

type ArticleState = {
  id: string;
  title: string;
  status: string;
  hasDifficulty: boolean;
  tagCount: number;
  vocabCount: number;
  quizCount: number;
  translationLangs: Set<string>;
  hasSpeech: boolean;
};

async function loadArticleState(articleId: string): Promise<ArticleState | null> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: {
      id: true,
      title: true,
      status: true,
      difficulty: true,
      _count: {
        select: {
          tags: true,
          vocabulary: true,
          quizQuestions: true,
        },
      },
      translations: { select: { targetLang: true } },
      speech: { select: { articleId: true } },
    },
  });
  if (!article) {
    return null;
  }
  return {
    id: article.id,
    title: article.title,
    status: article.status,
    hasDifficulty: Boolean(article.difficulty),
    tagCount: article._count.tags,
    vocabCount: article._count.vocabulary,
    quizCount: article._count.quizQuestions,
    translationLangs: new Set(article.translations.map((t) => t.targetLang)),
    hasSpeech: Boolean(article.speech),
  };
}

async function runStep(
  step: StepName,
  alreadyDone: boolean,
  fn: () => Promise<{ fallback: boolean; detail?: string }>,
): Promise<StepResult> {
  if (alreadyDone) {
    return { step, status: "skipped" };
  }
  try {
    const { fallback, detail } = await fn();
    return { step, status: fallback ? "fallback" : "generated", detail };
  } catch (err) {
    return {
      step,
      status: "failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Enriches a single article with AI-derived content (difficulty, tags,
 * vocabulary, comprehension quiz, optional translations + TTS) and publishes it
 * when it is still a draft. Idempotent: each underlying helper is cache-first, so
 * already-completed steps are skipped and re-running is a no-op (beyond a couple
 * of cheap reads). Degrades gracefully when AI/Speech credentials are absent.
 */
export async function processArticle(
  articleId: string,
  opts: ProcessOptions = {},
): Promise<ArticleProcessResult | null> {
  const before = await loadArticleState(articleId);
  if (!before) {
    recordContentProcessingRun({ outcome: "missing" });
    return null;
  }

  const steps: StepResult[] = [];

  steps.push(
    await runStep("difficulty", before.hasDifficulty, async () => {
      const res = await getOrCreateArticleDifficulty(articleId);
      return {
        fallback: false,
        detail: res ? `${res.level} (${res.source})` : undefined,
      };
    }),
  );

  steps.push(
    await runStep("tags", before.tagCount > 0, async () => {
      const res = await getOrCreateArticleTags(articleId);
      return {
        fallback: res?.fallback ?? true,
        detail: res ? `${res.tags.length} tag(s)` : undefined,
      };
    }),
  );

  steps.push(
    await runStep("vocabulary", before.vocabCount > 0, async () => {
      const res = await getOrCreateArticleVocabulary(articleId, PROCESSOR_USER_ID);
      return {
        fallback: res?.fallback ?? true,
        detail: res ? `${res.items.length} word(s)` : undefined,
      };
    }),
  );

  steps.push(
    await runStep("quiz", before.quizCount > 0, async () => {
      const res = await getOrCreateArticleQuiz(articleId);
      return {
        fallback: res?.fallback ?? true,
        detail: res ? `${res.questions.length} question(s)` : undefined,
      };
    }),
  );

  for (const lang of opts.translateLangs ?? []) {
    steps.push(
      await runStep("translation", before.translationLangs.has(lang), async () => {
        const res = await getOrCreateTranslation(articleId, lang);
        return {
          fallback: res?.fallback ?? true,
          detail: res ? res.languageLabel : lang,
        };
      }),
    );
  }

  if (opts.tts) {
    steps.push(
      await runStep("tts", before.hasSpeech, async () => {
        const res = await getOrCreateArticleSpeech(articleId);
        return {
          fallback: res?.fallback ?? true,
          detail: res ? `${res.words.length} word timing(s)` : undefined,
        };
      }),
    );
  }

  const ok = !steps.some((s) => s.status === "failed");

  let published = before.status === "published";
  if (ok && before.status === "draft") {
    await prisma.article.update({
      where: { id: articleId },
      data: { status: "published", publishedAt: new Date() },
    });
    published = true;
    steps.push({ step: "publish", status: "generated", detail: "draft → published" });
    revalidateArticlesCache();
  } else if (before.status === "published") {
    steps.push({ step: "publish", status: "skipped", detail: "already published" });
  }

  for (const step of steps) {
    recordContentProcessingStep({ step: step.step, status: step.status });
  }
  recordContentProcessingRun({ outcome: ok ? "success" : "failed", published });

  return { articleId, title: before.title, published, steps, ok };
}

/**
 * Returns true when an article still has enrichment work outstanding: it is a
 * draft, or it is missing difficulty / tags / vocabulary / quiz content.
 * Translations and TTS are optional and not counted here.
 */
export async function articleNeedsProcessing(articleId: string): Promise<boolean> {
  const state = await loadArticleState(articleId);
  if (!state) {
    return false;
  }
  return (
    state.status === "draft" ||
    !state.hasDifficulty ||
    state.tagCount === 0 ||
    state.vocabCount === 0 ||
    state.quizCount === 0
  );
}

export type SelectOptions = {
  /** Include articles that are already published but missing enrichment. */
  includePublished?: boolean;
  /** Max number of article ids to return. */
  limit?: number;
};

/**
 * Finds article ids that need processing, oldest first. By default this targets
 * drafts (the scraper's output); pass `includePublished` to also pick up
 * published articles that are missing AI content.
 */
export async function listUnprocessedArticleIds(
  opts: SelectOptions = {},
): Promise<string[]> {
  const where = opts.includePublished
    ? {
        OR: [
          { status: "draft" },
          { difficulty: null },
          { tags: { none: {} } },
          { vocabulary: { none: {} } },
          { quizQuestions: { none: {} } },
        ],
      }
    : { status: "draft" };

  const articles = await prisma.article.findMany({
    where,
    orderBy: { createdAt: "asc" },
    select: { id: true },
    ...(opts.limit ? { take: opts.limit } : {}),
  });
  return articles.map((a) => a.id);
}
