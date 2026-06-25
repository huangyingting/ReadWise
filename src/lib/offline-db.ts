/**
 * @deprecated Thin re-export shim for backward compatibility (REF-021).
 *
 * The implementation has been split into focused adapters under `@/lib/offline/`:
 *   - IndexedDB helpers    → `@/lib/offline/idb`
 *   - Article cache CRUD   → `@/lib/offline/article-store`
 *   - Mutation queue CRUD  → `@/lib/offline/mutation-store`
 *
 * New code should import directly from `@/lib/offline` or a specific sub-module.
 */

export {
  MAX_OFFLINE_ARTICLES,
  type OfflineArticle,
  saveOfflineArticle,
  getOfflineArticle,
  getAllOfflineArticles,
  removeOfflineArticle,
  isArticleOffline,
  getOfflineArticleVersion,
  purgeOfflineData,
} from "./offline/article-store";

export {
  type EnqueueMutationInput,
  enqueueMutation,
  listQueuedMutations,
  countQueuedMutations,
  updateQueuedMutation,
  removeQueuedMutation,
  clearQueuedMutations,
} from "./offline/mutation-store";
