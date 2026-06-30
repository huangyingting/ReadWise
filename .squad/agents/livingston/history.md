# Project Context

- **Owner:** Yingting Huang
- **Project:** ReadWise — AI-assisted English learning reader with a modern Studio redesign.
- **Stack:** Next.js 15 App Router, React 19, Prisma/SQLite, NextAuth database sessions, Azure OpenAI/Speech, Playwright.
- **Created:** 2026-06-19

## Learnings

<!-- Condensed by Scribe on 2026-06-20 after history exceeded the 15KB summarization gate. Full milestone details remain in decisions.md and session/orchestration logs. -->

### 2026-06-19 — Backend/data milestones M6–M16

Livingston owned most backend/data layers for the redesign and rich-reader milestones:

- **M6 Gamification:** `DailyActivity`, SRS fields on `SavedWord`, `Profile.dailyGoal`, SM-2 engine, streak/activity helpers, flashcard APIs, and idempotent progress side-effect recording.
- **M7 Daily Goal:** `parseProfileInput` and profile/onboarding routes validate and persist `dailyGoal` with min/max/integer guards.
- **M10 Bookmarks/Lists:** `ReadingList`/`ReadingListItem` schema, bookmark/list helpers, ownership-scoped CRUD APIs, default Saved list, batch saved checks, and membership endpoint.
- **M11 Highlights:** `Highlight` model, anchor validation, user-scoped CRUD helpers/routes, 2k note cap, and IDOR-safe update/delete behavior.
- **M12 Tutor:** `TutorMessage` model, grounded CEFR-aware `askTutor`, history/send/clear APIs, graceful AI fallback, and no cross-user message access.
- **M13 Sentence Translation:** `SentenceTranslation` cache by article/source hash/lang, max text length, supported-language validation, route, and uncached fallback on AI failure.
- **M14 Quiz Mastery:** `QuizAttempt`, server-derived score percent, best/history/mastery helpers, and ownership-scoped APIs.
- **M15 Personalized Feed:** No migration; ranked feed heuristic using interests, tags, CEFR proximity, freshness, and progress, with batched queries and no caching.
- **M16 Pronunciation:** `PronunciationAttempt`, speech token endpoint that never exposes the Azure key, pronunciation attempt/history APIs.

### 2026-06-20 — Ralph work-all-issues backend waves

Livingston handled three waves in the full-board cleanup:

- **Wave 2 security/performance:** closed #58, #59, #60, #61, #42, #43, #44, #46, #47, #72, #73, and #74. Scope included CSP/Speech, IDOR, JSON-LD XSS, SSRF, chat timeouts/retries, test/CI repair, AI cost logging, rate limits, feed cap, DB/sourceUrl index, schema hardening, and lint cleanup.
- **Wave 4 features:** closed #41 (SQLite FTS5 search), #37 (adaptive CEFR), and #38 (vocabulary cloze).
- **Wave 6 Web Push:** closed #39 with `web-push`, VAPID, `PushSubscription`, service worker, opt-in toggle, and send CLI.

Final cumulative gate after all six waves: typecheck 0, lint 0, tests 411/411, build passes.

### Cross-agent lessons

- Sequential single-owner waves avoid main-branch git conflicts when agents are committing directly to `main`.
- SQLite FTS5 needs hand-written migration SQL; Prisma cannot model virtual tables directly.
- `web-push` and VAPID/private-key logic must remain server-only so the client bundle does not pull Node/server dependencies or expose secrets.
- Security/performance bundles should include both code fixes and regression gates; Livingston’s Wave 2 paired hardening with CI/test repair.
- Keep AI and Speech features graceful on missing credentials, timeouts, or provider failures; never cache fallback content that represents an unavailable provider.


## 2026-06-21 — Cross-agent lessons from #105–#126 merge wave
- ownerId access control must be filtered in EVERY public listing/feed/search query (incl. FTS) to avoid leaking personal articles.
- When CI is unavailable, the coordinator gates merges via local typecheck/lint/test/clean-build before squash-merge.


## 2026-06-25 — Codebase Quality Audit (10-pass BACKEND/DATA/AI sweep)

Livingston performed an exhaustive 10-pass backend audit of ReadWise as part of a five-domain quality review requested by Yingting Huang. Findings documented in `files/findings-backend.md` (18 findings: BE-1–BE-18).

