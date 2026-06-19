# Project Context

- **Owner:** Yingting Huang
- **Project:** ReadWise — AI-assisted English learning reader. Articles are scraped from the internet; goal is a redesign into a modern, attractive, feature-rich website.
- **Stack:** Next.js 15 (App Router, TypeScript), React 19, Prisma + SQLite, NextAuth v4 (database sessions), Azure OpenAI / Azure Speech, Playwright.
- **Created:** 2026-06-19

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

## 2026-06-19 — Redesign roadmap landed
A full redesign roadmap (8 milestones) was produced by Rusty. Livingston is engaged in:
- **M4 (Browse & Discovery):** implement the global article search API endpoint.
- **M6 (Dashboard & Study):** backend support for reading streaks/daily goal and flashcard review over the existing `SavedWord` model.
No active work yet — standby until M1 (design system) and M2 (app shell) are complete.

### M4 — Global Search Endpoint (2026-06-19) ✅ SHIPPED — committed 7e554c9
Built `GET /api/search` and supporting lib for M4 global search:
- `searchPublishedArticles(query, opts?)` in `src/lib/articles.ts`: published-only, blank/whitespace query guard (no DB hit), `take: limit+1` hasMore pattern, `SEARCH_PAGE_SIZE=20`/`SEARCH_MAX_LIMIT=50` exported for the query validator. Returns raw `Article[]` via `ArticlePage`; `toListingArticle` mapping is the route's responsibility (correct separation).
- `src/app/api/search/route.ts`: session-gated via `createHandler`, `queryString`+`queryInt` validation with min/max bounds, response mirrors `GET /api/articles` shape exactly (`articles`, `progress`, `hasMore`, `offset`). NOT cached (open-ended query keys; per-user progress merged per article).
- 7 test cases in `tests/search.test.ts`: blank q, absent q, match+progress, hasMore, offset advance, 401 unauth, `x-request-id` header.
- Fixed pre-existing `npm test` gap: added `--experimental-strip-types` to `package.json` test script (Node 22.14.0 requires it explicitly; previously ALL tests were broken in this environment).
