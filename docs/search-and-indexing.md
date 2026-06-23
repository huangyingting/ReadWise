# Search and indexing strategy

ReadWise now routes user-facing search through `ArticleSearchProvider` (`src/lib/article-search.ts`). The shippable provider is a SQLite-safe Prisma strategy: it searches readable article fields plus the signed-in user's highlights/notes and saved vocabulary, merges results only after `readableArticleWhere`, and ranks in application code by field relevance and recency. To keep the interim Prisma ranking fair, exact phrase, title, and author/source buckets are queried separately before the low-priority recency cap is applied, so older high-relevance matches are not hidden behind newer body-only matches. It does not require SQLite FTS5; the migration `20260623004500_search_indexes` drops the old FTS table/triggers when present.

Production direction for #265 is PostgreSQL full-text search after #259 moves the datasource off SQLite. Add a PostgreSQL provider behind the same interface using generated `tsvector` columns for title/excerpt/content and `ts_rank_cd`, with optional learner boosts from highlights, saved vocabulary, progress, and bookmarks. External search (Meilisearch/Typesense/OpenSearch) is deferred until ranking/language needs exceed PostgreSQL FTS.

## Core query indexes (#263)

- `Article_visibility_feed_idx`: published public feeds/search (`status`, `ownerId`, newest-first ordering).
- `Article_category_feed_idx`: browse category pages.
- `Article_level_feed_idx`: CEFR-level browse and recommendations.
- `Article_owner_status_created_idx`: private imports and owner-scoped search.
- `Article_status_created_idx`: worker draft queue and admin status filters.
- `Article_sourceUrl_idx`: scraper/import dedupe lookup.
- `ReadingProgress_user_completed_updated_idx` and `ReadingProgress_article_idx`: dashboard history/progress summaries and admin counts.
- `SavedWord_user_article_idx` and `SavedWord_due_idx`: vocabulary search, study list, and SRS due queues.
- `Highlight_user_created_idx`: user note/highlight search and libraries.
- `Account_user_idx`, `Session_user_idx`, `User_role_created_idx`: auth cleanup and admin/member filtering.

## Query-plan checklist

For new high-volume reads, document the `where`, `orderBy`, pagination shape, expected cardinality, and the supporting index. Keep user/visibility predicates first, avoid fetching `Article.content` for listing cards, cap in-memory ranking candidate sets, and add a regression test when a query depends on a specific index or access boundary.