Key backend findings: AI provider call-site sprawl across 10+ route handlers (BE-1, corroborates ARCH-1), in-process cache duplication for feed and robots (BE-2), DomainResult type duplicated across multiple lib files (BE-3), missing transaction boundaries on multi-model writes, unguarded N+1 patterns in tag/progress queries, route handler boilerplate repetition, worker retry logic duplication, outdated SQLite-only query paths surviving dual-schema migration, missing subsystem boundaries between article access/scraper/storage layers, AI ledger/observability gaps.

After Rusty-1 (opus-4.8) consolidation of all 79 cross-domain findings into 15 issues: **Livingston owns issues #612** (AI provider consolidation — Phase 1), **#619** (data-layer separation — Phase 2), **#620** (in-process cache unification — Phase 2), **#621** (route handler deduplication — Phase 2), **#622** (DomainResult dedup + outdated compat removal — Phase 3) on epic #610.

Epic #610 + child issues #611–#625 created on huangyingting/ReadWise. No source code modified (analysis only).

## 2026-06-26 — Round-2 Codebase Quality Audit (10-pass BACKEND/DATA/AI sweep)

Livingston-1 performed a second-wave 10-pass backend audit as a follow-up to epic #610, targeting NEW, non-overlapping issues. Read `files/findings-backend.md` and issues #611–#625 first. Focused on sensitive-data redaction/logging paths, env config validation, missing database indexes, error propagation consistency, worker error handling, AI prompt injection surface, and telemetry data retention. Findings documented in `files/findings-backend-r2.md` (15 findings: BE2-1–BE2-15).

Standout cross-domain finding: BE2-1 (divergent sensitive-key redaction) was independently corroborated by Rusty (ARCH2-2) — real privacy leak and AGENTS.md violation. Also corroborated: BE2-2/3 (runtime-config env scattering) with ARCH2-3.

After Rusty-3 (opus-4.8) consolidation of all 67 round-2 findings into 13 issues: **Livingston owns issues #629** (missing database indexes and query optimization, Phase 1), **#634** (env config centralization and validation module, Phase 2), **#635** (error propagation consistency and request correlation, Phase 2), and **#638** (telemetry/audit data retention enforcement, Phase 3, deps #627) on epic #626, follow-up to #610.

No source code modified (analysis only).


## 2026-06-29 — Scraper image-credit filtering

Livingston handled the user request to filter image-credit boilerplate from scraper output. He changed `src/lib/scraper/declutter.ts` and `tests/scraper-declutter.test.ts`, verified targeted declutter tests plus full scraper tests, and left the non-state diff for coordinator handling.


## 2026-06-29T02:39:40.222+00:00 — Smithsonian scrape workflow
Implemented and validated the Smithsonian reset/scrape/analyze workflow: repo-local visited URL state, pagination, DB analysis, and affiliate-note cleanup. Reset/import outcome was 50 Smithsonian articles with 130,275 stored words and no recurring non-article noise after filtering.


## 2026-06-29T03:14:57.986+00:00 — Byline/date scraper cleanup
Implemented leading author/date residue filtering in scraper extraction. Changed `src/lib/scraper/declutter.ts`, `src/lib/scraper/extract.ts`, `tests/scraper-declutter.test.ts`, and `tests/scraper.test.ts`; behavior removes standalone author/date residue from article bodies while preserving metadata and legitimate prose.


## 2026-06-29T03:36:59.547+00:00 — Smithsonian reset/scrape/publish workflow
Livingston updated the Smithsonian reset/scrape/analyze workflow so imported rows are published. The run reset the DB, skipped 126 previously visited URLs, saved/imported 50 new Smithsonian articles, recorded 11 failed attempts, grew visited records 126→187 with URL/timestamp/outcome fields only, and published all 50 imported rows. Analysis found no recurring non-article noise after tightening a false-positive regex.

2026-06-29T03:56Z — Fixed remaining Smithsonian reader body byline/avatar residue for article cmqyo77ig000zjgg7ces1fu51. Added provider-scoped declutter for leading author avatar/card and standalone publication-date residue, preserved metadata and article media, updated stored ownerless Smithsonian rows (29 then 12 changed; target body now has 0 headshot/byline/date residue), and ran focused scraper/provider tests (119 passed).


## 2026-06-29T03:56:04.101+00:00 — Smithsonian avatar cleanup

Fixed the unresolved Smithsonian reader cleanup issue for article `cmqyo77ig000zjgg7ces1fu51`: the leading byline card/headshot/role/date shape after the standfirst is now removed from body content while preserving metadata and legitimate article media. Reported changed files: `src/lib/scraper/declutter.ts`, `src/lib/scraper/extract.ts`, `tests/scraper.test.ts`, and `tests/scraper-declutter.test.ts`.


## 2026-06-29T04:22:21.322+00:00 — Complete Smithsonian scrape

