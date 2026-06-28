# Squad Decisions

## Active Decisions

### DECIDED — Design Direction: B "Studio"
_Chosen by Yingting · 2026-06-19_
**Direction B "Studio" is LOCKED** for the redesign — modern learning-app aesthetic: vivid indigo/violet primary (+ teal/amber accents), Inter/Geist via `next/font`, soft elevated cards, Lucide icons, light + dark themes. Touchstones: Linear / Duolingo / Vercel. All design-system and UI work follows this direction.
Alternatives not chosen: A "Broadsheet" (editorial/serif), C "Focus" (minimal/monochrome).

### ACCEPTED Roadmap (M4–M9) — Migration-First
_Proposed by Rusty · Accepted by Yingting Huang · 2026-06-19_
**Rule: additive migrations only** for all net-new features (no edits to existing columns/migrations). Sequencing: migration-first (clean base, then gamification / net-new on top). Supersedes the earlier M4–M8 sketch.

| # | Milestone | Owners | Effort | Status |
|---|---|---|---|---|
| **M4** | Listings & Discovery — shared card → M1 primitives; skeletons; empty states; continue-reading rail; global search (net-new) | Saul (spec), Linus (build), Livingston (search), Basher (verify) | M | ✅ COMPLETE 7e554c9 |
| **M5** | Reader redesign — layout, font/theme controls, AI tools as sticky tabbed panel, audio mini-player | Saul (spec), Linus (build), Rusty (review), Basher (verify) | L | ✅ COMPLETE f199596 |
| **M6** | Dashboard & Study — reading streaks/daily goal, flashcard SRS over existing `SavedWord` | Livingston (data), Linus (UI), Saul (spec) | L | ✅ COMPLETE 1beea38 |
| **M7** | Onboarding, Auth & Settings polish + daily-goal editing | Saul (spec), Livingston (backend), Linus (build), Rusty (review), Basher (verify) | S–M | ✅ COMPLETE cb204c5 |
| **M8** | Admin polish — design system to `/admin`; extract shared `ConfirmAction` | Linus (build), Saul (light spec) | M | ✅ COMPLETE a631aa9 |
| **M9** | Motion, a11y, responsive QA + ⌘K command palette (reuses M4 search endpoint). Closes M1/M2 nits N2/N3/N4. | Basher (lead QA), Linus, Livingston | M | ✅ COMPLETE dff6c1f |

M4 unblocks M5–M9. Rich-features menu (quick wins + bigger bets) was documented in the accepted roadmap proposal; key greenlit items captured in "Net-New Features Greenlit" above.

### Design Token Foundation (direction-agnostic, ready to implement)
_Proposed by Saul · 2026-06-19_
CSS custom properties on `:root` + `[data-theme="dark"]` + `@media (prefers-color-scheme)`. Semantic color tokens (bg/surface/border/text/primary/accent/success/warning/danger/focus-ring); 1.20 minor-third type scale (`--text-xs` → `--text-4xl`); 4px-base spacing scale (`--space-1..12`); radii (`--radius-sm/md/lg/xl/full`); elevation/shadow (`--shadow-sm/md/lg/xl`); motion durations + easings wrapped in `prefers-reduced-motion`. Fonts via `next/font`.

### Frontend Inventory — Key Refactor Targets
_Proposed by Linus · 2026-06-19_
Current state: 957-line `globals.css`, 6 CSS vars, dark-only, system font, no global nav. High-priority consolidation targets:
1. Extract `Button`, `Input`, `Select`, `Card`, `Badge/Pill`, `Spinner/Skeleton` primitives.
2. Create shared `LazyPanel` (unifies the 4 identical AI-panel open/fetch patterns).
3. Create shared `ConfirmAction` (currently copy-pasted in `AdminArticleActions`, `AdminMemberActions`, `AdminTagActions`).
4. Add shared `<Header>/<Nav>` for reader-facing app (currently missing entirely).
5. Replace scattered inline `style={{}}` props with layout utilities.
6. Introduce `next/font` and a proper modular type scale.

### Net-New Features Greenlit (in roadmap)
_Proposed by Rusty · 2026-06-19_
- **Reader font/theme controls** (M5): font-size steps + light/sepia/dark theme persisted to localStorage.
- **Saved-word flashcard review** (M6): spaced repetition over existing `SavedWord` model.
- **Reading streaks / daily goal** (M6): new dashboard widget.
- **Global article search** (M4): new search endpoint (Livingston) + search UI.

### Must-Not-Break Constraints (all milestones)
_Proposed by Rusty · 2026-06-19_
Prisma schema & committed migrations; AI graceful degradation (`fallback:true`); NextAuth DB-session + role attach; `middleware.ts` matcher paired with `requireSession`/`requireOnboardedSession`/capability guards; `sanitizeArticleHtml` always wraps `dangerouslySetInnerHTML`; `ListingProgressSync` DOM contract (`js-progress-bar/label/done`, `data-article-id`); US-030 cache tag invalidation; cached fns prisma-only/date-safe.

---

## Redesign Roadmap M4–M9: COMPLETE
_2026-06-19_

The full user-facing product is now on the Studio design system. Net-new shipped across M4–M9: global search + ⌘K command palette, reader reading-modes (light/sepia/dark) + tabbed AI tools panel + audio mini-player, gamification (streaks/daily-goal/flashcard SRS), 4-step onboarding wizard, daily-goal editing in Settings, admin design-system polish and shared `ConfirmAction`. Every milestone landed green: typecheck 0 · lint 0 · build green · npm test 153/153 (full regression M4–M9 verified by Basher).

---

## Post-redesign features

> **Post-redesign rich features M10–M16 COMPLETE** — bookmarks, highlights/notes, AI tutor, sentence translation, quiz mastery, personalized feed, pronunciation practice.

---

## M16 — Pronunciation Practice: COMPLETE (e895e72)
_2026-06-19 · Saul (UX spec), Livingston (PronunciationAttempt migration + token endpoint + attempt/history APIs), Linus (Speak tab + browser Speech SDK + non-color cue), Rusty (review), Basher (verify)_

**Status: LANDED** — Rusty APPROVE-WITH-NITS (key never client-side, no audio stored, no IDOR; FIX-1 applied) · Basher CONDITIONAL PASS→PASS (fake-mic end-to-end, legend fix, credential security confirmed) · committed e895e72.

### Scope
Pronunciation practice as the 7th "Speak" tab in the reader tools panel. Users step through article sentences and receive per-phoneme/per-word accuracy scores via Azure Cognitive Services Pronunciation Assessment. "Hear it" reuses M5 narration audio; no audio stored server-side.

### Data layer (Livingston)
- **Migration `m16_pronunciation`** — additive. New `PronunciationAttempt` model: `userId`, `articleId`, `sentence`, `score Int` (overall), `feedback` (JSON-stringified phoneme data), `attemptedAt`; `@@index([userId, articleId])`; cascade-deletes with User and Article.
- **`src/lib/pronunciation.ts`** — `savePronunciationAttempt(userId, articleId, sentence, score, feedback)` + `getPronunciationHistory(userId, articleId)`, both ownership-scoped (`where:{userId,articleId}`).
- **`GET /api/speech/token`** — server-only: exchanges `AZURE_SPEECH_KEY` for a short-lived Azure authorization token; never exposes the raw key to the client. Returns `{configured:false}` gracefully when unconfigured.
- **`POST /api/reader/[id]/pronunciation`** — saves attempt (401 unauth, 404 bad article, ownership-scoped).
- **`GET /api/reader/[id]/pronunciation/history`** — per-sentence best/last scores (401 unauth, 404 bad article, ownership-scoped).

### UI layer (Linus)
- **`ArticleSpeakTab.tsx`** — 7th "Speak" tab; `microsoft-cognitiveservices-speech-sdk` dynamically imported (SSR-safe, no server bundle); `fromAuthorizationToken` from `GET /api/speech/token`.
- **Score ring + sub-bars** — `--pron-*` token family (teal-anchored); overall accuracy ring + pronunciation/fluency/completeness sub-bars; `role="img"` + `aria-label` with numeric scores.
- **Per-word feedback (non-color cue)** — never relies on color alone: underline style (`--pron-underline-*` dashes/dots) + `sr-only` severity text + visible legend panel + "words to work on" list.
- **Per-sentence Best/Last** — derived client-side from history response.
- **"Hear it"** — reuses M5 narration via `ReaderAudioProvider`; zero new audio storage.
- **States** — graceful unavailable (`{configured:false}`), mic-denied (permission rejected), transient-error (retryable — FIX-1 applied).

### Security / Privacy (Rusty + Basher)
- `AZURE_SPEECH_KEY` never sent to client; token endpoint returns short-lived token only.
- No audio stored — only `score Int` + JSON feedback persisted per attempt.
- All routes ownership-scoped `where:{userId,articleId}`; IDOR cross-user → 404 confirmed by Basher.

### Coordinator decisions
| Decision | Choice |
|---|---|
| "Speak" tab placement | 7th tab in reader tools panel |
| Per-sentence Best/Last | Derived client-side from history response |
| Cross-article speaking dashboard | DEFERRED |
| Token family | `--pron-*` (separate from `--hl-*`, `--rw-tr-*`) |

### Pre-land fixes
| ID | Fix | Owner |
|---|---|---|
| FIX-1 | Transient token failure → retryable error state, not permanent-unavailable | Linus (per Rusty review) |
| Basher-fix | Legend swatch CSS correction | Basher |

---

## M15 — Personalized home feed: COMPLETE (e504ef0)
_2026-06-19 · Saul (UX spec), Livingston (ranking lib + endpoint, no migration), Linus (ForYouFeed + why-chip + dashboard rework), Rusty (review), Basher (verify)_

**Status: LANDED** — typecheck 0 · lint 0 · build green · npm test 323/323 · Rusty APPROVE-WITH-NITS (card contract intact, no IDOR) · Basher PASS 47 checks · committed e504ef0.

### Scope
Dashboard "Browse" grid + level filter replaced by a ranked **For You** feed (level + topics + freshness, completed hard-excluded, in-progress −15 penalty). `/browse` remains the explicit category/Picks explorer; "Browse by topic →" band links the two. Each card optionally shows a quiet "why" chip. No DB migration.

### Data layer (Livingston)
- **`src/lib/feed.ts`** — `getPersonalizedFeed(userId, {offset, limit})`. Scoring: category match +40, tag match +10/tag cap +20, level proximity 0–30 (harder articles penalised more steeply than easy), freshness 0–10 (≤7d +10 … older 0), in-progress −15. Completed articles hard-excluded. Diversity pass: ≤3 consecutive same-category (O(n) deferred-append). No-profile fallback: newest-first, never errors. Max score 100.
- **`GET /api/feed`** (`createHandler`, session-gated, NOT cached, user-scoped). Query: `offset` (default 0, min 0) + `limit` (default 10, max 24). Response: `{articles, progress, hasMore, offset, reasons}`. 4 batched DB queries — no N+1. `reasons` map keyed by `articleId`.

### UI layer (Linus)
- **`ForYouFeed.tsx`** (new client component) — mirrors `CategoryBrowser` minus tab bar; load-more (`GET /api/feed?offset=N&limit=6`, de-dupe by id, merge progress+reasons+savedIds); card DOM contract verbatim (all 5 `js-progress-*` hooks + `data-article-id` wrapper+Link + `.js-bookmark`); `ListingProgressSync` + `ListingBookmarkSync` over growing id set. States: cold-start `EmptyState`, end-of-feed `role="status"` cap + "You're all caught up.", `aria-live="polite"` sr-only load-more count.
- **`ArticleCardView.tsx`** (additive only) — optional `reason?: string` prop renders `.rw-why-chip` (muted neutral palette — NOT teal, NOT indigo; `Sparkles` icon `text-text-subtle`; `aria-label="Recommendation reason: …"`; zero layout shift when absent; all other callers unaffected).
- **Dashboard rework** — `searchParams`/level-filter/`listPublishedArticles`/`filterAndSortByLevel` removed cleanly. Section order: h1 → progress stats → continue-reading rail → For You → Browse-by-topic band (matches Saul §1.2). SSR first page via `getPersonalizedFeed`; `railIds` and `feedIds` sync sets are disjoint; `bookmarkedIds` fetched for their union.

