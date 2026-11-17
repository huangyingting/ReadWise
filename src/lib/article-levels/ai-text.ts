/**
 * Level-aware article text for AI helpers (#1303).
 */
import { loadAiProcessableArticleText, type ArticleAccessContext } from "@/lib/article-library/policy";
import { ORIGINAL_LEVEL, type ReadingLevelKey } from "./levels";
import { getArticleLevelVariant } from "./variants";

/** Title + content for AI helpers at a level (canonical text for "original"). */
export async function loadArticleTextAtLevel(
  articleId: string,
  levelKey: ReadingLevelKey,
  context: ArticleAccessContext | null,
): Promise<{ title: string; content: string } | null> {
  const article = await loadAiProcessableArticleText(articleId, context);
  if (!article || levelKey === ORIGINAL_LEVEL) return article;
  const variant = await getArticleLevelVariant(articleId, levelKey);
  return variant ? { title: variant.title, content: variant.content } : null;
}
