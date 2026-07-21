/**
 * Article processing orchestration (REF-025).
 *
 * Enriches a single article with deterministic difficulty plus AI-derived tags,
 * vocabulary, comprehension quiz, optional translations + TTS, and publishes it
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
import { DIFFICULTY_ALGORITHM_VERSION } from "@/lib/difficulty/version";
import { getOrCreateArticleVocabulary } from "@/lib/vocabulary/service";
import { getOrCreateArticleQuiz } from "@/lib/quiz";
import { getOrCreateArticleTags } from "@/lib/article-library/collections/tags";
import { getOrCreateTranslation } from "@/lib/translation";
import { getOrCreateArticleSpeech } from "@/lib/speech";
import { revalidateArticlesCache } from "@/lib/cache";
import { aiModelName, runWithAiContext } from "@/lib/ai";
import { beginStep, finishStep, translationStepKey } from "./state";
import {
  SYSTEM_ARTICLE_CONTEXT,
  aiProcessableArticleWhere,
  getAiProcessableArticleById,
} from "@/lib/article-library/policy";
import { recordContentProcessingRun, recordContentProcessingStep } from "@/lib/metrics";
import { moderateText } from "@/lib/ai/output/moderation";
import {
  decideIncrementalPublication,
  resolveProviderTrust,
  resolveSourceOwnershipOk,
  type CandidateTrustView,
  type PublicationReason,
} from "./publication-policy";
import { FEATURE_REGISTRY, type FeatureKey, type FeatureDefinition } from "./registry";

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
  fallbackReason?: string;
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
  /**
   * Publication-gate inputs (#1096). `crawlCandidates` is empty for
   * non-incremental (manual/imported) articles, which preserve the legacy
   * publish-when-ok behavior. The content string is used ONLY for in-memory
   * quality/safety screening and is NEVER logged or persisted.
   */
  crawlCandidates: CandidateTrustView[];
  wordCount: number | null;
  content: string;
  sourceUrl: string | null;
};

type StepRunnerResult = { fallback: boolean; detail?: string; fallbackReason?: string };
type StepRunner = () => Promise<StepRunnerResult>;

async function loadArticleState(articleId: string): Promise<ArticleState | null> {
  const article = await getAiProcessableArticleById(articleId, SYSTEM_ARTICLE_CONTEXT, {
    select: {
      id: true,
      title: true,
      status: true,
      difficulty: true,
      lexileApprox: true,
      difficultyVersion: true,
      _count: {
        select: {
          tags: true,
          vocabulary: true,
          quizQuestions: true,
        },
      },
      translations: { select: { targetLang: true } },
      speech: { select: { articleId: true } },
      wordCount: true,
      content: true,
      sourceUrl: true,
      crawlCandidates: {
        select: {
          providerKey: true,
          source: {
            select: {
              providerKey: true,
              autoPublishTrusted: true,
              canRepublishPublicly: true,
            },
          },
        },
      },
    },
  });
  if (!article) {
    return null;
  }
  return {
    id: article.id,
    title: article.title,
    status: article.status,
    hasDifficulty:
      Boolean(article.difficulty) &&
      article.lexileApprox != null &&
      article.difficultyVersion === DIFFICULTY_ALGORITHM_VERSION,
    tagCount: article._count.tags,
    vocabCount: article._count.vocabulary,
    quizCount: article._count.quizQuestions,
    translationLangs: new Set(article.translations.map((t) => t.targetLang)),
    hasSpeech: Boolean(article.speech),
    crawlCandidates: (article.crawlCandidates ?? []) as CandidateTrustView[],
    wordCount: article.wordCount ?? null,
    content: article.content ?? "",
    sourceUrl: article.sourceUrl ?? null,
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
  fn: StepRunner,
  persistAs: string = step,
): Promise<StepResult> {
  if (alreadyDone) {
    await finishStep(articleId, persistAs, "skipped");
    return { step, status: "skipped" };
  }
  await beginStep(articleId, persistAs);
  try {
    const { fallback, detail, fallbackReason } = await fn();
    const status: StepStatus = fallback ? "fallback" : "generated";
    await finishStep(articleId, persistAs, status, {
      modelName: aiModelName(),
      fallbackReason,
    });
    return { step, status, detail, fallbackReason };
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
 * state. Delegates to the feature's `isDoneIn` registry callback.
 * Translation is handled per-lang in the caller; grammar is on-demand only.
 */
function isAlreadyDone(feature: FeatureDefinition, state: ArticleState): boolean {
  return feature.isDoneIn?.(state) ?? false;
}

/**
 * Builds the per-feature step runner closures for a given article. Each runner
 * calls the corresponding cache-first `getOrCreate*` helper and normalises the
 * result shape. Grammar is generated on-demand and has no runner here.
 */
function buildStepRunners(
  articleId: string,
): Partial<Record<FeatureKey, StepRunner>> {
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
        fallbackReason: res?.fallbackReason,
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
        fallbackReason: res?.fallbackReason,
        detail: res ? `${res.items.length} word(s)` : undefined,
      };
    },
    quiz: async () => {
      const res = await getOrCreateArticleQuiz(articleId, SYSTEM_ARTICLE_CONTEXT);
      return {
        fallback: res?.fallback ?? true,
        fallbackReason: res?.fallbackReason,
        detail: res ? `${res.questions.length} question(s)` : undefined,
      };
    },
    speech: async () => {
      const res = await getOrCreateArticleSpeech(articleId, SYSTEM_ARTICLE_CONTEXT);
      return {
        fallback: res?.fallback ?? true,
        fallbackReason: res?.fallbackReason,
        detail: res ? `${res.words.length} word timing(s)` : undefined,
      };
    },
  };
}