### Coordinator decisions
| Decision | Choice |
|---|---|
| "Why" chip | ON by default |
| Dashboard level filter | Removed |
| Dismiss / "not interested" | DEFERRED |

### Deferred nits (3)
| ID | Description |
|---|---|
| N1 | Double profile fetch in SSR dashboard |
| N2 | `savedIds` immutable after load-more (matches CategoryBrowser parity) |
| N3 | Double blank line in globals.css |

### Cleanup note
4 stray untracked debug scripts removed pre-commit: `scripts/_audit_ids.ts`, `_audit_inspect.ts`, `_audit_pub.ts`, `_audit_session.ts`. All were gitignored, none ever committed. `_audit_session.ts` contained a hardcoded userId; `_audit_pub.ts` was not flagged in Rusty's review (only 3 named) but is included in the spawn manifest cleanup count.

---

## M14 — Quiz Mastery & History: COMPLETE (01380fc)
_2026-06-19 · Saul (spec), Livingston (QuizAttempt model + 3 endpoints + migration), Linus (record-once + Sparkline + MasteryWidget + dashboard/study UI), Rusty (review), Basher (verify)_

**Status: LANDED** — typecheck 0 · lint 0 · build green · npm test 300/300 · Rusty APPROVE-WITH-NITS (no double-record, no IDOR) · Basher PASS 38 checks · committed 01380fc.

### Scope
Per-article quiz attempt recording + aggregated mastery view: enriched quiz result block (this-attempt score, article best, compact attempt history) in the reader's Quiz panel; `MasteryWidget` as a 3rd "Your progress" card on the dashboard; Comprehension section on the `/study` page.

### Data layer (Livingston)
- **Migration `m14_quiz_attempts`** — additive. New `QuizAttempt` model: `userId`, `articleId`, `correctCount`, `totalQuestions`, `scorePct Int` (server-derived), `completedAt`; `@@index([userId, articleId])` + `@@index([userId])`; cascade-deletes with User and Article.
- **`src/lib/quiz-mastery.ts`** — `recordQuizAttempt(userId, articleId, correctCount, totalQuestions)` (server-side `scorePct`, cross-field guard `correctCount ≤ totalQuestions`→400, post-insert `_max` for best); `getArticleQuizHistory(userId, articleId)` (all attempts, ownership-scoped); `getQuizMastery(userId)` (3 parallel queries: avg via Prisma `_avg`, `recentTrend` last-10 oldest→newest, overall best).
- **3 endpoints** (`createHandler`, 401 unauth, 404 bad article): `POST /api/reader/[id]/quiz/attempt`, `GET /api/reader/[id]/quiz/history`, `GET /api/quiz/mastery`.

### UI layer (Linus)
- **`ArticleQuiz.tsx`** — grading UNCHANGED; `recordedRef` guard (set synchronously before fetch; reset in `handleRetry`; POST failure isolates to `savedNote="failed"`); quiz result block shows score + best + recent attempts.
- **`Sparkline.tsx`** — reusable SVG polyline component; `aria-hidden` + `sr-only` label with scores + trend direction.
- **`MasteryWidget.tsx`** — server component; ring `role="img"` with `aria-label`; rendered in dashboard `Promise.all`; `md:col-span-2 lg:col-span-1` band layout.
- **`/study` page** — Comprehension section with `MasteryWidget` + per-article history tables.

### Coordinator decisions
| Decision | Choice |
|---|---|
| Average score | Mean of ALL attempts (Prisma `_avg`) |
| `isNewBest` | Derived client-side (`priorBest === null \|\| attempt.scorePct > priorBest`) |
| Per-article study table | DEFERRED |

### Deferred nits (2)
| ID | Description |
|---|---|
| N1 | "Try again" button should use `btn-primary` (indigo) instead of plain `btn` |
| N2 | Unused `active` prop on `ArticleQuiz` component |

---

## M13 — Sentence-level Translation: COMPLETE (47f7aa6)
_2026-06-19 · Saul (spec), Livingston (cache model + lib + endpoint + migration), Linus (Translate toolbar action + SentenceTranslatePopover + shared-lang + M11 mark-persistence fix), Rusty (review), Basher (verify)_

**Status: LANDED** — typecheck 0 · lint 0 · build green · npm test 281/281 · Rusty APPROVE-WITH-NITS · Basher CONDITIONAL PASS→PASS (D1 M11 bug fixed) · committed 47f7aa6.

### Scope
Sentence/phrase translation directly from text selection in the reader: Translate action in the M11 `SelectionToolbar`, anchored `SentenceTranslatePopover` with 4 states (loading shimmer, result, fallback, network error). Language choice shared with M5 whole-article Translate tab via `localStorage["readwise:translate-lang"]`.

### Data layer (Livingston)
- **Migration `m13_sentence_translation`** — additive. New `SentenceTranslation` model: `articleId` FK (cascade delete), `sourceHash` (SHA-256 of normalized text), `targetLang`, `sourceText`, `translation`; `@@unique([articleId, sourceHash, targetLang])` + `@@index([articleId])`.
- **`src/lib/sentence-translation.ts`** — `translateSentence(articleId, text, lang)`: normalize→hash→cache lookup→article check→AI→upsert; graceful `{fallback:true}` on AI-unconfigured or AI-failure (nothing cached); `MAX_SENTENCE_CHARS=1000` exported.
- **`POST /api/reader/[id]/translate-sentence`** — `createHandler`; 400 on missing/empty/over-length text or invalid lang; 401 unauth; 404 missing article.

### UI layer (Linus)
- **`src/lib/translate-lang.ts`** — shared `TRANSLATE_LANG_KEY`/`TRANSLATE_LANG_DEFAULT="zh-Hans"`/`getTranslateLang()`/`setTranslateLang()` with SSR guards.
- **`src/components/SentenceTranslatePopover.tsx`** — `"use client"`; fixed-position; 4 states (shimmer `prefers-reduced-motion`-gated, result `lang`+`dir="auto"` for RTL, fallback italic+Retry, network error `role="alert"`+Retry); React `<p>` text nodes only, never `dangerouslySetInnerHTML`.
- **`SelectionToolbar.tsx`** — Translate button (Languages icon); final order: Highlight · Translate · Add note · Define.
- **`WordLookup.tsx`** — `openSurface` gains `"translate"`; `runSentenceTranslate` with `translateReqRef` stale-request guard; `handleTranslate` transitions `toolbar→translate` without `closeAll` (preserves `savedAnchorRef`); `closeAll` resets translate state, retains `translateLang`.
- **`ArticleTranslation.tsx`** — seeds `lang` from and writes to `readwise:translate-lang` on change (shared key).
- **`globals.css`** — `.rw-tr-*` family appended (≈160 lines); no existing rule touched.
- **M11 latent bug fixed (found by Basher):** `useMemo` on `dangerouslySetInnerHTML` prop in `WordLookup` — React 19 uses reference equality; inline object creation was resetting `innerHTML` on every re-render, wiping M11 `<mark>` highlight nodes.

### Coordinator decisions
| Decision | Choice |
|---|---|
| Shared lang key default | `zh-Hans` |
| Fallback unavailable state | calm inline note (not `role="alert"`) |
| Toolbar button order | Highlight · Translate · Add note · Define (Add note preserved) |

### Deferred nits (4)
| ID | Description |
|---|---|
| N1 | Validate seeded `translateLang` against the `languages` prop in WordLookup (ArticleTranslation already validates) |
| N2 | Client-side 1000-char guard in `handleTranslate` (currently relies on API 400) |
| N3 | Toolbar order vs Saul's 3-action diagram (Highlight·Translate·Define); Add note preserved as capability addition |
| N4 | Redundant `stopPropagation` in `SentenceTranslatePopover` (outside-click already exempted via ref) |

---

## M12 — AI Tutor: COMPLETE (96ab8d0)
_2026-06-19 · Saul (spec), Livingston (data + grounded-chat + 3 endpoints + migration), Linus (UI + Ask tab + XSS-safe tokenizer), Rusty (review), Basher (verify)_

**Status: LANDED** — typecheck 0 · lint 0 · build green · npm test 267/267 · Rusty APPROVE-WITH-NITS (no XSS/IDOR) · Basher PASS + D1/D2 fixed · committed 96ab8d0.

### Scope
Per-article AI tutor: users ask questions grounded in article text; answers are CEFR-level-tailored. 6th "Ask" tab in reader panel.

### Data layer (Livingston)
- **Migration `m12_tutor`** — additive. New `TutorMessage` model: `userId`, `articleId`, `role` (user/assistant), `content`, `createdAt`; `@@index([userId, articleId])`; cascade-deletes with User and Article.
- **`src/lib/tutor.ts`** — `askTutor`: grounded via `htmlToPlainText`, CEFR-level-tailored prompt, gpt-5-mini params, graceful `fallback:true` (persists nothing on AI miss).
- **3 endpoints** (`createHandler`, 401 unauth, 404 bad article, ownership-scoped): `GET /api/reader/[id]/tutor` (history), `POST` (send question), `DELETE` (clear conversation).

### UI layer (Linus)
- **`src/lib/tutor-markdown.ts`** — pure TS XSS-safe tokenizer (no JSX, no HTML output); 25 unit tests.
- **`ReaderTutorProvider.tsx`** — `"use client"` context: GET on mount, append on send, clear action.
- **`ArticleTutor.tsx`** — chat panel: message list, composer, Saul-worded starter chips, per-message timestamps, graceful-unavailable state, Clear button (min-width D2 fixed, autofocus D1 fixed).
- **`ReaderToolsPanel.tsx`** — 6th "Ask" tab (Sparkles icon). Additive `.rw-tutor*` CSS.

### Pre-land fixes
| ID | Fix | Owner |
|---|---|---|
| F1 | `@media (prefers-reduced-motion)` class typo `rw-tutor-typing-label` → `rw-tutor-thinking-label` | Linus |
| D1 | Composer autofocus on panel open | Basher |
| D2 | Clear button min-width | Basher |

### Coordinator decisions
| Decision | Choice |
|---|---|
| Tab label | "Ask" |
| Per-message timestamps | shown |
| Starter-question wording | Saul's spec |

---

## M11 — Highlights & Notes: COMPLETE (1e69c01)
_2026-06-19 · Saul (spec), Livingston (data + anchor + 4 endpoints + migration), Linus (UI + selection state machine + mark rendering), Rusty (review), Basher (verify)_

**Status: LANDED** — typecheck 0 · lint 0 · build green · npm test 219/219 (28 new) · Rusty APPROVE-WITH-NITS (no XSS/IDOR) · Basher PASS · committed 1e69c01.

### Scope
Per-user text highlighting + annotation in the reader. Highlights anchor to plain-text offsets with prefix/suffix fallback re-anchoring. New "Notes" panel as 5th reader tab.

### Data layer (Livingston)
- **Migration `m11_highlights`** — purely additive. New `Highlight` model: `userId`, `articleId`, `quote`, `startOffset/endOffset Int`, `prefix/suffix String @default("")`, `note String?`, `color String?`, `@@index([userId, articleId])`. Cascade: User→Highlights; Article→Highlights (all users).
- **`src/lib/highlights.ts`** — 5 helpers, all ownership-scoped: `listHighlights`, `createHighlight`, `updateHighlight` (anchor immutable), `deleteHighlight`, `getHighlightCounts` (batch per-article for listing badges). `validateAnchor` exported for reuse. `HIGHLIGHT_NOTE_MAX = 2_000` exported as single source of truth. IDOR: every helper includes `userId` in WHERE clause.
- **4 endpoints** (all `createHandler`, 401 unauth, 404 on ownership/article miss):

