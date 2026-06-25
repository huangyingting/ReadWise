/**
 * Article processing orchestration (REF-025).
 *
 * Enriches a single article with AI-derived content (difficulty, tags,
 * vocabulary, comprehension quiz, optional translations + TTS) and publishes it
 * when it is still a draft. Idempotent: each underlying helper is cache-first,
 * so already-completed steps are skipped and re-running is a no-op (beyond a
 * couple of cheap reads). Degrades gracefully when AI/Speech credentials are
 * absent.
 *
 * `processArticle` iterates the canonical FEATURE_REGISTRY so step ordering and
 * availability stay in sync with the registry. Adding a new feature requires a
 * registry entry and a STEP_RUNNERS entry here — no other files need editing.
 */
import { prisma } from "@/lib/prisma";
import { ArticleStatus } from "@prisma/client";
import { getOrCreateArticleDifficulty } from "@/lib/difficulty";
import { getOrCreateArticleVocabulary } from "@/lib/vocabulary";
import { getOrCreateArticleQuiz } from "@/lib/quiz";
import { getOrCreateArticleTags } from "@/lib/tags";
import { getOrCreateTranslation } from "@/lib/translation";
import { getOrCreateArticleSpeech } from "@/lib/speech";
import { revalidateArticlesCache } from "@/lib/cache";
import { aiModelName } from "@/lib/ai";
import { beginStep, finishStep, translationStepKey } from "./state";
import { runWithAiContext } from "@/lib/ai-budget";
import {
  SYSTEM_ARTICLE_CONTEXT,
  aiProcessableArticleWhere,
  getAiProcessableArticleById,
} from "@/lib/article-access";
import { recordContentProcessingRun, recordContentProcessingStep } from "@/lib/metrics";
import { FEATURE_REGISTRY, type FeatureKey } from "./registry";

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
  const article = await getAiProcessableArticleById(articleId, SYSTEM_ARTICLE_CONTEXT, {
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

/**
 * Runs a single enrichment step and records its durable processing state
 * (RW-016). `persistAs` is the step key written to `ArticleProcessingStep`
 * (defaults to `step`; translations pass a language-scoped key). State writes
 * are best-effort and never affect the returned {@link StepResult}.
 */
async function runStep(
  articleId: string,
  step: StepName,
  alreadyDone: boolean,
  fn: () => Promise<{ fallback: boolean; detail?: string }>,
  persistAs: string = step,
): Promise<StepResult> {
  if (alreadyDone) {
    await finishStep(articleId, persistAs, "skipped");
    return { step, status: "skipped" };
  }
  await beginStep(articleId, persistAs);
  try {
    const { fallback, detail } = await fn();
    const status: StepStatus = fallback ? "fallback" : "generated";
    await finishStep(articleId, persistAs, status, { modelName: aiModelName() });
    return { step, status, detail };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishStep(articleId, persistAs, "failed", { lastError: message });
    return {
      step,
      status: "failed",
      detail: message,
    };
  }
}

/**
 * Returns whether a feature has already been computed for the given article
 * state. Translation is handled per-lang in the caller; grammar is on-demand
 * only and never runs here.
 */
function isAlreadyDone(key: FeatureKey, state: ArticleState): boolean {
  switch (key) {
    case "difficulty":  return state.hasDifficulty;
    case "tags":        return state.tagCount > 0;
    case "vocabulary":  return state.vocabCount > 0;
    case "quiz":        return state.quizCount > 0;
    case "speech":      return state.hasSpeech;
    default:            return false;
  }
}

/**
 * Builds the per-feature step runner closures for a given article. Each runner
 * calls the corresponding cache-first `getOrCreate*` helper and normalises the
 * result shape. Grammar is generated on-demand and has no runner here.
 */
function buildStepRunners(
  articleId: string,
): Partial<Record<FeatureKey, () => Promise<{ fallback: boolean; detail?: string }>>> {
  return {
    difficulty: async () => {
      const res = await getOrCreateArticleDifficulty(articleId, SYSTEM_ARTICLE_CONTEXT);
      return {
        fallback: false,
        detail: res ? `${res.level} (${res.source})` : undefined,
      };
    },
    tags: async () => {
      const res = await getOrCreateArticleTags(articleId, SYSTEM_ARTICLE_CONTEXT);
      return {
        fallback: res?.fallback ?? true,
        detail: res ? `${res.tags.length} tag(s)` : undefined,
      };
    },
    vocabulary: async () => {
      const res = await getOrCreateArticleVocabulary(
        articleId,
        PROCESSOR_USER_ID,
        SYSTEM_ARTICLE_CONTEXT,
      );
      return {
        fallback: res?.fallback ?? true,
        detail: res ? `${res.items.length} word(s)` : undefined,
      };
    },
    quiz: async () => {
      const res = await getOrCreateArticleQuiz(articleId, SYSTEM_ARTICLE_CONTEXT);
      return {
        fallback: res?.fallback ?? true,
        detail: res ? `${res.questions.length} question(s)` : undefined,
      };
    },
    speech: async () => {
      const res = await getOrCreateArticleSpeech(articleId, SYSTEM_ARTICLE_CONTEXT);
      return {
        fallback: res?.fallback ?? true,
        detail: res ? `${res.words.length} word timing(s)` : undefined,
      };
    },
  };
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
  // Mark every AI call in this enrichment run as background work so it enforces
  // the global-background + per-feature AI budgets (RW-022) and skips gracefully
  // (instead of throwing) when a budget is exhausted.
  return runWithAiContext({ kind: "background" }, () => processArticleInner(articleId, opts));
}

async function processArticleInner(
  articleId: string,
  opts: ProcessOptions = {},
): Promise<ArticleProcessResult | null> {
  const before = await loadArticleState(articleId);
  if (!before) {
    recordContentProcessingRun({ outcome: "missing" });
    return null;
  }

  const steps: StepResult[] = [];
  const runners = buildStepRunners(articleId);

  for (const feature of FEATURE_REGISTRY) {
    // Grammar is generated on-demand via the reader UI; skip in the pipeline.
    if (feature.key === "grammar") continue;

    if (feature.supportsLangs) {
      // Translation: expand one step per requested target language.
      for (const lang of opts.translateLangs ?? []) {
        steps.push(
          await runStep(
            articleId,
            "translation",
            before.translationLangs.has(lang),
            async () => {
              const res = await getOrCreateTranslation(articleId, lang, SYSTEM_ARTICLE_CONTEXT);
              return {
                fallback: res?.fallback ?? true,
                detail: res ? res.languageLabel : lang,
              };
            },
            translationStepKey(lang),
          ),
        );
      }
      continue;
    }

    // TTS/speech: only when opts.tts is requested.
    if (feature.isTts && !opts.tts) continue;

    const runner = runners[feature.key];
    if (!runner) continue;

    // The speech feature uses "tts" as the StepResult.step name for external
    // consumers (scripts, admin UI), but persists under "speech" in the DB.
    const stepName: StepName = feature.isTts ? "tts" : (feature.key as StepName);
    const persistKey = feature.isTts ? "speech" : feature.key;

    steps.push(
      await runStep(
        articleId,
        stepName,
        isAlreadyDone(feature.key, before),
        runner,
        persistKey,
      ),
    );
  }

  const ok = !steps.some((s) => s.status === "failed");

  let published = before.status === ArticleStatus.PUBLISHED;
  if (ok && before.status === ArticleStatus.DRAFT) {
    await prisma.article.update({
      where: { id: articleId },
      data: { status: ArticleStatus.PUBLISHED, publishedAt: new Date() },
    });
    published = true;
    steps.push({ step: "publish", status: "generated", detail: "draft → published" });
    revalidateArticlesCache();
  } else if (before.status === ArticleStatus.PUBLISHED) {
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
 * draft, or it is missing any required feature (difficulty, tags, vocabulary,
 * quiz). Translations and TTS are optional and not counted here.
 */
export async function articleNeedsProcessing(articleId: string): Promise<boolean> {
  const state = await loadArticleState(articleId);
  if (!state) {
    return false;
  }
  if (state.status === ArticleStatus.DRAFT) return true;
  return FEATURE_REGISTRY
    .filter((f) => f.isRequired)
    .some((f) => !isAlreadyDone(f.key, state));
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
          { status: ArticleStatus.DRAFT },
          { difficulty: null },
          { tags: { none: {} } },
          { vocabulary: { none: {} } },
          { quizQuestions: { none: {} } },
        ],
      }
    : { status: ArticleStatus.DRAFT };

  const articles = await prisma.article.findMany({
    where: aiProcessableArticleWhere(SYSTEM_ARTICLE_CONTEXT, where),
    orderBy: { createdAt: "asc" },
    select: { id: true },
    ...(opts.limit ? { take: opts.limit } : {}),
  });
  return articles.map((a) => a.id);
}
