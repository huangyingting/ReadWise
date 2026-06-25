/**
 * Reading lists and bookmarks — re-exports from article-library/collections
 * (REF-040). This file is kept as a compatibility shim so existing importers
 * continue to resolve `@/lib/bookmarks` without changes.
 */
export {
  type UserList,
  type ListWithArticles,
  type ListMembership,
  getOrCreateDefaultList,
  getUserLists,
  getListWithArticles,
  createList,
  renameList,
  deleteList,
  addToList,
  removeFromList,
  toggleBookmark,
  getBookmarkedArticleIds,
  getArticleListMembership,
} from "@/lib/article-library/collections";