async function runTranslationStep(
  articleId: string,
  lang: string,
  alreadyTranslated: boolean,
): Promise<StepResult> {
  return runStep(
    articleId,
    "translation",
    alreadyTranslated,
    async () => {
      const res = await getOrCreateTranslation(articleId, lang, SYSTEM_ARTICLE_CONTEXT);
      return {
        fallback: res?.fallback ?? true,
        fallbackReason: res?.fallbackReason,
        detail: res ? res.languageLabel : lang,
      };
    },
    translationStepKey(lang),
  );
}

async function runTranslationSteps(
  articleId: string,
  langs: string[],
  state: ArticleState,
): Promise<StepResult[]> {
  const results: StepResult[] = [];
  for (const lang of langs) {
    results.push(
      await runTranslationStep(articleId, lang, state.translationLangs.has(lang)),
    );
  }
  return results;
}

function shouldRunFeature(feature: FeatureDefinition, opts: ProcessOptions): boolean {
  if (feature.key === "grammar") return false;
  if (feature.isTts && !opts.tts) return false;
  return true;
}

function stepResultNameFor(feature: FeatureDefinition): StepName {
  return (feature.stepResultName as StepName | undefined) ?? (feature.key as StepName);
}

function persistKeyFor(feature: FeatureDefinition): string {
  return feature.isTts ? "speech" : feature.key;
}

/**
 * Minimum body word count for the publication body-quality check. Mirrors the
 * scraper ingest floor (`@/lib/scraper/quality` `MIN_WORD_COUNT`) but is declared
 * locally to respect the one-way processing↛scraper module boundary.
 */
const MIN_PUBLISH_WORD_COUNT = 50;

/**
 * Step result names of the REQUIRED enrichment features. Optional features
 * (translation, TTS) are intentionally excluded so their failure never blocks
 * publication of an otherwise-ready trusted article (#1096, requirement 4).
 */
const REQUIRED_STEP_NAMES: ReadonlySet<StepName> = new Set(
  FEATURE_REGISTRY.filter((f) => f.isRequired).map(
    (f) => stepResultNameFor(f) as StepName,
  ),
);

/**
 * Whether every REQUIRED enrichment step completed in this run (present and not
 * `failed`). Fallback steps only mean the helper degraded gracefully; the publish
 * gate separately verifies durable derived data before auto-publication.
 */
function isRequiredEnrichmentComplete(steps: StepResult[]): boolean {
  const byName = new Map(steps.map((s) => [s.step, s.status] as const));
  for (const name of REQUIRED_STEP_NAMES) {
    const status = byName.get(name);
    if (status === undefined || status === "failed") return false;
  }
  return true;
}

async function loadDurableRequiredEnrichment(articleId: string): Promise<ArticleState | null> {
  return loadArticleState(articleId);
}

function hasDurableRequiredEnrichment(state: ArticleState | null): boolean {
  if (!state) return false;
  return FEATURE_REGISTRY
    .filter((f) => f.isRequired)
    .every((feature) => isAlreadyDone(feature, state));
}

/**
 * Computes the four REQUIRED publication checks from the article's durable
 * metadata + content. Content is screened IN MEMORY only (never logged or
 * persisted). Any unverifiable signal resolves to `false` (conservative gating).
 */
