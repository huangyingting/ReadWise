/**
 * Admin tag commands — re-export barrel (ADR-0010 §6 / Phase 3 #686).
 *
 * Tag and ArticleTag records are owned by the Article Library subsystem.
 * The implementation of `listAdminTags`, `renameTag`, `mergeTags`, and
 * `deleteTag` has moved to `@/lib/article-library/admin-tags` so that
 * multi-model transaction boundaries live in the owning subsystem.
 *
 * This barrel keeps the `@/lib/admin` public surface stable for existing
 * callers while the implementation lives in its proper home.
 */
export {
  ADMIN_TAGS_PAGE_SIZE,
  listAdminTags,
  renameTag,
  mergeTags,
  deleteTag,
  type AdminTagRow,
  type AdminTagSearch,
  type ListTagsOpts,
  type DeleteTagResult,
  type RenameTagResult,
  type MergeTagsResult,
} from "@/lib/article-library/admin-tags";
