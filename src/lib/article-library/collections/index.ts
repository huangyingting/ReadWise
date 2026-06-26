/**
 * Article collections — taxonomy/tags and reading-list/bookmarks
 * (article-library subsystem, REF-040, REF-042).
 *
 * Barrel re-export. Implementation split by concern:
 *   tags        — taxonomy/tag queries and management (ARCH-7)
 *   default-list-policy — DEFAULT_LIST_NAME and lazy-upsert for "Saved"
 *   commands    — createList, renameList, deleteList, addToList,
 *                 removeFromList, toggleBookmark
 *   read-models — getUserLists, getListWithArticles, getBookmarkedArticleIds
 *   membership  — getArticleListMembership
 */
export * from "./tags";
export * from "./default-list-policy";
export * from "./read-models";
export * from "./commands";
export * from "./membership";