| Endpoint | Purpose |
|---|---|
| `GET /api/reader/[id]/highlights` | User's highlights on article, ordered by `startOffset` |
| `POST /api/reader/[id]/highlights` | Create (201, 400 bad anchor, 404 bad article) |
| `PATCH /api/highlights/[id]` | Update note/color only — anchor fields immutable (200, 404 not-owner) |
| `DELETE /api/highlights/[id]` | Delete (200, 404 not-owner) |

### UI layer (Linus)
- **Gesture-disambiguation state machine** in `WordLookup.tsx`: `OpenSurface = "dictionary" | "toolbar" | "popover" | null`. Collapsed click → dictionary (unchanged); drag-select → `SelectionToolbar`; click on `mark.rw-hl` → `HighlightEditPopover`. Mutually exclusive by construction — single `handleSelect` handler, single open-surface state.
- **`<mark>` rendering** via TreeWalker + `splitText` over sanitized DOM nodes (no re-sanitize, no `innerHTML` after initial `dangerouslySetInnerHTML`). Applied in reverse document order. Re-anchor on load: offset-first, prefix/suffix fallback, orphaned indicator for unresolvable.
- **`--hl-*` color tokens** (yellow/green/blue/pink ×3 reading modes in `tokens.css`) — distinct from teal/indigo, scoped to `[data-reading-mode]`. AA-verified 12 token values.
- **`ReaderHighlightsProvider`** — client context: eager fetch, optimistic CRUD, orphan tracking, `aria-live` announcements; overlap → keep-earliest + toast; last-used color persisted to localStorage.
- **`HighlightEditPopover`** — click-a-mark popover: 4 color swatches (`role="radiogroup"`), note textarea (2000-char cap, counter near cap), M8 `ConfirmAction` delete.
- **`ReaderNotesPanel`** — 5th "Notes" tab (`Highlighter` icon): highlights in document order, inline note editing, scroll-to + flash, orphaned indicator, M4 `EmptyState`.

### Pre-land fixes (F1–F3 all done)
| ID | Fix | Owner |
|---|---|---|
| F1 | `applyHighlightMarks` crash-guard for overlapping DB highlights — `splitText` offset clamp before apply | Linus |
| F2 | `HighlightEditPopover` positioning `useEffect` dep array `[]` → `[anchorEl]` — eliminates per-keystroke layout thrash | Linus |
| F3 | Server note cap 50k → `HIGHLIGHT_NOTE_MAX` (2000); both route schemas updated; no DB change | Livingston |

### Coordinator decisions
| Decision | Choice |
|---|---|
| Highlight color overlap | Keep-earliest + toast |
| Last-used color | Persisted to localStorage (client) |
| Note cap | 2,000 chars (`HIGHLIGHT_NOTE_MAX`) |
| Global cross-article notes view | DEFERRED |

### IDOR audit (Rusty)
All PATCH/DELETE routes use `findFirst({where:{id,userId}})` — a user cannot reach another user's highlights; returns 404 (not 403) on miss. GET scoped by session userId. `POST` scopes creation to session user. **No IDOR path found.** Basher independently confirmed: cross-user PATCH/DELETE → 404; GET returns only requesting user's highlights.

### Deferred nits (Rusty, 5 non-blocking)
| ID | Item |
|---|---|
| N1 | `disabled={atLimit && noteLen > NOTE_MAX}` — simplifies to `disabled={atLimit}`; `maxLength` makes >2000 unreachable via keyboard |
| N2 | `flashAndScroll` template-literal selector — prefer `querySelectorAll` + `.filter` to be robust to future ID format changes |
| N3 | Escape in `HighlightEditPopover` calls `anchorEl.focus?.()` on a non-focusable `<mark>` — should redirect focus to prose ref |
| N4 | Overlap merge: sequential `await remove()` — no rollback on partial failure; acceptable since client prevents overlaps |
| N5 | 80ms `setTimeout` in `handleAddNote` to open edit popover after mark apply — fragile on slow renders; `MutationObserver` would be robust |

---

## M10 — Bookmarks & Reading Lists: COMPLETE (c676921)
_2026-06-19 · Saul (spec), Livingston (data + endpoints), Linus (UI), Rusty (review), Basher (verify)_

**Status: LANDED** — typecheck 0 · lint 0 · build green · npm test 191/191 (38 new: 18 lib + 22 route + 1 leftover) · Rusty APPROVE-WITH-NITS · Basher PASS (57 checks, IDOR clean) · committed c676921.

### Scope
Per-user reading lists + quick-bookmark affordance. New `/lists` "Saved" page in the main nav.

### Data layer (Livingston)
- **Migration `m10_reading_lists`** — purely additive. Two new models: `ReadingList` (`@@index([userId])`, `isDefault Bool`) and `ReadingListItem` (`@@unique([listId,articleId])`, `@@index([articleId])`). Back-references on `User` + `Article`. Cascade: User→Lists→Items; Article→Items; List→Items.
- **`src/lib/bookmarks.ts`** — 9 helpers, all ownership-scoped: `getOrCreateDefaultList`, `getUserLists`, `getListWithArticles`, `createList`, `renameList`, `deleteList` (refuses default, 409), `addToList` (idempotent), `removeFromList` (idempotent), `toggleBookmark`, `getBookmarkedArticleIds` (batch), `getArticleListMembership`.
- **8 endpoints** (all `createHandler`, session-gated, 401 unauth, 404 on ownership failure):

| Endpoint | Purpose |
|---|---|
| `GET /api/lists` | User's lists, default first, with count |
| `POST /api/lists` | Create named list (201) |
| `PATCH /api/lists/[id]` | Rename (ownership) |
| `DELETE /api/lists/[id]` | Delete (ownership; 409 on default) |
| `POST /api/lists/[id]/items` | Add article (idempotent) |
| `DELETE /api/lists/[id]/items/[articleId]` | Remove article (idempotent) |
| `POST /api/bookmarks/toggle` | Quick-toggle default list; lazily creates default |
| `GET /api/bookmarks/membership?articleId=` | All lists + hasArticle flags for list-picker popover |
| `POST /api/saved` | Batch bookmark-status check for `ListingBookmarkSync` client refresh |

### UI layer (Linus)
- **`ReaderBookmarkCluster`** — split-pill in `.reader-meta` row (`ml-auto`): Segment A (default-list Save/Saved toggle, `aria-pressed`, indigo filled-Bookmark icon, optimistic + revert, `role="status"` error live region, `rw-pop` on save) + Segment B (`ListPlus` icon, opens `ListPickerPopover`, dot indicator when in any named list).
- **`ListPickerPopover`** — non-modal dialog, membership checkboxes from `GET /api/bookmarks/membership`, inline "New list" creation, focus trap, Escape + outside-click close.
- **`CardBookmarkButton`** — sibling-overlay on cards (never nested in `<Link>`). Root `<div data-card-wrapper data-article-id>` wraps Link (all `.js-progress-*` hooks unchanged) + button sibling. `js-bookmark` / `data-saved` DOM contract.
- **`ListingBookmarkSync`** — client mount-phase hydrator (parallel to `ListingProgressSync`). Reads sessionStorage (`readwise:bookmark-changes`), calls `POST /api/saved`, updates `data-saved` + `aria-pressed` in the DOM.
- **`ListSwitcher`** — desktop sidebar + mobile snap-scroll pill bar; inline create/rename/delete; `ConfirmAction` for delete.
- **`/lists` page** (`src/app/(app)/lists/page.tsx`) — gated with `requireSession("/lists")`; `?list=<id>` URL param; SSR via `getUserLists` + `getListWithArticles` + `getProgressMap` + `getBookmarkedArticleIds`; M4 `EmptyState`.
- **Modified listings** — browse, dashboard, tags, reader all call `getBookmarkedArticleIds` for SSR first-paint; drop `ListingBookmarkSync` where needed.
- **CSS additive** — M10 section: `.js-bookmark[data-saved="true"] svg { fill: currentColor }`, card-removal fade, `.lists-layout` / `.lists-sidebar` / `.lists-mobile-bar` / `.lists-panel-header` / `.lists-mobile-switcher` (900px breakpoint).

### Coordinator decisions
| Decision | Choice |
|---|---|
| Nav label | "Saved" (not "Lists" or "Bookmarks") |
| Route | `/lists` |

### IDOR audit (Rusty)
All routes verified: every helper uses `findFirst({where:{id,userId}})` before mutation. 404 (not 403) on ownership failure — existence not leaked. Double-checked on `/lists` page: `listParam` resolved only within userId-filtered results; `getListWithArticles` adds second ownership layer. **No IDOR path found.**

### Deferred nits (Rusty, non-blocking)
| ID | Item |
|---|---|
| N1 | `getOrCreateDefaultList` lacks DB-level `@@unique` guard on `(userId, isDefault=true)`; narrow concurrent-first-use race; degrades gracefully |
| N2 | `renameList`/`deleteList` TOCTOU between ownership check and mutation (safe in practice with CUIDs) |
| N3 | `ListSwitcher` uses `role="tablist"` + `role="tab"` on `<Link>` — should be `role="navigation"` + `aria-current="page"` |
| N4 | Dual DOM trees (desktop sidebar + mobile pill bar) lack `aria-hidden` on the hidden copy |
| N5 | `CategoryBrowser` "Load more" cards default `saved=false` (no batch in `GET /api/articles` yet) |
| N6 | `ConfirmAction className="!p-0"` in `ListSwitcher` (Tailwind `!important` override; no functional impact) |

---

## M9 — Command Palette + Final A11y/Motion QA: COMPLETE (dff6c1f)
_2026-06-19 · Yingting Huang (requester) · Saul (spec), Linus (build), Rusty (review), Basher (verify)_

**Status: LANDED** — typecheck 0 · lint 0 · build green · npm test 153/153 · Rusty APPROVE-WITH-NITS · Basher PASS (full M4–M9 regression) · committed dff6c1f.

### Scope
⌘K command palette (headline feature, reuses `GET /api/search`); global `:focus-visible` ring baseline; reduced-motion baseline for all animations; 15-nit sweep across M5–M8/shell.

### What shipped

**Pass A — Command palette (Linus)**
- `src/components/command/CommandPalette.tsx` — modal: overlay/panel, combobox+listbox ARIA engine (focus stays on input; `aria-activedescendant` drives highlight), all states (empty-query, loading skeletons, results, no-results, error, show-more pagination).
- `src/components/command/CommandPaletteProvider.tsx` — global ⌘K / Ctrl+K / `"/"` (outside editable) listener; `useCommandPalette()` context; mounts only in the authed app shell.
- `src/components/command/command-items.ts` — static Pages + Actions definitions, fuzzy scorer.
- `src/components/command/useArticleSearch.ts` — debounced (200ms), abortable fetch against `GET /api/search`; `latestQueryRef` stale-response guard in `search()`.
- `src/components/shell/HeaderSearch.tsx` — desktop faux search-box + mobile icon button (resolves M2 N4).
- **Global `:focus-visible` ring** (`@layer base`, `:where(...)` zero-specificity — resolves M1/M2 N2).
- Reduced-motion block: `animation:none !important; opacity:1 !important; transform:none !important` (identity, not duration-0) for all palette animations.

