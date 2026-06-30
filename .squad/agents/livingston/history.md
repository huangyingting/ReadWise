# Project Context

- **Owner:** Yingting Huang
- **Project:** ReadWise — AI-assisted English learning reader with a modern Studio redesign.
- **Stack:** Next.js 15 App Router, React 19, Prisma/SQLite, NextAuth database sessions, Azure OpenAI/Speech, Playwright.
- **Created:** 2026-06-19

## Learnings

<!-- Condensed by Scribe on 2026-06-30 after history exceeded the 15KB summarization gate. Full milestone details remain in decisions.md and session/orchestration logs. -->

### 2026-06-19 to 2026-06-21 — Redesign backend milestones and first cleanup waves

Livingston owned most backend/data work for rich-reader milestones M6–M16: gamification/activity, daily goals, bookmarks/lists, highlights, tutor, sentence translation, quiz mastery, personalized feed, and pronunciation APIs/storage. He later handled Ralph work-all-issues backend waves covering security/performance hardening, FTS search, adaptive CEFR, vocabulary cloze, and Web Push. Durable lessons: enforce ownerId filtering on every user-facing query, keep optional AI/Speech/Push graceful, keep VAPID/private-key code server-only, and pair hardening with regression tests.

### 2026-06-25 to 2026-06-26 — Backend quality audits

Livingston performed two 10-pass BACKEND/DATA/AI audits. Round 1 produced BE-1–BE-18 and ownership of epic #610 issues #612, #619, #620, #621, and #622. Round 2 produced BE2-1–BE2-15 and ownership of epic #626 issues #629, #634, #635, and #638. No source code was modified during these analysis-only audits.

### 2026-06-29 — Smithsonian scraper campaign

Livingston implemented scraper cleanup for image credits, byline/date residue, Smithsonian avatar/byline cards, Hakai attribution noise, repo-local visited URL state, pagination, reset/import/analyze/publish workflows, and complete Smithsonian scrape exhaustion. Final Smithsonian state reached 342 published/public/ownerless rows with no drafts or missing `publishedAt`; focused scraper/provider tests and changed-file ESLint passed where reported.

### 2026-06-29 — Undark scraper campaign

Livingston added Undark provider cleanup for support/donation/newsletter chrome, then implemented Undark headless scraping support (`scrape:undark`, `--headless`, `--headless-only`, Playwright Chromium rendering, URL/SSRF validation, WordPress.com API/RSS fallback, docs, tests). Coordinator completed one unusable handoff and fixed accounted semantics. Final exhaustion left 2,692 Undark rows published/public with no duplicates or missing `publishedAt`; persistent failures remained quality/fetch rejections.

### 2026-06-29 — Noema scraper campaign

Livingston first broadened Noema RSS discovery, then corrected non-exhaustive discovery by adding Yoast `wpm-article-sitemap*.xml` discovery plus paginated RSS fallback. Final Noema aggregate: 1,336 published/public rows, 0 drafts, 0 missing `publishedAt`, 0 duplicate sourceUrl groups, and 3,212,574 stored words. Validation passed targeted node tests, ESLint, and typecheck. Scribe recorded Ralph's correction that sibling `../ReadingX` had no Noema-specific discovery logic.

### 2026-06-30 — Nautilus scraper campaign

Livingston handled Nautilus publishing/draft database operations and provider-specific cleanup that drops figcaptions while preserving image sources. Exhaustion used WP REST recency hints, public sitemap content, and RSS fallback; three scrape passes plateaued at 3,192 published/public Nautilus rows with no missing `publishedAt`, duplicates, or figcaption rows. Validation passed targeted tests, ESLint, typecheck, and diff check where reported.

### 2026-06-30 — Knowable scraper campaign

Livingston ran Knowable sample scraping/publishing, inspected stored bodies, then added provider-specific Knowable figcaption cleanup via the existing `dropFigcaptions` path. Fourteen existing Knowable DB rows were remediated with 42 figcaptions removed and image count preserved 42→42; focused scraper tests, targeted ESLint, typecheck, and diff check passed.

2026-06-30T03:10:32Z — Livingston changed Knowable section search RSS discovery to send `pageSize=100` and mirrored the parameter in `tests/scraper-rss-extractor.test.ts`; targeted scraper/provider tests and `npx tsc --noEmit` passed, and live discovery now reaches 972 unique valid Knowable URLs.

### Cross-agent lessons

- Sequential single-owner waves avoid main-branch git conflicts when agents commit directly to `main`.
- SQLite FTS5 needs hand-written migration SQL; Prisma cannot model virtual tables directly.
- Never expose secrets or private article/user content in logs or metadata; redaction paths are recurring audit targets.
- Scraper source changes should update provider tests, RSS extractor helpers, DB remediation notes, and decision/session logs together.
- For full-source scrape campaigns, distinguish saved/accounted/rejected/failure semantics so retries and exhaustion claims remain auditable.

- 2026-06-30T03:10:32Z — Added scraper fetch-chain HTTP 429 retry/backoff support honoring Retry-After with jittered exponential backoff and new runtime knobs.

- 2026-06-30T04:02:35Z — Added default-on headless-browser scraper fetch strategy before r.jina.ai, with Playwright dynamic import, SSRF route guard, singleton cleanup, and mocked strategy tests.

- 2026-06-30T04:02:35Z — Added pre-fetch public-library duplicate URL filtering for provider scrapes via `findExistingPublicLibrarySourceUrls`; targeted tests and `npx tsc --noEmit` passed.
- 2026-06-30T04:55:19Z — Extended Knowable discovery to crawl 10 homepage topic RSS feeds in addition to the 7 sections; targeted tests and `npx tsc --noEmit` passed, and coordinator scrape saved 6 substantive articles (DB 857→863).
