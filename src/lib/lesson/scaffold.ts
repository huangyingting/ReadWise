/**
 * "Apply to your lesson" scaffolds for educators (#1304): a before-reading
 * hook, discussion questions, and key terms. Generated once per article with
 * the `lesson-scaffold` prompt and cached in `ArticleLessonScaffold`; when AI
 * is unconfigured or fails, a deterministic scaffold built from the text is
 * returned instead (never cached, so a real one can replace it later).
 */
import { prisma } from "@/lib/prisma";
import { getOrCreateArticleAi } from "@/lib/ai/cache";
import { renderPrompt, promptModelParams, activePromptVersion } from "@/lib/ai/prompts";
import { boundedSampleForFeature } from "@/lib/ai/chunking";
import { extractJsonArray } from "@/lib/ai/output/validators";
import { articleHtmlToReaderText } from "@/lib/content-pipeline";
import type { ArticleAccessContext } from "@/lib/article-library";
import type { AiFallbackReason } from "@/lib/ai/fallback-reasons";
import { deterministicLessonScaffold, type KeyTerm, type LessonScaffold } from "./scaffold-fallback";

export type LessonScaffoldResult = LessonScaffold & {
  /** True when the scaffold came from the deterministic fallback. */
  fallback: boolean;
  fallbackReason?: AiFallbackReason;
};

const MAX_ITEM_LENGTH = 400;

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text && text.length <= MAX_ITEM_LENGTH ? text : null;
}

/** Parses `[{type:"hook"|"question"|"term", ...}]` model output; null when unusable. */
export function parseLessonScaffold(completion: string): LessonScaffold | null {
  const items = extractJsonArray(completion);
  if (!items) return null;
  let hook: string | null = null;
  const questions: string[] = [];
  const keyTerms: KeyTerm[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (entry.type === "hook" && !hook) hook = clean(entry.text);
    else if (entry.type === "question") {
      const text = clean(entry.text);
      if (text && questions.length < 6) questions.push(text);
    } else if (entry.type === "term") {
      const term = clean(entry.term);
      const definition = clean(entry.definition);
      if (term && definition && keyTerms.length < 8) keyTerms.push({ term, definition, context: null });
    }
  }
  return hook && questions.length > 0 ? { hook, questions, keyTerms } : null;
}

function parseKeyTerms(raw: unknown): KeyTerm[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const entry = item as Record<string, unknown>;
    return typeof entry?.term === "string"
      ? [{ term: entry.term, definition: typeof entry.definition === "string" ? entry.definition : null, context: null }]
      : [];
  });
}

async function readCachedScaffold(articleId: string): Promise<LessonScaffold | null> {
  const row = await prisma.articleLessonScaffold.findUnique({
    where: { articleId },
    select: { hook: true, questions: true, keyTerms: true },
  });
  if (!row) return null;
  return {
    hook: row.hook,
    questions: Array.isArray(row.questions) ? row.questions.filter((q): q is string => typeof q === "string") : [],
    keyTerms: parseKeyTerms(row.keyTerms),
  };
}

/** Cached or generated scaffolds; null when the article isn't readable. */
export function getOrCreateLessonScaffold(
  articleId: string,
  context: ArticleAccessContext | null,
): Promise<LessonScaffoldResult | null> {
  return getOrCreateArticleAi<{ title: string; content: string }, LessonScaffold | null, LessonScaffold, LessonScaffoldResult>(
    articleId,
    {
      feature: "lesson-scaffold",
      maxOutputTokens: promptModelParams("lesson-scaffold").maxOutputTokens,
      readCache: readCachedScaffold,
      buildMessages: (article) =>
        renderPrompt("lesson-scaffold", {
          title: article.title,
          source: boundedSampleForFeature(articleHtmlToReaderText(article.content), "lesson-scaffold"),
        }),
      parse: parseLessonScaffold,
      isEmpty: (parsed) => parsed === null,
      persist: async (id, parsed) => {
        const scaffold = parsed as LessonScaffold;
        const data = {
          hook: scaffold.hook,
          questions: scaffold.questions,
          keyTerms: scaffold.keyTerms.map(({ term, definition }) => ({ term, definition })),
          promptVersion: activePromptVersion("lesson-scaffold"),
        };
        await prisma.articleLessonScaffold.upsert({ where: { articleId: id }, create: { articleId: id, ...data }, update: data });
        return scaffold;
      },
      toResult: (scaffold) => ({ ...scaffold, fallback: false }),
      fallback: (article, ctx) => ({
        ...deterministicLessonScaffold(article.title, articleHtmlToReaderText(article.content)),
        fallback: true,
        ...(ctx?.reason ? { fallbackReason: ctx.reason } : {}),
      }),
    },
    context,
  );
}
