# Search and indexing strategy

ReadWise routes user-facing search through `ArticleSearchProvider` (`src/lib/article-search.ts`). The portable provider searches readable article fields plus the signed-in user's highlights/notes and saved vocabulary, merges results only after `readableArticleWhere`, and ranks in application code by field relevance and recency. PostgreSQL additionally has `Article_search_vector_idx`, a GIN expression index over title/excerpt/content used by the raw `postgresTextMatches` path. External search (Meilisearch/Typesense/OpenSearch) is deferred until ranking/language needs exceed PostgreSQL FTS.

## Core query-plan evidence (#263)

`tests/db/postgres.test.ts` seeds representative Article/Progress/SavedWord rows, runs `ANALYZE`, and asserts deterministic `EXPLAIN (FORMAT JSON)` plans use these named indexes. The test sets `enable_seqscan = off` inside each plan transaction only to avoid tiny/CI fixture-size planner variance; the indexes still have to be valid for the exact production predicate/order shape.

| Flow | Query shape / helper | Supporting index contract | Scaling notes |
| --- | --- | --- | --- |
| Home/feed | `listPublishedArticles`, `listCategoryPage(null)`: `status=published`, `visibility=PUBLIC`, `ownerId IS NULL`, newest first | `Article_public_feed_idx(publishedAt, createdAt) WHERE public/published/ownerless` for PostgreSQL/SQLite plans; `Article_visibility_feed_idx(visibility, status, ownerId, publishedAt, createdAt)` as the portable Prisma schema contract | Listing cards must not fetch `content`; cache via `ARTICLES_CACHE_TAG`; offset pages stay small. |
| Category browse | `listCategoryPage(category)`: feed predicate + `category`, newest first | `Article_public_category_feed_idx(category, publishedAt, createdAt) WHERE public/published/ownerless`; `Article_category_feed_idx` is the portable schema fallback | Category slug is low-cardinality but combined with status/owner keeps scans bounded. |
| Recommendations / Picks | `listCategoryPage(...maxLevel)` and `listPicksPage`: public feed + CEFR cap / difficulty ordering | `Article_public_level_feed_idx(difficulty, difficultyScore, publishedAt) WHERE public/published/ownerless`; `Article_level_feed_idx` is the portable schema fallback | Picks fetch is capped by `MAX_PICKS_FETCH=500`; personalized topic ranking remains in memory by design. |
| Reader detail | `getReadableArticleById`, derived content helpers by `articleId` | Article primary key plus per-derived `articleId` indexes (`Translation`, `VocabularyItem`, `QuizQuestion`, `ArticleSpeech`, `ArticleTag`, `Highlight`, `ReadingProgress`) | Access checks include id equality, so the primary key dominates; never render raw article HTML. |
| Progress rails | `getProgressMap`, `listInProgressArticles` | `ReadingProgress_userId_articleId_key`, `ReadingProgress_user_completed_updated_idx`, `ReadingProgress_article_idx` | Batch by article ids to avoid N+1; in-progress rail filters a single user then orders by `updatedAt`. |
| Study / SRS | `getSavedWords`, `getFilteredSavedWords`, `getDueFlashcards`, `getReviewSummary` | `SavedWord_userId_word_key`, `SavedWord_user_article_idx`, `SavedWord_user_created_idx`, `SavedWord_due_idx` | Text filtering is per-user and paginated; due queues order by `dueAt`, newest study list by `createdAt`. |
| Highlights/notes | Reader highlights and annotation search | `Highlight_userId_articleId_idx`, `Highlight_user_created_idx` | Search is scoped to one user before text matching; result count is capped by search candidate limits. |
| Admin articles | `searchArticles`: optional status + newest-first list/search | `Article_status_created_idx`; id/detail counts use derived `articleId` indexes | Text contains search is intentionally bounded by admin pagination; use PostgreSQL FTS/trigram if admin free-text volume becomes a P95 bottleneck. |
| Admin members | `listMembers`: optional role + newest-first; activity count batch | `User_role_created_idx`, `ReadingProgress_user_completed_updated_idx`, `SavedWord_userId_idx` | Name/email contains is an admin convenience filter, not the primary scaling path. Role filters stay index-backed. |
| Admin tags | `listAdminTags`, `listTagsWithCounts`, tag pages | `Tag_scope_namespace_idx`, `Tag_scope_namespace_slug_key`, `ArticleTag_tagId_idx`, `ArticleTag_articleId_idx`, `Article_category_feed_idx` for published article joins | Public tags are filtered by scope/namespace; tag article pages use the join table then the public-feed article predicate. |
| Worker / processor | `listUnprocessedArticleIds`: draft queue, optionally missing derived rows | `Article_status_created_idx` for default draft queue; derived relations use `ArticleTag_articleId_idx`, `VocabularyItem_articleId_idx`, `QuizQuestion_articleId_idx` | Default worker polling is oldest-draft-first and index-backed. `includePublished` is a maintenance sweep and may touch derived relation indexes. |
| Learner analytics | `getLearnerAnalytics`, `getActivityHeatmap`, streaks | `ReadingProgress_user_completedAt_idx`, `ReadingProgress_user_completed_updated_idx`, `SavedWord_user_created_idx`, `QuizAttempt_userId_completedAt_idx`, `DailyActivity_userId_date_key` | All learner analytics are scoped to one `userId`; history windows cap rows where practical. |
| Admin analytics | `getAdminOverview`, `getAdminAnalytics` | Status/category/difficulty groupings lean on Article indexes; counts on `User_role_created_idx`, `ReadingProgress_*`, `SavedWord_userId_idx`, tag join indexes | These are back-office aggregate snapshots; keep dashboard refresh/caching conservative before adding materialized rollups. |
| Search | `searchReadableArticles`, `postgresTextMatches`, annotation/vocab merge | `Article_search_vector_idx`, feed indexes, `Highlight_user_created_idx`, `SavedWord_user_article_idx` | Candidate sets are capped; PostgreSQL FTS ranks article body/title/excerpt while app ranking adds byline/annotation boosts. |

## Query-plan checklist

For every new high-volume read, document:

1. Predicate shape (`where`), sort (`orderBy`), pagination style, and expected cardinality.
2. The named supporting index and why its leading columns match the most selective equality predicates before range/order columns.
3. Whether the query fetches wide fields such as `Article.content` (list pages should not).
4. Whether text search is prefix/full-text/index-backed or intentionally per-user/admin-bounded.
5. Cache/invalidation assumptions (`ARTICLES_CACHE_TAG`, `TAGS_CACHE_TAG`, or no cache).
6. A regression test when a flow depends on a specific PostgreSQL plan or access-boundary merge.

Closes #263. Refs #259 #314.