Livingston continued Smithsonian scraping until configured provider discovery was exhausted. The publish run discovered 595 URLs, skipped 187 previously visited, scraped 408 fresh, saved/imported 292, failed 116, and left duplicates at 0; verification rerun found 0 fresh URLs. DB state ended at 342 Smithsonian rows, all published/`PUBLIC`/ownerless with no drafts or missing `publishedAt`. Provider cleanup removed repeated Hakai attribution noise from stored rows, and focused tests plus changed-file ESLint passed.


### 2026-06-29T05:27:54.043+00:00 — Undark scrape/provider cleanup finalized

Scraped and analyzed 10 Undark articles without resetting the DB: 10 Undark DRAFT rows, 0 duplicate source URLs; Smithsonian remained 392 DRAFT rows. Hardened Undark provider cleanup for recurring support/donation/newsletter chrome, adjusted cleanup heading inspection, updated provider cleanup tests, cleaned existing Undark rows, and passed focused provider/scraper verification.


### 2026-06-29T08:05:07.201+00:00 — Undark all-scrape completion

Livingston's Undark all-scrape implementation was completed by Coordinator after an unusable handoff. Discovery uses WordPress.com posts API with RSS fallback; the final retry run left 56 Undark rows published/PUBLIC/ownerless with no duplicates or missing `publishedAt`. Failed URL records remain audit-only and retryable after Coordinator fixed accounted semantics.

### 2026-06-29T10:38:55.698+00:00 — Undark headless scraping support recorded

Livingston implemented provider-specific Undark headless scraping support: `scrape:undark`, `--headless`, `--headless-only`, Undark-only Playwright Chromium rendering with URL/SSRF validation, WordPress.com API/RSS fallback, docs, and focused tests. Coordinator validation passed focused tests, typecheck, targeted ESLint, CLI help smoke, live browser/API smoke, and `git diff --check`.


### 2026-06-29T11:02:27.669+00:00 — Undark scrape exhaustion

Livingston ran the Undark headless scraper to exhaustion. Across three passes, 2,584 new Undark articles were saved/published; final verification showed 2,692 total Undark rows, all published with no drafts, missing `publishedAt`, or duplicate source URLs. The final rerun saved 0 and failures plateaued at 573 persistent quality/fetch failures, so all discoverable URLs were considered saved/accounted or exhausted.

- 2026-06-29T20:08:52.684+00:00 — Completed database state operation for Ralph request: updated 2692 `Article.status` rows to `DRAFT`, leaving visibility unchanged. Final aggregate: 3084 articles `DRAFT/PUBLIC`; no content exposure, code changes, commits, branch changes, resets, or deletes.


## 2026-06-29T20:18:02.637+00:00 — Noema publish database state operation

Confirmed 11 `Article` rows with source `Noema Magazine` are `PUBLISHED`, `PUBLIC`, and not missing `publishedAt`. No article content was exposed and no code, git, branch, reset, or delete operations were performed.


## 2026-06-29T20:25:50.268+00:00 — Noema scrape exhaustion

Livingston broadened Noema discovery to 30 paginated RSS feed URLs, then ran scrape exhaustion checks at limits 500 and 1000. Final result: 300 unique URLs discovered, 255 Noema articles saved/published/public with no duplicates or missing `publishedAt`, and 45 persistent quality-policy rejections that are not retryable without changing quality policy. Targeted tests, ESLint, and typecheck were reported passing.

## 2026-06-29 Noema exhaustion check
- Inspected ReadWise Noema discovery and sibling `../ReadingX`. ReadingX has no Noema provider/link source; its scraper only crawls configured category HTML for NBC/NatGeo/HuffPost/TIME with regex extraction.
- Verified 30 RSS pages were not exhaustive. Noema Yoast `wpm-article-sitemap*.xml` yielded 2,069 unique article candidates; paginated `?feed=noemarss&paged=N` continued through page 208 and added 7 more, total 2,076 discovered candidates.
- Provider now discovers Noema via sitemap index/article sitemaps plus RSS pagination fallback/augmentation; focused network-free tests updated.
- Exhaustive scrape attempted 2,076: saved 1,081 new, duplicates 255, rejected 738, persistent failures 2. Published Noema-only rows after scrape.
- Final Noema aggregate: total=1,336, published=1,336, public=1,336, drafts=0, missingPublishedAt=0, duplicate sourceUrl groups=0, storedWords=3,212,574.
- Validation passed: targeted node tests for `tests/scraper-rss-extractor.test.ts` and `tests/scraper-noema.test.ts`; `npx eslint src/lib/scraper/providers/noema.ts tests/scraper-rss-extractor.test.ts tests/scraper-noema.test.ts`; `npm run typecheck`.