function computeRequiredChecks(state: ArticleState) {
  const hasBody = state.content.trim().length > 0;
  return {
    bodyQualityOk: state.wordCount != null && state.wordCount >= MIN_PUBLISH_WORD_COUNT,
    contentSafetyOk: hasBody && !moderateText(state.content).flagged,
    sourceOwnershipOk: resolveSourceOwnershipOk(state.crawlCandidates),
    mandatoryMetadataOk:
      state.title.trim().length > 0 &&
      state.sourceUrl != null &&
      state.sourceUrl.trim().length > 0 &&
      hasBody,
  };
}

async function markPublished(articleId: string): Promise<StepResult> {
  await prisma.article.update({
    where: { id: articleId },
    data: { status: ArticleStatus.PUBLISHED, publishedAt: new Date() },
  });
  // Revalidate EXACTLY on the DRAFT → PUBLISHED state change (never on discovery).
  revalidateArticlesCache();
  return { step: "publish", status: "generated", detail: "draft → published" };
}

/**
 * Publishes a still-draft article when it is ready, gating incremental provider
 * drafts through the trusted-provider publication policy (#1096).
 *
 * - Already-published articles are a no-op.
 * - Non-incremental (manual/imported) drafts — those with NO linked crawl
 *   candidate — preserve the legacy behavior: publish when all steps succeeded.
 * - Incremental provider drafts publish ONLY when the pure policy returns
 *   `auto-publish` (explicit trust + republication permission + all required
 *   checks + required enrichment complete). Otherwise they stay DRAFT and flow
 *   through the existing human review. The recorded publish-step detail is a
 *   machine reason code — never sensitive content.
 */
async function publishDraftIfReady(
  before: ArticleState,
  requiredEnrichmentComplete: boolean,
  ok: boolean,
): Promise<{ published: boolean; publishStep?: StepResult }> {
  const { id: articleId, status } = before;

  if (status === ArticleStatus.PUBLISHED) {
    return {
      published: true,
      publishStep: { step: "publish", status: "skipped", detail: "already published" },
    };
  }
  if (status !== ArticleStatus.DRAFT) {
    return { published: false };
  }

  // Non-incremental articles (no linked candidate) keep the legacy publish gate.
  if (before.crawlCandidates.length === 0) {
    if (ok) {
      return { published: true, publishStep: await markPublished(articleId) };
    }
    return { published: false };
  }

  // Incremental provider draft: consult the pure trusted-provider policy.
  const trust = resolveProviderTrust(before.crawlCandidates);
  const checks = computeRequiredChecks(before);
  const decision = decideIncrementalPublication({ trust, checks, requiredEnrichmentComplete });

  if (decision.action === "auto-publish") {
    return { published: true, publishStep: await markPublished(articleId) };
  }
  const reason: PublicationReason = decision.reason;
  return {
    published: false,
    publishStep: { step: "publish", status: "skipped", detail: reason },
  };
}

/**
 * Enriches a single article with deterministic difficulty plus AI-derived tags,
 * vocabulary, comprehension quiz, optional translations + TTS, and publishes it
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
    if (!shouldRunFeature(feature, opts)) continue;

    if (feature.supportsLangs) {
      // Translation: expand one step per requested target language.
      steps.push(...(await runTranslationSteps(articleId, opts.translateLangs ?? [], before)));
      continue;
    }

    const runner = runners[feature.key];
    if (!runner) continue;

    // stepResultName from registry handles the "tts" vs "speech" naming convention.
    steps.push(
      await runStep(
        articleId,
        stepResultNameFor(feature),
        isAlreadyDone(feature, before),
        runner,
        persistKeyFor(feature),
      ),
    );
  }

  const ok = !steps.some((s) => s.status === "failed");
  const requiredEnrichmentComplete =
    isRequiredEnrichmentComplete(steps) &&
    hasDurableRequiredEnrichment(await loadDurableRequiredEnrichment(articleId));
  const publish = await publishDraftIfReady(before, requiredEnrichmentComplete, ok);
  if (publish.publishStep) {
    steps.push(publish.publishStep);
  }

  for (const step of steps) {
    recordContentProcessingStep({ step: step.step, status: step.status });
  }
  recordContentProcessingRun({ outcome: ok ? "success" : "failed", published: publish.published });

  return { articleId, title: before.title, published: publish.published, steps, ok };
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
    .some((f) => !isAlreadyDone(f, state));
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
          { lexileApprox: null },
          { difficultyVersion: null },
          { difficultyVersion: { not: DIFFICULTY_ALGORITHM_VERSION } },
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
