---
type: "index"
status: "current"
last_updated: "2026-11-19"
description: "The reading experience: annotations, bookmarks and lists, imports, dictionary, translation, playback, reading levels, reader tools, offline sync, search, recommendations, and citations."
---

# Reader

Reader page composition and in-reader tools. Reader-facing features must use Article Library readable boundaries rather than re-implementing access.

Add a document here when the change affects what happens on or around the reader page, or how learners find articles.

## Code ownership

- `src/lib/reader/`, `src/lib/annotations/`, `src/lib/offline/`, `src/lib/lexical/`
- `src/lib/search/`, `src/lib/recommendations/`, `src/lib/import/`, `src/lib/article-levels/`
- `src/components/reader/`, `src/app/(app)/reader/`

## Documents

<!-- BEGIN GENERATED: docs-index (npm run docs:index) -->

| Document | Type | Status | Description |
| --- | --- | --- | --- |
| [Reader highlights and notes](./annotations.md) | design | current | Documents Reader annotation ownership, highlight anchors, notes, APIs, and offline conflict boundaries. Captures current anchor model, note editing, color rules, revalidation, merge behavior, and privacy constraints. |
| [Bookmarks and reading lists](./bookmarks-and-lists.md) | design | current | Documents saved/default lists, custom reading lists, membership, and IDOR-safe access boundaries. Captures current list schemas, bookmark APIs, list membership behavior, export/deletion, and privacy rules. |
| [Citations and printable packets](./citations-and-print.md) | design | current | Documents reader citations (MLA 9, APA 7, Chicago) and printable classroom packets (article, worksheet, teacher answer key). Captures citation rules and fallbacks, print modes, answer-key authorization, rights/takedown handling, print styling, and tests. |
| [Personal article import system](./imports.md) | design | current | Documents URL/text personal imports, SSRF/sanitization boundaries, quota, deduplication, and ownership rules. Captures current import routes, provider fallback, content cleaning, private article creation, audit/analytics metadata, and privacy constraints. |
| [Lexical dictionary and saved-word lookup](./lexical-dictionary.md) | design | current | Documents lexical provider seam, word normalization, dictionary lookup, saved-word persistence, and AI vocabulary panel relationship. Captures current normalization rules, local/free/hybrid providers, lookup route behavior, saved-word SRS integration, and privacy constraints. |
| [Offline-first sync, conflict resolution & cache versioning](./offline-sync.md) | design | current | Documents client-side offline mutation queue, conflict resolution, cache versioning, Today offline replay, and push/background-sync resilience. Captures current IndexedDB queue, idempotency keys, retry/backoff, conflict statuses, service-worker cache versions, and privacy purge behavior. |
| [Reader playback UX](./playback.md) | design | current | Documents ReaderAudioProvider, mini-player, narration transport, word highlighting, and access-checked playback initiation. Captures current playback controls, speed/loop behavior, audio-range playback, TTS integration, storage fallback, and UI state rules. |
| [Reader learning tools](./reader-tools.md) | design | current | Documents the ReaderTools surface and its Reader, AI, Speech, Learning, Offline, and Analytics subsystem boundaries. Covers vocabulary, quiz, tutor, dictation, pronunciation, grammar, and selection tools as mounted reader panels and Reader floating surfaces with graceful fallbacks. |
| [Reading levels](./reading-levels.md) | design | current | Documents multi-level article variants: ArticleLevel data, the reader Reading Level switcher, level-scoped quizzes, highlights, and class prompts, teacher level locks on assignments, admin authoring with optional LEVEL_ADAPT generation, APIs, and fallbacks. |
| [Reader recommendations and scored picks](./recommendations.md) | design | current | Documents Scored Picks candidate boundaries, personalization context, ranking, diversity, explanations, and privacy rules. Captures current candidate filtering, score weights, placement/goal/profile inputs, series soft candidates, feed/browse behavior, and fallback rules. |
| [Search and indexing strategy](./search-and-indexing.md) | design | current | Documents search/indexing strategy, query boundaries, and article visibility constraints. Captures current search route behavior, indexing assumptions, filtering/pagination, privacy, and fallback semantics. |
| [Translation service](./translation.md) | design | current | Documents article and sentence translation caches, AI prompt versions, chunking, access checks, and privacy boundaries. Captures current cache keys, full-article/sentence translation flows, fallbacks, route behavior, and metadata constraints. |

<!-- END GENERATED: docs-index -->