## 2026-06-29T21:13:25.291+00:00 — Noema exhaustion correction recorded

Scribe recorded Ralph's correction that the prior 300-link Noema run was not exhaustive and that `../ReadingX` had no Noema-specific discovery logic. Livingston's enhanced Noema provider combines Yoast `wpm-article-sitemap*.xml` discovery with paginated RSS through page 208, yielding 2,076 candidates; final Noema DB state is 1,336 published/public rows with 0 drafts, 0 missing `publishedAt`, and 0 duplicate groups. Coordinator validation passed targeted tests, ESLint, and typecheck. No article content was exposed; Scribe did not commit mutable Squad state.

## 2026-06-29T22:53:56.993+00:00 — all articles draft status

Completed a database-only state operation requested by Ralph: updated 1,336 `Article.status` rows to `DRAFT`, leaving visibility unchanged. Final aggregate state is 4,420 articles all in `DRAFT`, all `PUBLIC`, with 0 published remaining; no article content or git state was touched.

- 2026-06-30T00:44:05.590+00:00 — Per Ralph's request, Livingston performed a database state operation for Nautilus article publishing only. Targeted 11 Nautilus rows; all are now confirmed `PUBLISHED`, `PUBLIC`, and with `publishedAt` populated. No article content or git operations were involved.


- 2026-06-30T00:52:48.287+00:00 — Implemented provider-specific Nautilus cleanup: removed `<figcaption>` elements while preserving `<figure><img src=...>` image sources in sanitized output; other providers continue to keep captions. Remediated local Nautilus DB rows (9 rows, 20 captions removed, image count 22→22) and passed scraper cleanup tests, targeted ESLint, typecheck, and diff check.

## 2026-06-30 Nautilus scrape exhaustion
- Determined previous Nautilus discovery was incomplete: WP REST API 404s and RSS only exposes recent pages; public `sitemap-index-1.xml` discovered 5,751 candidates.
- Provider now uses Nautilus content sitemaps (`sitemap-*.xml`) with WP REST as recency hint and paginated RSS fallback; URL pattern expanded for legacy/underscore/encoded slugs while keeping provider filters.
- Scrape passes: p1 discovered 5,751, fetched 5,740, saved 3,177, rejected 2,557, failed 6; p2 fetched 2,563, saved 4, rejected 2,559; p3 fetched 2,559, saved 0, rejected 2,558, failed 1.
- Published Nautilus rows only: total/published/public 3,192; drafts 0; missingPublishedAt 0; duplicate sourceUrl groups 0; stored words 6,828,766; figcaption rows 0.
- Validation passed: targeted node tests, targeted ESLint, `npm run typecheck`, `git diff --check`.


## 2026-06-30T01:05:42.741+00:00 — Nautilus scrape exhaustion archive

Scribe recorded the Nautilus exhaustion campaign in orchestration and agent logs. Discovery now combines WP REST recency hints, public sitemap content, and RSS fallback; three scrape passes plateaued at 3192 published Nautilus rows with no figcaption rows and validation passing. Unexpected commit state `b1e2475` on `main`/`origin/main` remains noted; Scribe did not commit mutable squad state.


## 2026-06-30T01:47:20.985+00:00 — all articles draft status

Completed a database-only state operation requested by Ralph: updated 3,192 `Article.status` rows to `DRAFT`, leaving visibility unchanged because draft consistency is status-based. Final aggregate: 7,612 total articles all `DRAFT`, all `PUBLIC`, 0 published remaining; no article content or git/source state was touched.

## 2026-06-30T01:58:33.447+00:00 — Knowable sample scrape and publish

- Ran Knowable scraping in two passes: `--limit 10` saved 9/failed 1, then `--limit 20` saved 6/skipped 8/failed 6.
- Supported inspection of 10 stored HTML bodies; no recurring extraction noise was found, so no source filter was changed.
- Outcome recorded: 15 Knowable rows available/imported; 10 inspected rows published; 5 remain drafts for future inspection.


## 2026-06-30T02:08:59.910+00:00 — Knowable figcaption cleanup

Implemented provider-specific Knowable cleanup with the existing `dropFigcaptions` path: Knowable `<figcaption>` elements are removed while retained `<img>` source URLs are preserved, and non-opted providers continue to keep captions. Remediated 14 Knowable DB rows, removing 42 figcaptions with image count preserved 42→42; focused scraper tests 35/35, targeted ESLint, typecheck, and diff check passed.