**Pass B — 15-nit sweep (Linus)**
- NIR-M5-1: `isMobile` media-query state in `ReaderToolsPanel`; `PanelContents` renders in only one slot; split `asideTabListRef`/`sheetTabListRef`.
- NIR-M5-2 + focus-trap: `closeButtonRef` focus on sheet open; full `getFocusable` Tab-trap; `fabRef` focus restore on close.
- M6 `extendedToday`: real value wired to StreakWidget flame flicker.
- M6 StudyList dim: `StudyPageShell` lifts `reviewing` bool; `inert + aria-hidden + opacity-60` on saved-words list while reviewing.
- M6 `rw-pop` SSR: `GoalMetIcon` client component suppresses animation on initial mount (SSR flash fixed).
- M7 N1: daily-goal input `onBlur` clamp `[DAILY_GOAL_MIN, DAILY_GOAL_MAX]`.
- M7 N2: stepper pills → `<nav aria-label="Onboarding progress"><ol>` + `<li aria-current="step">`.
- M7 N4: `LEVEL_HINTS` exported from `src/lib/profile.ts`; duplicate removed from both forms.
- M8 N1: `ConfirmAction` controlled mode (`open`/`onOpenChange` props); `AdminArticleActions` mutual exclusion via `openPanel` state.
- M8 N2: `statusBadgeVariant()` extracted to `src/lib/admin.ts`; three consumers updated.
- M8 N3: `ConfirmAction` `useId()` `msgId`; `aria-describedby` + `id` on alertdialog `<p>`.
- M8 N4: `.admin-actions { min-width: 220px }` restored.
- M1 N3: `Spinner` track uses `stroke="var(--border)"` (theme-aware token).
- M2 N3: `aria-label` removed from `role="menu"` div in `UserMenu`.

**Pre-land fixes (Linus, per Rusty FIX-BEFORE-LAND)**
- FIX-1: `aria-expanded={true}` on combobox input (was `selectableItems.length > 0` — ARIA violation when "No results" shown).
- FIX-2: `loadMore` stale-response guard added (mirrors existing `search()` `latestQueryRef` pattern).

### Coordinator decisions
| Decision | Choice |
|---|---|
| Command palette scope | Palette-only — no standalone `/search` page (reuses `GET /api/search` via palette) |
| `GoalMetIcon` reactive pop | Accepted no-op: SSR flash fixed; reactive not-met→met animation deferred (no client-observable goal-met signal available in M9) |

### Post-M9 nits (Rusty, deferrable)
| ID | Item |
|---|---|
| NIT-1 | `GoalMetIcon` reactive animation dead letter — gate `setPop` on a client-observable "goal just became met" signal |
| NIT-2 | `loadMore` stale-query guard (applied as FIX-2 pre-land; noted for completeness) |

---

## M8 — Admin Design System Polish: COMPLETE (a631aa9)
_2026-06-19 · Saul (spec), Linus (build), Rusty (review), Basher (verify)_

**Status: LANDED** — typecheck 0 · lint 0 · build green (41 routes) · npm test 153/153 · Rusty APPROVE · Basher PASS · committed a631aa9.

### Scope
Surface-polish only: map `/admin` onto Studio design system (M1 primitives + tokens), extract shared `ConfirmAction`. No behavior, gating, API, or schema changes.

### What shipped
- **`ConfirmAction`** (`src/components/ConfirmAction.tsx`, `"use client"`): `role="alertdialog"`, focus→Cancel on open, Escape closes+returns focus to trigger, `aria-expanded`/`aria-busy`. Props: `triggerLabel`, `triggerVariant`, `confirmVariant`, `onConfirm`, `loading`, `disabled`/`disabledTitle`.
- **`CardTitle level` prop** (N3 from M7): `"h2"|"h3"|"h4"` default `"h3"` — non-breaking; `CardTitleProps` re-exported. Settings cards now use `level="h2"`.
- **AdminNav**: indigo pill active link (`border-primary text-primary-text color-mix(primary 8%)`) — coordinator decision; never teal; `aria-current="page"` preserved.
- **3 action components refactored**: `AdminArticleActions`, `AdminMemberActions`, `AdminTagActions` — all use `ConfirmAction`; Playwright selectors `.admin-actions`/`.admin-actions-row`/`.admin-confirm` preserved.
- **5 admin pages migrated**: M1 `Card`/`Badge`/`CefrBadge`/`Input`/`Select`/`Button` throughout; `tabIndex`+`aria-label` on scrollable table wrappers.
- **`globals.css` tokenized**: admin block hardcoded hex removed (`#20242d`, `#3a1d22`/`#7f3a44`/`#ffb4bd`); retired classes carry `/* retired — M8 */` (kept for Playwright); `.admin-table tr:hover td` indigo hover added.

### Coordinator decision
| Decision | Choice |
|---|---|
| AdminNav active state | Indigo pill — never teal (teal = reading-state only) |

### Deferred nits → M9
| ID | Item |
|---|---|
| N1 | `AdminArticleActions` dual-open ConfirmAction panels (no mutual exclusion) |
| N2 | `statusBadgeVariant()` copy-pasted 3× — extract to `src/lib/admin.ts` |
| N3 | ConfirmAction `<p>` lacks `id`+`aria-describedby` on alertdialog |
| N4 | `.admin-actions { min-width:220px }` dropped — validate narrow-width in M9 QA |

---

## M7 — Onboarding / Auth / Settings Polish + Daily-Goal: COMPLETE (cb204c5)
_2026-06-19 · Yingting Huang (requester) · Saul (spec), Livingston (backend), Linus (build), Rusty (review), Basher (verify)_

**Status: LANDED** — typecheck 0 · lint 0 · build green (31 routes) · npm test 153/153 · Rusty APPROVE · Basher PASS (73 checks) · committed cb204c5.

### Scope
Polish sign-in, onboarding, and settings onto the Studio design system; turn onboarding into a 4-step wizard; add the daily-goal stepper deferred from M6 (D4).

### What shipped
- **Sign-in**: branded `<Card>` layout, Wordmark + ThemeToggle top-bar, error-banner mapping (`OAuthAccountNotLinked`/`AccessDenied`/generic), `rw-fade-up` entrance, neutral `LogIn` icon on provider buttons.
- **Onboarding**: 4-step wizard (`englishLevel` → `topics[]` → `ageRange/gender` → review) with segmented-pill stepper, `aria-live` progress, `key={step}` remount + `useEffect([step])` heading focus, `CefrBadge` radio-cards, step-4 Edit-jump. POSTs identical `{englishLevel,topics,ageRange,gender}` body to `/api/onboarding` — no `dailyGoal`; DB default 2 applies. `completedAt` server-side unchanged.
- **Settings**: 3 `<Card>` sections (Profile / Reading preferences / Account). Daily-goal `−/input/+` stepper range `[1,10]`; out-of-range typed input clamped; `PUT /api/profile` body includes `dailyGoal`.
- **Backend (Livingston)**: `parseProfileInput` extended with `dailyGoal?: number` (hard-reject non-integer/out-of-range; omitted → no DB update). Constants `DAILY_GOAL_{MIN,MAX,DEFAULT}` exported. 9 new tests (144 → 153 total).
- **CSS**: `@keyframes rw-step` + `.rw-step` + `prefers-reduced-motion` no-op, additive only.

### Coordinator decisions
| Decision | Choice |
|---|---|
| Provider button icons | Neutral `LogIn` lucide icon — no brand logos |
| Daily-goal range | 1–10 integer (`DAILY_GOAL_{MIN,MAX}`) |

### Deferred nits → M9
| ID | Item | Owner |
|---|---|---|
| N1 | Typed number-input `onBlur` clamp for out-of-range entry | Linus |
| N2 | Stepper pills: `<nav><ol>` or `role="tablist"` | Linus |
| N3 | `CardTitle` `level` prop (settings uses bare `<h2>`) | M8 |
| N4 | `LEVEL_HINTS` duplication across OnboardingForm + ProfileSettingsForm | Linus |

---

## M6 — Dashboard & Study Gamification: COMPLETE (1beea38)
_2026-06-19 · Yingting Huang (requester) · Saul (spec), Livingston (data), Linus (UI), Rusty (review), Basher (verify)_

**Status: LANDED** — typecheck 0 · lint 0 · build green (31 routes) · npm test 144/144 · Rusty APPROVE-WITH-NITS · Basher PASS (87 checks) · committed 1beea38.

### Scope
Light gamification only (coordinator decision): reading streaks, daily goal, and flashcard SRS. No XP, badges, leaderboards, or social features.

### What shipped

**Data layer (Livingston + F1)**
- Additive migration `20260619080608_m6_gamification`: new `DailyActivity` model (`@@unique([userId, date])`, tracks `articlesRead` per UTC calendar day, cascade on User); `SavedWord` +5 SRS columns (`dueAt?`, `intervalDays` 0, `easeFactor` 2.5, `repetitions` 0, `lastReviewedAt?`); `Profile.dailyGoal Int @default(2)`.
- `src/lib/srs.ts` — pure SM-2 engine. Grades: again (reset reps+interval=1, EF−0.2), hard (q=3, EF−0.14, 0.6× interval cap), good (q=4, EF stable), easy (q=5, EF+0.10). EF floor 1.3.
- `src/lib/activity.ts` — `recordReadingActivity` (re-counts distinct articles from ReadingProgress today, upserts DailyActivity — idempotent); `getStreakSummary` (currentStreak anchors today or yesterday, longestStreak, last7Days dot-row, dailyGoal from Profile).
- `src/lib/flashcards.ts` — `getDueFlashcards` (dueAt≤now OR null, nulls-first), `gradeFlashcard` (ownership check, SM-2 apply, persist), `getReviewSummary`.
- `src/lib/progress.ts` — `saveProgress` wires `recordReadingActivity` as try/catch side-effect; forward-only semantics preserved.
- 3 new session-gated endpoints: `GET /api/gamification/summary` → `{currentStreak, longestStreak, dailyGoal, todayProgress, last7Days[7], dueCount}`; `GET /api/study/flashcards` → `{cards, dueCount}`; `POST /api/study/flashcards/grade` body `{savedWordId, grade}` → `{dueAt, dueCount}` (400/401/404).
- **F1 (Livingston):** corrected `srs.ts` line 42 doc-comment: "1.2× interval multiplier cap" → "60% (0.6×) interval cap". No logic change; typecheck/lint/144 tests green.

**UI layer (Linus + F2)**
- `StreakWidget` (server): teal `Flame` 28px, `--text-4xl` count, 10px dot row (teal active / `border-border` inactive / `outline-2` today ring), `Award` longest-streak sub-stat; zero-streak state ("Start a streak today").
- `DailyGoal` (server): 72×72 SVG progress ring; teal un-met → success met; `role="progressbar"` + aria attrs; `rw-pop` on `Check` icon; "Adjust goal" → `/settings` (editing deferred M7).
- `FlashcardReview` (`"use client"`): state machine idle→loading→session→complete; 3D flip card; 4 indigo-anchored grade buttons (Good = solid indigo `variant="primary"`, Again/Hard/Easy = outline + status-tinted icon+hover); keyboard (Space/Enter flip, 1–4 grade, Esc end); `appStateRef` stale-closure guard; `aria-live="polite"` region; optimistic grading; `.rw-flip`/`.rw-flip-inner`/`.rw-flip-face`/`.rw-flip-back` CSS.
- Dashboard: `getStreakSummary` in `Promise.all`; "Your progress" stats band (StreakWidget + DailyGoal, `grid-cols-1 md:grid-cols-2`) between identity card and continue-reading rail. Heading order H1→H2 "Your progress" (H3s inside cards)→H2 "Browse" ✓.
- Study page: `getReviewSummary` SSR; `FlashcardReview` above saved-words section; `listing-container` max-width; `<h2>Saved words</h2>` heading added.
- CSS additive: `@keyframes rw-flame-flicker`, `rw-pop`, `.rw-flip*` family; `prefers-reduced-motion` → opacity crossfade fallback (no 3D rotation, no flicker/pop).
- **F2 (Linus):** wired `hoverStyle` in `GradeButtons` map (`style={hoverStyle}` + `hover:bg-[color:var(--hover-bg)]`); status-tinted hover now renders for Again/Hard/Easy.

**Tests:** 40 new tests — `srs.test.ts` (17), `activity.test.ts` (13), `gamification.test.ts` (10). 144/144 total, 0 regressions.

