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
