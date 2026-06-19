# Project Context

- **Owner:** Yingting Huang
- **Project:** ReadWise — AI-assisted English learning reader. Articles are scraped from the internet; goal is a redesign into a modern, attractive, feature-rich website.
- **Stack:** Next.js 15 (App Router, TypeScript), React 19, Prisma + SQLite, NextAuth v4 (database sessions), Azure OpenAI / Azure Speech, Playwright.
- **Created:** 2026-06-19

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### M3 — Landing Page (2026-06-19) ✅ PASS — ready to land (not yet committed)
Basher verified: PASS with design flag D3 (CTA band button in dark theme: dark surface on gradient, 14:1 contrast WCAG AAA, but aesthetically dark vs white/indigo — flagged for Linus/Saul). All static gates green (typecheck 0 / lint 0 / build 0). 30 browser checks pass (2 initial false positives: dark gradient `rgba(0,0,0,0)` vs `'transparent'` string; MockReaderCard selector hit header div). Chromium at `~/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`. Dev PIDs 392796/797/821 killed; test user/session cleaned up.

### M2 — Global App Shell (2026-06-19) ✅ SHIPPED — committed 385de06
Basher verified: CONDITIONAL PASS → D1 (inactive nav links indigo instead of gray; root cause: unlayered `a { color: var(--accent) }` in globals.css beats `@layer utilities`) → Linus fixed by wrapping in `@layer base`. Final: all shell checks pass. Open: N3 (UserMenu aria-label redundancy) → M8 a11y.
A full redesign roadmap (8 milestones) was produced by Rusty. Basher is engaged in:
- **M8 (Motion, a11y, responsive & loading-state QA pass):** Playwright sweep + WCAG AA contrast/focus-ring/keyboard a11y audit across all redesigned surfaces.

### M3 gate verify (2026-06-19T11:32:57+08:00)
Spawned by Scribe: verify M3 landing page (static gates + browser verification per linus-m3-built.md spec). Output: `.squad/decisions/inbox/basher-m3-verify.md`. M3 is built but uncommitted; this verify pass is the gate before commit.

### M4 — Listings & Discovery (2026-06-19) ✅ PASS — committed 7e554c9
Basher verified M4: PASS — 121 checks (Pass 1: 81 broad sweep + Pass 2: 40 targeted re-check), 0 real failures. Method: Playwright + Chromium (port 3001), 1 User + 1 Session + 3 ReadingProgress rows (30%, 65%, 100% completed). Key confirmations: ArticleCardView all states/hooks/motion; ListingProgressSync full sync cycle; category tab indigo NOT teal; continue-reading rail snap-scroll+region+keyboard; EmptyState+SkeletonCard (code-verified); mobile 768px/375px; dark theme; heading order h1→H2s→strong. Flags confirmed: M4-F1 "Read" done-chip · M4-F2 listing-container 1200px · M4-F3 dual-refresh accepted per §4.3. Accepted deviations: M4-D1 (separate DB query), M4-D2 (SkeletonCardGrid deferred), M4-D3 (rw-fade-up on section wrappers). Test user/session cleaned up after verify.

### M5 — Reader Redesign (2026-06-19) ✅ PASS — committed f199596
Basher verified M5 in **AI-CONFIGURED mode** (Azure OpenAI + Azure Speech): PASS — 77 browser checks · 0 fail · 2 flag. Found and fixed **D5** (no-flash script placed outside `#reader-root`; `getElementById` returned null; fix: move script to first child of `#reader-root`, use `document.currentScript.parentElement`; re-verified `data-reading-mode="sepia"` set at DOMContentLoaded). Key confirmations: two-column layout + sticky rail ≥1100px; 5-step font-scale stepper; reading-mode radiogroup (Light/Sepia/Dark); prefs persisted + no-flash working post-fix; tabbed panel stay-mounted + lazy-load + roving tabindex; mini-player (single `<audio>`, skip ±10s, seek, speed, close); real TTS narration generated + word-highlight binary-search; `sanitizeArticleHtml`→`WordLookup` only HTML path; `ReaderProgress` unchanged. Accepted limitations: mobile focus-trap tab-cycle deferred M9; TTS first-gen latency can exceed 60s. Seed data cleaned up post-verify.

### M6 — Dashboard & Study Gamification (2026-06-19) ✅ PASS — committed 1beea38
Basher verified M6: PASS — 87 checks, 0 failures. Test user seeded (User + Session + Profile + 6 SavedWords + 6 DailyActivity rows); cleaned up after verify. Schema additions confirmed (DailyActivity @@unique, SavedWord SRS cols, Profile.dailyGoal). API verified: `GET /api/gamification/summary` (200 with all fields, 401 unauthed); `GET /api/study/flashcards` (200 with 6 cards + dueCount); `POST /api/study/flashcards/grade` (200 good/again, 400 invalid grade, 401 unauthed, SRS correctness — graded card removed from queue). Browser: StreakWidget (teal flame, 7 dots with today ring, weekday initials, a11y aria-labels, zero-streak state); DailyGoal (teal ring un-met, success met with Check + rw-pop, aria progressbar, "Adjust goal" link); FlashcardReview (session flow idle→loading→session→complete, 3D flip, keyboard Space/Enter/1–4/Esc, grade button hover styles, aria-live, progress bar, session-complete recap); dashboard layout (H1→H2 "Your progress"→H2 "Browse" order, stats band before Browse, no horizontal overflow 375px); M4/M5 regressions clean. Chromium `~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`.