### Key decisions
| Decision | Choice |
|---|---|
| Gamification depth | Light only — no XP, badges, leaderboards (coordinator) |
| Grade button anchor | Good = solid indigo (`variant="primary"`); others = outline + status icon (coordinator) |
| Daily-goal editing | Read-only in M6; editing deferred to M7 (coordinator) |
| Accent rule | Streak flame + dots + goal ring = reading-state → teal (legitimate per accent rule) |
| `extendedToday` flame-flicker | Prop wired but always `false`; sessionStorage derivation deferred to M7 |
| StudyList dimming during review | Deferred M7 (sibling component; needs context or `data-` attr on `<main>`) |

### Deferred
| ID | Item | Owner | When |
|---|---|---|---|
| D1 | `extendedToday` flame pulse (flicker fires on streak extension) | Linus | M7 |
| D2 | StudyList `opacity-60 pointer-events-none` during active review | Linus | M7 |
| D3 | `rw-pop` reactive on goal-met (currently SSR, plays on each load if goal already met) | Linus | M7 |
| D4 | Daily-goal editing in Settings | Saul + Linus | M7 |
| D5 | Session-complete focus (`doneButtonRef`) | Linus | M7 |
| N4 | `aria-valuetext` on session progress bar + daily-goal ring | Linus | M9 a11y |

---

## M5 — Reader Redesign: COMPLETE (f199596)
_2026-06-19 · Yingting Huang (requester) · Saul (spec), Linus (build), Rusty (review), Basher (verify)_

**Status: LANDED** — typecheck 0 · lint 0 · build green (28 routes) · npm test 108/108 · Rusty APPROVE-WITH-NITS · Basher PASS (77 checks) · committed f199596.

### What shipped
- **Two-column reader layout** — reading column capped at `--measure` (66ch, Literata); sticky tools rail (≥1100px desktop); mobile bottom-sheet + FAB; outer grid `minmax(0,1fr) 360px; max-width:1160px; margin-inline:auto`.
- **`ReaderControls`** — sticky cluster: 5-step Aa−/Aa+ font-scale stepper + Light/Sepia/Dark segmented radio; roving-tabindex radiogroup; `aria-live` announcements; prefs persisted to `readwise:reader-prefs` localStorage.
- **Reading-mode token architecture** — `data-reading-mode` set on `#reader-root` ONLY (never `<html>`); `src/lib/reader-prefs.ts` mirrors `theme.ts`; no-flash inline script placed as **first child** of `#reader-root` (uses `document.currentScript.parentElement` — D5 fix); `suppressHydrationWarning` on `#reader-root`; sepia adds exactly 8 WCAG-verified hex values to `tokens.css` (additive-only).
- **AI tabbed panel** (`ReaderToolsPanel`) — Listen · Words · Quiz · Translate; panels stay **mounted** via `hidden` attribute (no unmount on tab switch); lazy-load fires once per panel per page-load via `hasFetched` ref guard; roving tabindex + arrow keys; desktop sticky rail + mobile bottom-sheet.
- **Shared audio context** (`ReaderAudioProvider`) — single `<audio>` element; `updateActiveWord` binary-search via `useCallback([words])` (stale-closure-free); `loadAudio(src,words)` / `markFallback()`; `audioRef` stable across mini-player + listen tab.
- **`ReaderMiniPlayer`** — fixed-bottom transport: Play/Pause, Skip ±10s, seek bar (teal fill), time display, speed select (0.75×/1×/1.25×/1.5×), close button; renders only when `isLoaded && !isFallback && !dismissed`.
- **Article header** — M1 `CefrBadge` (CEFR level), `Badge variant="neutral"` (⏱ reading time), `Badge variant="success"` (✓ Completed when progress.completed); hero image `border-radius:var(--radius-lg)` + slight bleed; tags as `.tag-chip` links.
- **`<main id="main-content">` landmark** added to reader page (NIR-M5-3 pre-land fix); consistent with marketing skip-link target.
- **No schema changes.** `ReaderProgress` (forward-only scroll tracking, `markArticleVisited`), `sanitizeArticleHtml`→`WordLookup` (`dangerouslySetInnerHTML`) pipeline, and `ListingProgressSync` DOM contract (`js-progress-bar/label/done`, `data-article-id`) — all preserved verbatim.

### Key decisions
| Decision | Choice |
|---|---|
| Default reading mode | Resolved global theme (inherits `data-theme` from `<html>`) |
| Mini-player controls | Skip ±10s + close button included |
| Hero image width | Slight bleed (up to `min(100%,760px)`) — visual punch, body stays at 66ch |
| Reading-mode scope | `data-reading-mode` on `#reader-root` only; dark chrome + light reading works |
| AI panel lifecycle | Stay MOUNTED via `hidden`; fetch guard via `hasFetched` ref |
| Audio architecture | Single `<audio>` shared by listen tab + mini-player via React context |

### Deferred nits
| ID | Item | Owner | When |
|---|---|---|---|
| NIR-M5-1 | Double-mount of `PanelContents` on mobile (aside CSS-hidden + sheet both live; two API calls per panel, idempotent, no correctness bug) | Linus | M6 |
| NIR-M5-2 | `firstFocusRef` never assigned; bottom-sheet opens with no focus-move (ARIA dialog requires focus inside on open) | Linus | M9 a11y |
| Mobile focus-trap | Tab-cycling within bottom-sheet does not cycle back (Escape + scrim-click close work correctly) | Linus | M9 a11y |
| Speech synthesis latency | First-generation TTS can exceed 60s on some articles | Noted | M9 perf |

---

## M4 — Listings & Discovery: COMPLETE (7e554c9)
_2026-06-19 · Yingting Huang (requester) · Saul (spec), Linus (build), Livingston (search endpoint), Rusty (review), Basher (verify)_

**Status: LANDED** — typecheck 0 · lint 0 · build green · npm test 108/108 · Rusty APPROVE-WITH-NITS · Basher PASS (121 checks) · committed 7e554c9.

### What shipped
- **`ArticleCardView` full redesign** — M1 tokens, `variant="grid"|"rail"` prop, `CefrBadge`, byline, teal reading-state progress fill, done-chip "Read", hover/focus lift (`-translate-y-0.5`+`shadow-md`+`border-border-strong`+indigo title), `motion-reduce:transform-none`. **All 5 ListingProgressSync DOM hooks preserved verbatim** (sacred contract).
- **Continue-reading rail** (dashboard) — horizontal snap-scroll `role="region"`, in-progress articles via new `listInProgressArticles` helper in `src/lib/progress.ts`.
- **`EmptyState`** (`src/components/ui/EmptyState.tsx`) — branded empty state with icon chip (`aria-hidden`), title, description, optional M1 Button-styled action link.
- **`SkeletonCard` + `SkeletonCardGrid`** (`src/components/SkeletonCard.tsx`) — M1 `Skeleton`/`SkeletonText`-based card placeholder.
- **Listing pages migrated** — dashboard (M1 identity `Card`, continue-reading rail, M1 `Select`+`Button` level filter), `CategoryBrowser` (indigo active tab, `EmptyState`, M1 `Button loading` for load-more), `tags/[slug]`, reader "related" section — all use `listing-container` (1200px max-width) + §2.1 responsive grid (1/2/3-col).
- **`GET /api/search`** — session-gated global search over published articles (`title/author/source` LIKE, case-insensitive). Response mirrors `GET /api/articles` shape. Blank query → empty array, no DB hit. 7 tests added (`tests/search.test.ts`).
- **`package.json`** — added `--experimental-strip-types` to `npm test` (Node 22.14.0 explicit requirement; pre-existing gap fixed by Livingston).

### Key decisions
| Decision | Choice |
|---|---|
| Category tab active colour | Indigo (`--primary`) — NOT teal (teal = reading-state only) |
| `listInProgressArticles` query | Separate DB query (cleaner rail, accepts ~1 extra round-trip) |
| Search caching | NOT cached (open-ended query keys, per-user progress merged) |
| Search scope for M4 | title / author / source LIKE; level+category+tag filters deferred to M9 |
| `SkeletonCardGrid` load-more wiring | Deferred (Button spinner used instead); M8 if desired |

### Deferred / nits (Rusty APPROVE-WITH-NITS)
| ID | Item | Owner | When |
|---|---|---|---|
| NIR-1 | `listInProgressArticles`: move published filter into Prisma `where` (currently JS-side; `take` may under-fill rail when unpublished rows exist) | Linus | M4.1 (in-progress cleanup) |
| NIR-2 | `--experimental-strip-types` absent from `npm run scrape\|process\|worker\|seed` | Linus | M4.1 / CI |
| NIR-3 | Duplicate `role="region"` landmark on continue-reading rail (`<section aria-label>` + inner `<div role="region">`) | Linus | M8 a11y pass |
| NIR-4 | Two separate `@/lib/cn` imports in `CategoryBrowser.tsx` | Linus | M4.1 |
| M4-F3 | `ListingProgressSync` `querySelector` refreshes first DOM match only when article appears in both rail+grid; true dual-refresh needs `querySelectorAll` | Livingston/Linus | M8 |

_Linus nit-cleanup follow-up (NIR-1 through NIR-4) is in progress._

---

## M3 — Landing / Marketing Page: VERIFIED · COMMITTED 2824eea
_2026-06-19 · Yingting Huang (requester) · Saul (UX spec), Linus (build), Basher (verify)_

**Status: LANDED** — typecheck 0 · lint 0 · build green · Basher PASS (30/30 browser checks) · committed 2824eea.

**D3 follow-up (non-blocking):** Final CTA band — `Button variant="secondary"` in dark theme renders dark surface on gradient (14:1 WCAG AAA contrast ✓). Aesthetically "dark card on colourful gradient" rather than "white/indigo on gradient." Flagged for Saul sign-off before M9 polish pass.

### What shipped
- **`src/app/page.tsx`** — server component, auth-aware via `getServerSession(authOptions)`, `export const metadata` (SEO), 6 sections (Marketing Header, Hero, Features, How It Works, Social Proof, Final CTA Band), skip-link target `#main-content`.
- **`src/components/marketing/`** — `MarketingHeader.tsx` (server, glass sticky, wordmark + ThemeToggle + auth-aware outline CTA), `MarketingFooter.tsx` (server), `Wordmark.tsx` (inline-SVG diamond glyph + Space Grotesk logotype, `<a href="/">`), `MockReaderCard.tsx` (client, pure-CSS hero reader mock with JS 3D tilt), `FeatureCard.tsx` (server, M1 Card + 3px left-border accent + Lucide icon chip + feature list), `StepCard.tsx` (server, numbered step + horizontal connector via `::after`), `Reveal.tsx` (client, IntersectionObserver scroll-reveal wrapper).
- **`src/app/globals.css`** (ADD-only) — `@keyframes rw-fade-up` at top level; `.text-gradient-brand`, `.rw-fade-up`, `.rw-reveal`, `.rw-revealed` in `@layer utilities`; `prefers-reduced-motion` override. No existing rules altered.
- **Auth-aware state**: signed-out → primary CTA "Get Started — It's Free" + ghost "Sign In"; signed-in → primary "Continue Reading →", secondary hidden.
- **Design language**: brand gradient H1 text-clip, radial-orb hero background, glass sticky marketing header (standalone — outside M2 app shell).

### Deviations from Saul's spec (Basher verified)
| ID | Deviation | Reason |
|---|---|---|
| M3-D1 | `font-bold` (700) for H1/CTA H2 vs spec 800 | Space Grotesk loaded up to 700; `layout.tsx` out of scope |
| M3-D2 | Header scroll-shadow omitted | Keep header server component; glass blur + border provide separation |
| M3-D3 | Final CTA band: `Button variant="secondary"` dark surface + light text on gradient | AA contrast; intentional look. _(D3 follow-up: Saul sign-off pending, see status above)_ |
| M3-D4 | CTAs are `<Link className={buttonVariants(...)}>` | M1 Button has no `asChild`; keyboard + focusRing preserved |

---

## M2 — Global App Shell: COMPLETE (385de06)
_2026-06-19 · Yingting Huang (requester) · Saul, Rusty, Linus, Basher_

