/**
 * Tags / taxonomy — re-exports from article-library/collections (REF-040).
 * This file is kept as a compatibility shim so existing importers continue to
 * resolve `@/lib/tags` without changes.
 */
export {
  slugifyTag,
  type TagView,
  type ArticleTagsResult,
  type TagWithCount,
  parseTagsJson,
  getArticleTags,
  getOrCreateArticleTags,
  setArticleTags,
  getTagBySlug,
  listArticlesByTag,
  listRelatedArticles,
  listTagsWithCounts,
} from "@/lib/article-library/collections";
