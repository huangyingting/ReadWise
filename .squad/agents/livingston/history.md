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