**Status: LANDED** — typecheck 0 · lint 0 · build green · browser verification passed · committed 385de06.

### What shipped
- **Route group `src/app/(app)/`** — six authed reader folders (`dashboard`, `browse`, `reader`, `study`, `settings`, `tags`) moved under URL-transparent route group. `middleware.ts` and all `requireSession`/callbackUrl strings byte-unchanged.
- **`src/app/(app)/layout.tsx`** (server) — reads `getServerSession` for display only (user menu + role-gated admin link); does not gate; null-session-safe.
- **`src/lib/theme.ts`** (closes N4) — 3-state `Theme = "light"|"dark"|"system"`, key `readwise:theme`, SSR-safe. Compatible with existing no-flash script; `"system"` deletes `data-theme` so CSS `prefers-color-scheme` fallback wins.
- **`src/components/shell/`** — `AppShell`/`AppHeader` (server), `HeaderShell` (client sticky+scroll-shadow), `AppNav` (client usePathname active state), `ThemeToggle` (client 3-state Sun/Moon/Monitor, mounted-guard), `UserMenu` (client avatar+popover+signOut), `MobileDrawer` (client hamburger+scrim+focus-trap), `AppFooter` (client self-hides on `/reader*`/`/settings*`). Shared `nav-items.ts` (`PRIMARY_NAV` + `isActivePath`) reused by AppNav + MobileDrawer; `types.ts` ShellUser.
- **Accent rule (FINAL — resolves OPT-A from M1):** `--accent` stays aliased to `--primary` (indigo) — interactive affordances only. Added `--bg-accent: var(--teal)` / `--text-accent: var(--teal-text)` semantic aliases. Teal used ONLY for reading-state: active nav underline (2px), progress bars, CEFR badges. Teal is NEVER a clickable affordance.
- **Stripped** bespoke back-links/footer rows from all six pages; removed unused `Link`/`SignOutButton` imports; dashboard's in-content Admin button moved to UserMenu/Nav.
- **D1 fix:** legacy unlayered `a { color: var(--accent) }` in globals.css moved into `@layer base` so Tailwind utility classes override it (inactive nav links now render correct slate gray).

### Open / deferred items
| ID | Item | Owner | When |
|---|---|---|---|
| N3 | UserMenu trigger + popover both carry `aria-label="User menu"` (minor ARIA redundancy — screenreaders may announce twice) | Linus | M8 a11y pass |
| N4 | Search placeholder hidden below 640px (`hidden sm:inline-flex`) — revisit if M4 makes search prominent on mobile | Linus | M4 |

---

## M1 — Design System Foundation: COMPLETE
_2026-06-19 · Yingting Huang (requester) · Rusty, Saul, Linus, Basher_

**Status: LANDED** — typecheck 0 errors · lint 0 errors · build green (27 routes) · both themes verified · working tree clean (DEFECT-1 fixed).

### What shipped
- **Tailwind CSS v4** (`tailwindcss@4.3.1` + `@tailwindcss/postcss@4.3.1`, CSS-first, no `tailwind.config.js`) layered non-destructively over `src/app/globals.css`.
- **`src/app/tokens.css`** — single source of truth: theme-invariant scales (type/spacing/radii/motion + `prefers-reduced-motion`) on `:root`; semantic color + elevation tokens with light as `:root` default, dark via `:root[data-theme="dark"]` + `@media (prefers-color-scheme: dark)` no-JS fallback. Saul's exact hex values (WCAG AA verified).
- **Legacy aliases preserved** (`--panel→--surface`, `--muted→--text-muted`, `--accent→--primary`; `--bg/--text/--border` kept first-class). 957-line `globals.css` fully intact below the new header.
- **Theme mechanism:** blocking inline `<head>` script sets `data-theme` pre-paint (no FOUC). Storage key: `readwise:theme` (`"light"|"dark"`). Visible toggle deferred to M2.
- **3 `next/font/google` families:** Inter (`--font-sans`), Space Grotesk (`--font-display`), Literata (`--font-reading`).
- **8 UI primitives** in `src/components/ui/*` + `src/lib/cn.ts` (clsx + tailwind-merge + shared `focusRing`): Button, Card (+sub), Input, Select, Field/Label, Badge (+CefrBadge A1–C2, CategoryBadge), Skeleton (+SkeletonText), Spinner. All cva-variant, token-driven, zero `"use client"`, RSC-compatible. Exported via barrel; feature pages NOT yet migrated.
- **New deps:** `lucide-react@1.21.0`, `clsx@2.1.1`, `tailwind-merge@3.6.0`, `class-variance-authority@0.7.1`.

### Review & verify verdicts
- **Rusty (code-review gate):** APPROVE-WITH-NITS — no blockers; 5 nits tracked below.
- **Basher (independent verify):** CONDITIONAL PASS — 1 defect (DEFECT-1) found and fixed; theme/focus/primitives/regressions all pass.
- **DEFECT-1 (fixed):** `suppressHydrationWarning` was missing on `<html>` in `layout.tsx`; added by Linus before landing.

### Open / deferred items
| ID | Item | Owner | When |
|---|---|---|---|
| OPT-A | `--accent` split: CSS var = indigo (legacy continuity); teal exposed as `--teal*` + Tailwind `accent` utility for new components. Confirm or flip (one-line change in `tokens.css`). | Saul + Yingting | M2 kickoff |
| N2 | Global `:focus-visible` CSS rule (currently only on primitives via `focusRing`; legacy pages use browser defaults) | Linus | M8 a11y pass |
| N3 | Spinner track: `strokeOpacity="0.2"` vs `color-mix(…, var(--border))` per Saul spec | Linus | M8 a11y pass |
| N4 | Create `src/lib/theme.ts` `setTheme()` helper for M2 to consume | Linus | Before M2 theme toggle |
| N5 | `--text-inverted` added as `var(--bg)` — Saul to confirm value | Saul | M2 kickoff |

---

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction


## 2026-06-20 — System review issue triage and coordinator verification

