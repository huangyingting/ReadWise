/**
 * Authoring for article reading-level variants (#1303): manual saves,
 * deletion, and AI adaptation for the LEVEL_ADAPT job. When AI is
 * unconfigured adaptation is skipped so staff add the level manually.
 * Article text is never logged.
 */
import { prisma } from "@/lib/prisma";
import { chatComplete, isAiConfigured } from "@/lib/ai";
import { renderPrompt, promptModelParams, activePromptVersion } from "@/lib/ai/prompts";
import { boundedSampleForFeature } from "@/lib/ai/chunking";
import { extractJsonArray } from "@/lib/ai/output/validators";
import { articleHtmlToReaderText } from "@/lib/content-pipeline";
import { deterministicDifficulty } from "@/lib/difficulty";
import { loadAiProcessableArticleText } from "@/lib/article-library/policy";
import { LEVEL_NOMINAL_LEXILE, type ArticleLevelKey } from "./levels";
import {
  DEFAULT_LANGUAGE,
  LEVEL_TITLE_MAX_LENGTH,
  SUMMARY_SELECT,
  getArticleLevelVariant,
  paragraphsToHtml,
  textToParagraphs,
  type ArticleLevelSummary,
} from "./variants";

const MAX_GENERATED_PARAGRAPHS = 80;

export type LevelSaveFailure = { ok: false; status: 400 | 404; reason: "empty_level" | "not_found" };

/**
 * Creates or replaces an adapted level from plain-text paragraphs. Clears the
 * level's quiz when the text changes so questions are regenerated against it.
 */
export async function saveArticleLevel(
  articleId: string,
  levelKey: ArticleLevelKey,
  input: { title: string; text: string },
  options: { actorId: string | null; source: "manual" | "ai" },
): Promise<{ ok: true; level: ArticleLevelSummary } | LevelSaveFailure> {
  const article = await prisma.article.findUnique({ where: { id: articleId }, select: { id: true } });
  if (!article) return { ok: false, status: 404, reason: "not_found" };
  const paragraphs = textToParagraphs(input.text);
  const title = input.title.trim();
  if (paragraphs.length === 0 || !title) return { ok: false, status: 400, reason: "empty_level" };

  const content = paragraphsToHtml(paragraphs);
  const measured = deterministicDifficulty(content);
  const data = {
    title,
    content,
    wordCount: measured.metrics.wordCount,
    lexileApprox: measured.lexileApprox,
    cefrLevel: measured.level,
    source: options.source,
    updatedById: options.actorId,
  };
  const key = { articleId_levelKey_language: { articleId, levelKey, language: DEFAULT_LANGUAGE } };
  const level = await prisma.$transaction(async (tx) => {
    const existing = await tx.articleLevel.findUnique({ where: key, select: { content: true } });
    if (existing && existing.content !== content) {
      await tx.quizQuestion.deleteMany({ where: { articleId, levelKey } });
    }
    return tx.articleLevel.upsert({
      where: key,
      create: { articleId, levelKey, language: DEFAULT_LANGUAGE, ...data },
      update: data,
      select: SUMMARY_SELECT,
    });
  });
  return { ok: true, level: { ...level, levelKey } };
}

/** Removes an adapted level and its quiz. Learners' highlights on it remain in their notes. */
export async function deleteArticleLevel(articleId: string, levelKey: ArticleLevelKey): Promise<boolean> {
  const [{ count }] = await prisma.$transaction([
    prisma.articleLevel.deleteMany({ where: { articleId, levelKey, language: DEFAULT_LANGUAGE } }),
    prisma.quizQuestion.deleteMany({ where: { articleId, levelKey } }),
  ]);
  return count > 0;
}

// ---------------------------------------------------------------------------
// AI adaptation (LEVEL_ADAPT job)
// ---------------------------------------------------------------------------

export type LevelAdaptOutcome =
  | { status: "generated"; level: ArticleLevelSummary }
  | { status: "skipped"; reason: "provider_unconfigured" | "already_exists" }
  | { status: "failed"; reason: "article_not_found" | "provider_error" | "validation_failed" };

/** Parses `["headline", "paragraph", ...]` model output. */
export function parseLevelAdaptation(completion: string): { title: string; paragraphs: string[] } | null {
  const items = extractJsonArray(completion);
  if (!items || items.length < 2 || !items.every((item) => typeof item === "string")) return null;
  const [title, ...rest] = (items as string[]).map((item) => item.replace(/\s+/g, " ").trim());
  const paragraphs = rest.filter(Boolean).slice(0, MAX_GENERATED_PARAGRAPHS);
  if (!title || title.length > LEVEL_TITLE_MAX_LENGTH || paragraphs.length === 0) return null;
  return { title, paragraphs };
}

/**
 * Generates an adapted level with the AI provider. Never overwrites a level
 * unless `replace` is set (manual edits win). When AI is unconfigured the
 * outcome is "skipped" so staff add the level manually.
 */
export async function adaptArticleLevel(
  articleId: string,
  levelKey: ArticleLevelKey,
  options: { actorId?: string | null; replace?: boolean } = {},
): Promise<LevelAdaptOutcome> {
  const article = await loadAiProcessableArticleText(articleId, null);
  if (!article) return { status: "failed", reason: "article_not_found" };
  if (!options.replace && (await getArticleLevelVariant(articleId, levelKey))) {
    return { status: "skipped", reason: "already_exists" };
  }
  if (!isAiConfigured()) return { status: "skipped", reason: "provider_unconfigured" };

  const completion = await chatComplete(
    renderPrompt("level-adapt", {
      title: article.title,
      source: boundedSampleForFeature(articleHtmlToReaderText(article.content), "level-adapt"),
      level: levelKey,
      targetLexile: LEVEL_NOMINAL_LEXILE[levelKey],
    }),
    {
      feature: "level-adapt",
      promptVersion: activePromptVersion("level-adapt"),
      articleId,
      maxOutputTokens: promptModelParams("level-adapt").maxOutputTokens,
    },
  );
  if (!completion) return { status: "failed", reason: "provider_error" };
  const parsed = parseLevelAdaptation(completion);
  if (!parsed) return { status: "failed", reason: "validation_failed" };
  const saved = await saveArticleLevel(
    articleId,
    levelKey,
    { title: parsed.title, text: parsed.paragraphs.join("\n\n") },
    { actorId: options.actorId ?? null, source: "ai" },
  );
  return saved.ok ? { status: "generated", level: saved.level } : { status: "failed", reason: "validation_failed" };
}