### Rusty — Scoping decisions for issues #54–#78
Rusty consolidated Basher QA (29 findings), Saul Design/UX (28 findings), and Livingston Backend/Security/Perf (23 findings) into 25 GitHub issues (#54–#78), plus comments on existing #43 and #46.

Key decisions:
1. **Root-cause-first over symptom-filing:** BUG-12, BUG-15, BUG-18, BUG-21, BUG-23, and BUG-26 are all secondary to #48 (double-render) and were not filed separately.
2. **Comments vs new issues:** Livingston BUG-1 (15 failing tests) was commented on #43; Livingston SEC-6 (rate-limit gaps) was commented on #46.
3. **SEC-4 is not a duplicate of #53:** #53 covers TTS `data:` URI CSP/audio playback; #58 covers Azure Speech SDK `wss://` CSP/pronunciation recognition.
4. **SEC-5 dropped:** Client-controlled pronunciation scores are accepted as low-risk architecture until leaderboards/competition make score integrity higher-stakes.
5. **Bundle strategy:** 11 standalone critical/high issues plus 14 bundles = 25 total; bundled items share a file or tight conceptual cluster and are small-effort.
6. **#69 is a feature:** Admin analytics charts were not regressed; the text-only page needs a new chart capability.

### Squad-Coordinator — P0/P1 reader verification corrections
Coordinator browser-verified the high-severity reader claims and corrected four over-elevated/misattributed findings:
- **#54:** Closed as duplicate of #48. `aria-controls` is correctly `reader-panel-ask`; tutor panel renders; no `panelId` bug exists.
- **#55:** Re-scoped from p0 to p2. Quiz radios are correctly name-grouped; `value="on"` is harmless. Functional breakage is #48.
- **#56:** Re-scoped from p1 to p2. Translate has try/catch/finally and visible error; indefinite hang is gated by missing Azure OpenAI timeout (#42). Residual issue: client AbortController.
- **#57:** Re-scoped from p1 to needs-research. `WordLookup` is mounted (`page.tsx:265`); real drag-selection triggers the toolbar. Absent-from-DOM was a false negative.

Confirmed valid high-priority issues: **#58** (CSP blocks Azure Speech WSS), **#59** (IDOR: reader subroutes lack status filter), **#60** (JSON-LD stored XSS), and **#61** (SSRF in admin ingest).

Lesson: automated DOM findings on a page affected by #48 double-render require source/manual root-cause cross-checking before filing as Critical.


## 2026-06-20 — Work-all-issues session decision merge

### DECIDED — Root-cause Critical reader/a11y reports before filing or escalating
_Source: earlier system-review decision; retained during Scribe merge on 2026-06-20T11:38:34+00:00._

Before filing P0/P1 reader issues as Critical, verify root cause with source/manual behavior. The #48 double-render issue can create false DOM symptoms, so apparently critical reader reports should be reproduced and attributed before severity is locked. This rule explains the corrected handling of #54, #55, #56, and #57 after the initial #54–#78 system-review batch.

### DECIDED — Close #45 as a scaling spike with a phased implementation plan
_Source: Rusty spike; retained during Scribe merge on 2026-06-20T11:38:34+00:00._

Issue #45 is closed as a spike rather than a direct implementation ticket. Rusty posted a five-phase scaling plan to the issue; future scaling work should follow that phased plan instead of mixing large architectural changes into unrelated feature or bug-fix waves.


### DECIDED — Post-Fix Review 2 Issue Triage (#79–#99)
_Consolidated by Rusty · recorded 2026-06-20_

Rusty consolidated the second post-fix global review into 21 GitHub issues (#79–#99) after inputs from Basher, Saul, Livingston, and coordinator verification. Every critical/high-confidence regression or risk received either a focused issue or a scoped umbrella issue: search DoS/rate limits, FTS5 pagination, build reliability spike, unstyled legacy button regressions, dark-mode token gaps, reader a11y, backend/API hardening, and selected UX polish.

Three Saul feature proposals were accepted as backlog feature issues: keyboard shortcut reference panel (#95), 52-week reading streak heatmap (#96), and CEFR level progression timeline (#97). Roughly 30 minor or low-sponsor findings were intentionally dropped to avoid issue-board noise and scope creep. Coordinator follow-up confirmed the reported build failure was a concurrent-dev-server/`.next` artifact rather than a clean-build product failure, and confirmed #85's legacy `.btn` use is now visibly unstyled because #66 removed the CSS.

References: decisions/inbox/rusty-review2.md; GitHub issues #79–#99.


---

## 2026-06-21 — Review 3: End-User / Product-Gap Issue Consolidation

**Source:** `decisions/inbox/rusty-review3.md`  
**Status:** DECIDED  
**Owner:** Rusty (Lead/Architect)

A third review round combined internet competitor research, Saul's static product/UX gap analysis, and Basher's end-user usability walkthrough. The board was empty before this run, and the team filed **22 GitHub issues (#105–#126)** focused on learner needs and ease of use.

### Issue set

- **Bugs:** #105 AI Tutor disabled on the tutor path; #106 UTC streak boundary for non-UTC users.
- **Features:** #107 save word from dictionary popover; #108 CEFR filter on Browse; #109 0.5× speed and sentence loop; #110 post-article momentum; #113 bilingual parallel reading; #114 grammar/idiom explanations; #115 vocabulary journal/management; #116 learner content import; #117 offline/PWA reading; #118 content freshness/scheduling; #119 flashcards with original sentence context; #120 placement-level calibration; #123 word frequency signal; #124 article difficulty feedback; #125 streak recovery.
- **Chore/UX:** #111 reader tool discoverability; #112 dyslexia-friendly font/spacing controls; #121 first-run guidance; #122 reader polish bundle; #126 richer article card metadata/CTA.

### Coordinator caveats retained

- Basher F-31 placeholder article bodies were treated as seed/dev-data artifacts, not a production content bug. The real product gaps are #116 and #118.
- Basher F-11 AI Tutor was reframed as a real p1 bug (#105): tutor `chatComplete` returns null while translation works on the same endpoint; suspected token-budget issue in `src/lib/tutor.ts`.

### Rationale

The 22-issue count stayed within the target 18–28 range, grouped sub-threshold polish items into themed work, and preserved research-backed gaps from competitor products including LingQ, Readlang, Beelinguapp, News in Levels, Language Reactor, and Migaku. Many feature issues are intentionally marked `go:needs-research` because they touch product scope or architecture.


### DECIDED — CI Billing Blocked; Coordinator Local Verification Used for PR #127–#133
_Recorded by Scribe · 2026-06-21_

GitHub Actions jobs could not start during the #105–#126 delivery wave because the account was billing-blocked (`account payments failed / spending limit`). The coordinator therefore treated CI as unavailable and gated each merge locally with the repository verification sequence: typecheck, lint, test, and clean production build. All seven squashed PRs (#127–#133) were self-verified locally before merge, and final `main` was confirmed green with 561 passing tests and a clean build.

---

## 2026-06-21 — UI Redesign Design Decisions

### DECIDED — Global UI redesign: sidebar (desktop) + bottom tab bar (mobile) + unified reader tools

**Source:** Saul (Design/UX lead) · 2026-06-21
**Status:** DECIDED (proposal for decomposition; no feature code yet)
**Deliverable:** `redesign-proposal.md` (session artifact) — full audit, vision, and 9 shippable issues.

A holistic rethink of the ReadWise UI system (requested by Ralph / repo owner) to unify reading and practice across desktop, tablet, and mobile, prioritizing simplicity, usability, and responsive behavior. Three core design decisions:

**Decision 1 — Desktop/tablet primary nav = persistent collapsible LEFT SIDEBAR (not a top bar)**
With 8–9 destinations, a horizontal top bar cannot fit labelled links beside the wordmark/search/theme/user cluster at 1280px — that is the documented root cause of #134. A vertical sidebar (icon + label, grouped Primary/Secondary, collapsible to a 64px icon rail; collapsed-by-default on md, expanded on lg, state persisted in localStorage) restores discoverability and resolves #134 properly. The header is demoted to chrome only (wordmark · sidebar toggle · search · theme · user).

**Decision 2 — Mobile primary nav = BOTTOM TAB BAR (4 primary + "More" sheet), retiring the hamburger**
Replace the hamburger-only `MobileDrawer` with a bottom tab bar (Home · Browse · Study · Progress · More), safe-area aware, one-tap section switching. "More" opens a bottom Sheet with secondary/utility items. The drawer's focus-trap logic is extracted into a reusable `Sheet` primitive.

**Decision 3 — Reader = "Aa" Display popover + slim sticky toolbar + responsive Tools surface**
The overstuffed `ReaderControls` pill collapses into a slim sticky bar (Back · Listen · Aa · Tools); all display settings move behind an Aa popover/sheet built on a shared `SegmentedControl`. The six practice tools become one responsive Tools surface — a collapsible right rail at ≥1280px, a bottom sheet below.

**Supporting decision — extract primitives, no heavy dependency**
Build on the existing stack (Tailwind v4 tokens, lucide-react, `components/ui/*`) by extracting three primitives we already hand-roll 3× each — `Sheet`/`Popover`/`SegmentedControl` — plus `PageShell`/`PageHeader` for consistent practice-page chrome.

**Decomposition (9 issues):** 1. Sheet+Popover primitives (M). 2. SegmentedControl+PageShell/PageHeader (M). 3. Nav model in nav-items.ts (S). 4. Desktop/tablet collapsible left sidebar AppSidebar (L, resolves #134). 5. Slim header to chrome (S/M). 6. Mobile bottom tab bar + More sheet (M). 7. Reader Aa Display popover + slim toolbar (M). 8. Reader unified responsive Tools surface (L). 9. Adopt PageShell/PageHeader across practice pages (M).

**References:** `AppNav.tsx`/`nav-items.ts`, `MobileDrawer.tsx`, `ReaderControls.tsx`, `ArticleStudySection.tsx`, inconsistent page shells.

### 2026-06-21T23-23-31: Global UI redesign delivered — issues #146–#154 shipped as merged PRs #155–#163, browser-audited across breakpoints
**By:** Squad-Coordinator
**References:** #134, #146-#154, #155-#163

Global UI redesign for ReadWise delivered end-to-end. Saul produced a unified responsive IA proposal; Linus implemented 9 dependency-ordered issues (#146–#154) each as branch→PR→squash-merge to main (#155–#163) with typecheck+lint gates plus test/build at milestones. Three structural moves: (1) collapsible left sidebar on desktop/tablet resolving #134 + mobile bottom tab bar & More sheet; (2) header demoted to chrome only; (3) reader unified into a slim Back/Listen/Aa/Tools toolbar with Aa Display popover/sheet and responsive Tools surface. New primitives: Sheet, Popover, SegmentedControl, PageShell, PageHeader. Browser audit (dev-browser/Playwright headless, 1366/1440/820/390) found zero horizontal overflow; no follow-up gap PRs needed.

---

## 2026-06-22 — Wave Reviews, System Review, and Epic Wave Planning

### 2026-06-22T01-42-37: Full-team browser review delivered — 6 reviewers, 11 issues (#164–#173, #186), all shipped as merged PRs (#174–#185, #187)
**By:** Squad-Coordinator
**References:** #164-#173, #186, #174-#185, #187

Second redesign wave. All six team members performed a complete browser review of the live app (dev-browser/Playwright, realistic seeded data, light+dark, 390/820/1024/1280/1440). Findings consolidated into 11 GitHub issues; delivered as merged PRs to main.

Headline fixes: Admin area brought into unified shell + responsive admin tables (#164/#175); graceful article images — ArticleHero onError fallback + listing thumbnails + next/image (#165/#174); a11y Sheet focus-trap leak with roving-tabindex, Tools-sheet aria-modal, ≥44px reader touch targets, Shortcuts-modal name, stacked-Esc (#166/#176); undefined .btn-primary → Button primitive (#167/#179); ArticleCard meta truncation + category-slug humanization + CEFR estimate tooltip (#168/#180) + Read-chip overlap (#186/#187); reader layout coherence — shared measure, focused-mode sidebar auto-collapse, mini-player sidebar overlap, rail cramping (#169/#181); sign-in Terms/Privacy + AI-generated attribution (#170/#182); inclusive onboarding — placement-quiz icon (WCAG 1.4.1), gender Other, data-use notice (#171/#183); bilingual fallback banner + self-hosted OpenDyslexic under CSP (#172/#184); /lists duplicate heading + load-more reliability + empty-state polish (#173/#185). Also fixed a test regression (#177) and stopped tracking .copilot/session-state (#178).

Verification: typecheck clean, 561/561 tests pass, production build succeeds.

### 2026-06-22T03-26-44: Wave-3 deep review delivered — 6 reviewers, 9 issues (#188–#196), all shipped as merged PRs (#197–#205); fixed 2 HIGH bugs (cloze answer leak, SW import privacy leak)
**By:** Squad-Coordinator
**References:** #188-#196, #197-#205

Third redesign wave (deep review). All six team members browser-reviewed the LIVE app (dev-browser/Playwright, seeded data, light+dark) focused on LESS-TRAVELED surfaces: command palette, search, import, tags, offline/PWA, error pages, settings/danger-zone, reader tool deep interactions, flashcard/cloze flows, loading states.

Two HIGH bugs fixed: (1) Cloze review LEAKED the answer — pronounce button showed+spoke the masked word before submission (#188/#197); (2) service worker omitted /import from AUTH_PATHS — private import list could be shared-cached and leaked to another user offline (#189/#198). Other fixes: import form inputs invisible (undefined .admin-input) + teal-token tabs → Input/Textarea/SegmentedControl (#190/#199); error/not-found family unified on EmptyState + authed-404 keeps shell (#191/#200); NEW /tags hub (listTagsWithCounts was dead code) + /tags/[slug] on PageShell + Topics nav entry (#192/#201); command-palette ghost ARTICLES header on zero results (#193/#202); reader dictionary popover overflow/focus/aria + 44px targets (#194/#203); RAI trust & clarity — typed-DELETE deletion, AiBadge, Privacy §4 (#195/#204); loading polish — reader skeleton, ArticleHero shimmer, SkeletonCard image slot (#196/#205).

Verified: typecheck clean, 565/565 tests pass, production build succeeds.

### 2026-06-22T08-24-58: Wave-4 review delivered — 6 reviewers, 5 issues (#210–#214), all shipped as merged PRs #215–#219; fixed multiple HIGH overlay/backend bugs
**By:** Squad-Coordinator
**References:** #210-#214, #215-#219

Fourth review wave. All six team members + Coordinator browser-reviewed the live app (dev-browser/Playwright, seeded data, light+dark), focused on deeper surfaces and the new full-page practice overlay.

HIGH bugs fixed: (1) Overlay focus-trap leaked because getTabbable counted focusables in hidden keep-alive panels — fixed with shared visibility-aware helper. (2) Browser/hardware Back exited the reader instead of closing the overlay — now pushes history + popstate closes. (3) Mic/audio kept running when tab was hidden or overlay closed. (4) Vocabulary auto-fired an AI request on every reader load — now empty. (5) Search returned zero for author/source/category terms (FTS early-exit before LIKE). (6) Feed pulled up to 1000 full article rows (~2.6s) — now content-free select + cap + per-user cache + DB-level filter.

Plus IA (Topics→Tags rename, Saved→Saved articles, reader Back origin from Notes/palette, dashboard Review-N-due CTA, Study reorder), AI transparency badges, and visual polish (deterministic card placeholder thumbnails, accessible progress charts, 44px swatches).

Verified: typecheck clean, 569/569 tests pass, build succeeds.

### 2026-06-22T11-42-09: System review (2 passes) delivered — 13 issues (#220–#226, #234–#239), shipped as merged PRs (#227–#233, #240–#245); fixed SSRF DNS-rebinding, private-import data exposure, client-trusted scores, timezone corruption, races; tests 569→666
**By:** Squad-Coordinator
**References:** #220-#226, #234-#239, #227-#233, #240-#245

Two-pass engineering system review (extensibility, robustness, observability + security/authz/data-integrity/correctness) — NO new features, only gaps/bugs. Team: Rusty (extensibility), Livingston (robustness/backend/authz/data-integrity), Linus (client/CLI + correctness/type-safety), Basher (observability + tests), Rai (logging privacy) + security-review agent + Coordinator. Test suite grew 569→666.

Pass 1: typed config module (#222), AI/speech/dictionary observability + feature labels + speech parse-guard/timeout (#220), backend robustness — saveProgress upsert race, SSRF redirect-hop validation, grammar rate-limit gap, worker poison quarantine (#221), shared cache-first AI abstraction (#223), client robustness — shared client-fetch + reader error boundaries + abort/race fixes (#224), logging privacy — URL/PII redaction + closed RequestContext type + global-error throttle (#225), critical-path tests (#226).

Pass 2 (deeper security/correctness): HIGH SSRF DNS-rebinding closed by IP pinning via undici dispatcher (#234); data-exposure — user-delete publishing private imports + bookmarks/lists bypassing article visibility (#235); import dedup unique constraint + migration (#236); server-side quiz grading + pronunciation clamp/rate-limit (#237); timezone bugs corrupting activity count/streak (#238); transactional last-admin guards + activity write + ai-cache type constraint (#239).

Security review verified NO IDOR/SQLi/stored-XSS/auth-bypass/open-redirect. Verified: typecheck clean, 666/666 tests pass, production build succeeds.

### 2026-06-22T23-40-45: Open epic delivery waves and immediate Wave 1 split
**By:** Rusty
**References:** #246-#258, #266-#267, #289, #293, #313, #316, #322, #324

Deliver the open ReadWise epics in dependency-led waves. Wave 1 is a low-risk safety/instrumentation foundation before the large PostgreSQL/job/rate-limit migrations: #324 ADR scaffold, #322 config validation, #293 health/readiness semantics, #289 initial core metrics, #266 centralized article access service, #267 IDOR regression tests, #316 security regression coverage, and a thin #313 Playwright critical-flow smoke slice.

Deferred to Wave 2 (after guardrails are green): #259 PostgreSQL, #260 explicit visibility/status/source type, #261 private lifecycle schema hardening, #270 audit logs, #271 persistent job table, #277 AI ledger, #284 shared rate limiting.

Rationale: The open P0 epics are tightly coupled. Starting with observable safety rails and access/test contracts reduces regression risk before high-churn schema, queue, and distributed-infrastructure work. Keeps each PR reviewable, gives Basher/Rai security gates before auth/data mutations expand, gives Livingston/Linus stable contracts for later waves.

---

## 2026-06-23 — Wave 2 Planning, Gate Checklist, Multi-tenancy, ReadingX

### 2026-06-23T00-39-08: Wave 2 merge-safe lane plan for issues #259 #260 #261 #262 #263 #264 #265 #268 #270 #314 #323
**By:** Rusty
**References:** #259, #260, #261, #262, #263, #264, #265, #268, #270, #314, #323

Recommended Wave 2 plan with merge-safe lanes:

1. **DB foundation lane** — #323, #259, #314. Owner: Livingston. Reviewers: Rusty (architecture), Basher (validation).
2. **Article access model lane** — #260, #261, #268. Owner: Livingston. Reviewer: Rusty; Basher for auth/privacy tests; Rai privacy/security review. Merge order: #260 → #261 → #268.
3. **Audit/security lane** — #270. Owner: Livingston with Linus for admin audit UI/export.
4. **Search/performance lane** — #265, #263. Owner: Livingston. Merge order: #265 → #263.
5. **Native JSON cleanup lane** — #262. Owner: Livingston. Depends on PostgreSQL foundation.
6. **Ops runbook lane** — #264. Owner: Rusty, with Livingston/Basher. Final, after #259/#323.

Dependencies: First merge #323/#259/#314; then article access lane in strict order; after #260 merged, #270 can merge; after foundation+visibility stable, merge #265 then #263; #262 after #314; #264 last.

Split/spike recommendations: #259 too large — split into migration spike/RFC first; #260 also large/risky — split design/migration plan first; #265 should begin as strategy spike; #263 should not start until #260/#265 queries are known.

### 2026-06-23T03-58-22: Gate checklist for final PostgreSQL provider flip (#259)
**By:** Rusty
**References:** #259, #314, #263, #323

Prerequisites after #314/#263/#323: PostgreSQL integration CI is required and green; schema parity test still passes with only provider diff; PostgreSQL migrations apply from empty DB and include privacy, audit, JSONB, sourceUrl+owner uniqueness, FTS/search indexes; local compose Postgres+Redis flow documented and works.

Validation: npm ci; npm run typecheck; npm run lint; npm test; docker compose up -d postgres redis; export DATABASE_URL=postgresql://...; npx prisma generate; npx prisma migrate deploy; npm run test:db; npm run build; container starts and /api/ready is green; smoke admin/login/list/search/reader/settings/study/import/worker.

Rollback: pre-flip SQLite backup and Postgres dump; pause workers during cutover; code-only failure redeploy previous image; data/corruption restore dump and repoint DATABASE_URL.

Reviewers: Livingston owns schema/migrations/runtime; Basher owns CI/test/db dry run; Linus quick smoke; Saul optional UX smoke; Rai reviews secret/PII handling; Rusty final architectural approval.

Red flags: PR relies on PRISMA_SCHEMA_PATH to hide wrong default; postinstall generates SQLite client; Docker generate schema differs from entrypoint migrate schema; CI still defaults to SQLite only; SQLite FTS or file: URLs remain in production docs.

Recommendation: one focused #259 PR if #314/#263/#323 are merged and green. Split only if the SQLite data migration tooling/runbook is not already done.

### 2026-06-23T04-39: Multi-tenancy / classroom foundation (Epic RW-E012, #257)
**By:** Livingston
**References:** #257, #318, #319, #320, #321, PR #356

Shipped ONE CI-green PR #356 closing #318 (RW-060), #319 (RW-061), #320 (RW-062), #321 (RW-063) on branch `squad/318-multi-tenancy`.

Design decisions: Tenancy is additive & nullable (`organizationId == null` = global/public; any user with no Membership keeps exact pre-tenancy single-user experience). `Article.organizationId` is a soft non-FK TEXT scalar (mirrors AnalyticsEvent/AuditLog convention), so SQLite migration is a clean `ALTER TABLE ADD COLUMN` with FTS5 triggers untouched. PG keeps it as plain indexed TEXT. Tenant roles live in `Membership` rows and resolve through the same `rbac.ts` capability table as global roles. Cache public listing keys UNCHANGED; `tenantCacheKeyParts` appends `org:<id>`/`user:<id>` only for org/user scopes to prevent cross-org leaks.

Models added (BOTH schemas + BOTH migration dirs): Organization, Membership, Classroom, ClassroomMembership, Assignment, AssignmentCompletion; enums MembershipRole/ClassroomRole/AssignmentStatus; soft `Article.organizationId` + index.

Local gate (all PASS): npm ci · prisma generate · typecheck · lint · npm test (1215 pass / 0 fail / 16 skip; +42 new tenancy tests) · prisma migrate deploy (ci.db) · npm run build · prisma validate (SQLite + PostgreSQL).

CI (all green): Unit tests, Fast checks (typecheck+lint), PostgreSQL Migrate/Integration, Build, CI summary.

### 2026-06-23T13-49-37: ReadingX incremental-integration backlog completed via PR-based squad integration
**By:** Scribe
**References:** #359-#378, #380-#384, e4e1cbb, 2d4e998, b4bf07a, c51dca0, e622b3b

Ralph coordinated the full ReadingX incremental-integration backlog using background specialist agents and PR-based merges into `main`. Livingston completed backend epics #359, #366, and #370 through PRs #381-#383, including #360/#380 URL extractor contract work; Linus completed frontend epic #375 through PR #384; Ralph landed the `instrumentation.ts` Edge-bundle tracing guard as housekeeping commit `e622b3b`. All 21 tracked issues are closed.

Each PR passed Fast checks, Unit tests, Build, and PostgreSQL Migrate before squash-merge. Final `main` verification: `npm run typecheck` passed, `npm test` reported 1436 pass / 0 fail / 16 skip.

Decision: treat this backlog as complete and use the PR-based wave pattern as the reference integration approach for similar multi-epic ReadingX work.

---

## 2026-06-25 — Codebase Quality Audit & Epic #610

### 2026-06-25T23-23-23: Created refactoring/quality epic #610 + 15 child issues (#611–#625) from a five-domain codebase audit
**By:** Squad-Coordinator
**References:** #610, #611-#625

Requested by Yingting Huang: run a repeated (10x) domain-by-domain quality audit, consolidate, and document as a GitHub epic + issues. Themes: modularization, reusability, subsystem separation, extensibility, readability, merging duplicate code, removing outdated/compat code, splitting large files, eliminating redundant compat layers.

Each domain expert (Rusty/architecture, Saul/design, Linus/frontend, Livingston/backend, Basher/testing) performed an exhaustive 10-pass sweep of their own domain. This produced 79 grounded findings (ARCH 15, DSGN 14, FE 16, BE 18, TEST 16). Rusty (Lead, opus-4.8) consolidated all 79 findings into 15 right-sized, PR-scoped child issues across 3 phases, deduping cross-domain corroborations.

**Phase 1 Foundations:** #611 p0 dark-mode/WCAG (Saul), #612 AI consolidation (Livingston), #613 lib dependency inversion (Rusty), #614 test shared-helper adoption (Basher).

**Phase 2 Core refactors:** #615 (Saul), #616–#617 (Linus), #618 (Basher), #619–#621 (Livingston).

**Phase 3 Cleanup/splits:** #622 (Livingston), #623 (Saul), #624 (Linus), #625 (Basher).

Owners assigned via squad:* labels: Rusty (#613), Saul (#611, #615, #623), Linus (#616, #617, #624), Livingston (#612, #619, #620, #621, #622), Basher (#614, #618, #625).

Non-goals enforced per AGENTS.md: no behavior changes, no new compat layers for superseded shapes, preserve AI/Speech/Push/OAuth/storage graceful fallbacks, keep SQLite/PG parity, no secret/PII logging. Analysis only — no source code modified this session.

Session artifacts: files/findings-{architecture,design,frontend,backend,testing}.md, files/consolidated-plan.md.

---

## 2026-06-26 — Round-2 Codebase Quality Audit & Epic #626

### 2026-06-26T01-04-57: Round-2 audit: created epic #626 + 13 child issues (#627-#639), follow-up to #610; 67 new findings, p0 sensitive-key redaction privacy leak
**By:** Squad-Coordinator
**References:** #626, #610, #627, #628, #629, #630, #631, #632, #633, #634, #635, #636, #637, #638, #639

Second-wave (round 2) codebase quality audit, follow-up to epic #610. Each domain expert (Rusty/architecture, Saul/design, Linus/frontend, Livingston/backend, Basher/testing) ran a fresh 10-pass sweep instructed to find NEW, non-overlapping issues (each read their round-1 findings + issues #611-#625 to avoid duplicates), targeting subsystems/angles round 1 under-covered. Result: 67 new findings (ARCH2 11, DSGN2 14, FE2 12, BE2 15, TEST2 15), all confirmed zero-overlap with #610.

Standout cross-domain corroboration: Rusty (ARCH2-2) and Livingston (BE2-1) independently flagged divergent sensitive-key redaction across audit.ts/errors.ts/analytics sanitize.ts with gaps in both directions (audit misses prompt/content/text; errors misses email/url) — a real privacy leak and AGENTS.md violation. Made the single highest-priority issue (p0). Also corroborated: runtime-config env scattering (ARCH2-3 + BE2-2/3).

Rusty (Lead, opus-4.8) consolidated 67 findings into 13 right-sized child issues across 3 phases, each finding covered exactly once, every HIGH covered. Two p0s: #627 redaction primitive, #628 flashcard effect-deps correctness bug.

Deliverables on huangyingting/ReadWise (main), cross-linked to #610:
- Epic #626 (type:epic, security/privacy/architecture/quality labels).
- Phase 1: #627 (p0, Rusty), #628 (p0, Linus), #629 (Livingston), #630 (Saul), #631 (Saul), #632 (Rusty).
- Phase 2: #633 (Linus), #634 (Livingston), #635 (Livingston), #636 (Basher), #637 (Basher).
- Phase 3: #638 (Livingston, deps #627), #639 (Basher).
- Owners via squad:* labels (Rusty 2, Saul 2, Linus 2, Livingston 4, Basher 3).

Non-goals enforced per AGENTS.md: no behavior changes, no new compat layers, preserve provider graceful fallbacks, SQLite/PG parity, no secret/PII logging. Analysis only — no source modified. Artifacts: files/findings-{architecture,design,frontend,backend,testing}-r2.md, files/consolidated-plan-r2.md.


### DECIDED — Scraper provider cleanup hardening finalization
_Recorded by Scribe · 2026-06-28_
**What:** Generic scraper cleanup is now guarded so unknown providers do not receive provider-specific generic cleanup, while known provider cleanup remains hardened for newsletters, get-latest widgets, CTA/social chrome, duplicate candidates, and provider-specific prose regressions.
**Why:** The team found and fixed over-removal risks during review. Final independent code review reported no correctness issues, security review found no vulnerabilities, and full scraper verification passed.
**Merged inbox:** `decisions/inbox/Livingston-apply-generic-scraper-chrome-cleanup-to-every-prov.md`, `decisions/inbox/basher-scraper-cleanup-verification.md`.
**Validation:** focused cleaned-HTML/cleanup tests passed; full scraper suite passed 336/336; typecheck passed; eslint on changed files passed; `git diff --check` passed.
