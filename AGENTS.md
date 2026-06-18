# ReadWise — Agent Notes

AI-assisted English learning reader. Full feature replication of "ReadingX".

## Stack
- Next.js 15 (App Router, TypeScript), React 19
- Prisma ORM + SQLite (`DATABASE_URL=file:./dev.db`)
- NextAuth v4 with `@auth/prisma-adapter` (database session strategy)
- Azure OpenAI / Azure Speech for AI tools (see `.env.local`)

## Commands
- `npm run dev` — dev server (port 3000). Load env first: `set -a && . ./.env.local && set +a`
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — `next lint`
- `npm run build` — production build (also runs type/lint checks)
- `npx prisma migrate dev --name <n>` — create + apply a migration (run with env loaded)

## Conventions & Gotchas
- Path alias `@/*` → `./src/*`.
- DB access: import the singleton `prisma` from `@/lib/prisma` (never `new PrismaClient()`).
- Auth config lives in `src/lib/auth.ts` (`authOptions`). Providers are added
  conditionally based on env vars so missing OAuth creds don't crash (graceful fallback).
- Session strategy is **database** (not JWT). Role + id are attached in the
  `session` callback from the `user` arg. `Session.user` type is augmented in
  `src/types/next-auth.d.ts` to include `id` and `role`.
- Protected routes: listed in `middleware.ts` (`PROTECTED_PREFIXES` + `config.matcher`).
  Middleware only checks session-cookie presence and redirects to
  `/signin?callbackUrl=<path>`. Real enforcement is server-side via
  `requireSession(callbackUrl)` from `@/lib/session`. When adding a new protected
  area, update BOTH the middleware matcher and call `requireSession` in the page.
- Server components in Next 15: `searchParams`/`params` are Promises — `await` them.
- `User.role` defaults to `Reader` (enum `Role { Admin, Reader }`). The first user to
  sign in becomes `Admin` via the `events.createUser` hook in `src/lib/auth.ts`
  (counts users after creation; if it's the only one, promotes to Admin).
- Admin enforcement: pages call `requireAdmin(callbackUrl)` from `@/lib/session`
  (redirects non-admins to `/forbidden`); API routes call `requireAdminApi()` from
  `@/lib/api-auth` (returns 401 if unauthed, 403 if non-admin). Hide admin-only UI
  by checking `session.user.role === "Admin"`.
- Migrations are committed under `prisma/migrations/`. `dev.db` is gitignored.
- Shared news categories live in `src/lib/categories.ts` (`CATEGORIES`, `CATEGORY_SLUGS`,
  `isValidCategorySlug`). Reuse this set everywhere (onboarding topics, category browsing,
  picks) instead of redefining the list.
- User onboarding: 1-1 `Profile` model (ageRange?, gender?, englishLevel, topics JSON string,
  completedAt). SQLite has no scalar lists, so `topics` is a JSON-stringified `string[]`
  (parse via `parseTopics` in `src/lib/profile.ts`). `completedAt != null` means onboarded.
  Gate pages that need a finished profile with `requireOnboardedSession(callbackUrl)` from
  `@/lib/session` (redirects to `/onboarding`). The onboarding page itself uses plain
  `requireSession` and redirects completed users to `/dashboard`.
- Profile validation is centralized in `parseProfileInput(body)` in `src/lib/profile.ts`
  (returns `{ok:true, value}` or `{ok:false, error}`); it validates level, age, gender and
  filters topics to valid category slugs. Reuse it for any profile read/write API.
  `POST /api/onboarding` sets `completedAt`; `PUT /api/profile` (edit-settings) upserts the
  same fields but preserves `completedAt`. Settings UI lives at `/settings`
  (`requireOnboardedSession`) with the client `ProfileSettingsForm`.
- Auth UI actions (`signIn`/`signOut` from `next-auth/react`) must run in a `"use client"`
  component. Reusable client auth controls live in `src/components/` (e.g. `SignOutButton.tsx`).
  With the DB session strategy, `signOut` deletes the `Session` row server-side (not just the
  cookie). Session lifetime is set via `session.maxAge`/`updateAge` in `authOptions`.
- Article reader lives at `/reader/[id]` (already in `middleware.ts` PROTECTED_PREFIXES +
  matcher). Page gates with `requireSession(`/reader/${id}`)` and calls `notFound()` (renders
  `src/app/reader/[id]/not-found.tsx`) for missing ids. Article data helpers are in
  `src/lib/articles.ts` (`getArticleById`, `readingMinutesFor` — prefers stored
  `readingMinutes`, else `wordCount`/body @200wpm).
- ALWAYS render stored article HTML through `sanitizeArticleHtml` from `src/lib/sanitize.ts`
  before `dangerouslySetInnerHTML`. It is two-pass (sanitize-html): pass 1 drops ad/boilerplate
  blocks WITH their content via `exclusiveFilter` on class/id keywords + `nonTextTags` for
  script/style/iframe; pass 2 enforces a strict tag/attr allowlist and forces
  `rel=noopener noreferrer nofollow target=_blank` on links. Never inject raw `content`.
- Reading progress: 1-many `ReadingProgress` model (userId+articleId `@@unique`, percent Int,
  completed Bool, completedAt). Helpers in `src/lib/progress.ts`: `getProgress`,
  `getProgressMap(userId, ids)` (batch for listings), `saveProgress(userId, articleId, percent)`
  which is FORWARD-ONLY (never lowers percent, completion is sticky) and marks `completed` when
  percent >= `COMPLETION_THRESHOLD` (95). `POST /api/reader/[id]/progress` body `{percent}`
  persists it (401 unauth / 404 bad article). The client `src/components/ReaderProgress.tsx`
  tracks scroll, throttles writes to <=1/sec, forward-only, flushes final on unmount; the page
  does NOT auto-scroll (starts at top). Article listings use `src/components/ArticleCard.tsx`
  (server component) which renders the saved progress bar; build listings with
  `listPublishedArticles()` + `getProgressMap`.
- Listing client refresh (US-008): after a reader opens an article, `ReaderProgress` records its
  id via `markArticleVisited` (`src/lib/visited.ts`, sessionStorage key `readwise:visited-articles`).
  Drop `<ListingProgressSync articleIds={ids} />` into any listing: on mount it batch-fetches
  progress for ONLY the visited ids present on the page via `POST /api/progress/batch`
  (`{ids:string[]}` -> `{progress:{[id]:{percent,completed}}}`, backed by `getProgressSummaries`)
  in a single request, merges into the cards' DOM (hooks `js-progress-bar`/`js-progress-label`/
  `js-progress-done` + `data-article-id` on `ArticleCard`), then clears those ids. SSR via
  `getProgressMap` is still the source of truth on first paint; this only refreshes visited cards.
- AI provider (US-009+): `src/lib/ai.ts` wraps Azure OpenAI chat-completions over plain `fetch`
  (no SDK dep). `isAiConfigured()` checks the 4 `AZURE_OPENAI_*` env vars; `chatComplete(messages,
  opts)` returns the assistant text or `null` (graceful fallback) on missing creds / non-2xx / throw.
  Note: the gpt-5-mini deployment requires `max_completion_tokens` (NOT `max_tokens`) and rejects a
  custom `temperature`. Any AI feature should degrade gracefully when `chatComplete` returns null.
- Translation (US-009): cached per article+language in the `Translation` model
  (`@@unique([articleId, targetLang])`, cascade-deletes with the article). `src/lib/translation.ts`
  owns `SUPPORTED_LANGUAGES`/`isSupportedLanguage`/`languageLabel`, `htmlToPlainText` (strip tags ->
  paragraph-separated plain text for model input), and `getOrCreateTranslation(articleId, lang)`
  which returns cache hits first, else generates via `chatComplete` and upserts; when AI is
  unconfigured OR the request fails it returns a placeholder with `fallback:true` and does NOT cache.
  API: `POST /api/reader/[id]/translate` body `{lang}` (400 bad lang, 404 missing article, 401 unauth).
  Client `src/components/ArticleTranslation.tsx` renders the language select + result under the
  article; translated text is split on blank lines and rendered as React text nodes (no
  `dangerouslySetInnerHTML` needed since it's plain text, not HTML).
- Vocabulary (US-010): two models. `VocabularyItem` is the per-article AI-extracted cache
  (`@@unique([articleId, word])`, cascade with article). `SavedWord` is the per-user study list
  (`@@unique([userId, word])` => dedup; cascade with user; word/explanation/example/articleId).
  `src/lib/vocabulary.ts` owns `getOrCreateArticleVocabulary(articleId, userId)` (cache hit ->
  generate via `chatComplete` asking for a JSON array of {word,explanation,example}, parsed by the
  fence-tolerant `parseVocabularyJson`, upserted; on AI-unconfigured OR empty parse returns
  `fallback:true` and caches nothing), plus `saveWord`/`unsaveWord`/`getSavedWords`/`getSavedWordSet`
  (saved-status matched case-insensitively). APIs: `POST /api/reader/[id]/vocabulary` (extract +
  per-user saved flags, 404 missing article), `POST /api/vocabulary/save` & `.../unsave` (body
  `{word,...}`, 400 missing word). Client `ArticleVocabulary.tsx` is a lazy panel (loads on first
  open, optimistic save toggle); the study list page `/study` (gated, in middleware) renders saved
  words with `StudyList.tsx` (remove = unsave). Reuse `htmlToPlainText` from translation for model
  input. Dashboard links to `/study`.
- Word lookup / dictionary (US-011): `src/lib/dictionary.ts` does NOT use AI — it queries the free
  `api.dictionaryapi.dev` over `fetch` and degrades gracefully (returns `{found:false}`, never throws,
  on 404/timeout/unreachable). `normalizeCandidates(raw)` returns an ordered list of base forms
  (contractions via a map, possessive strip, plural/gerund/past/comparative/-ly rules); `lookupWord`
  tries each candidate until one resolves, so inflections normalize to a base form automatically.
  Result groups definitions by `partOfSpeech` and includes `phonetic`/`audio` when available. API:
  `POST /api/dictionary` body `{word}` (400 missing word, 401 unauth). Client `WordLookup.tsx` wraps
  the reader prose (replaces the raw `dangerouslySetInnerHTML` prose div) and shows a fixed-position
  popover on `mouseup`: uses the text selection if present, else resolves the word under the cursor via
  `caretRangeFromPoint`/`caretPositionFromPoint`; closes on outside-click/Escape.
- Comprehension quiz (US-012): per-article AI-cache `QuizQuestion` model (`@@unique([articleId,
  question])`, `options` is a JSON-stringified `string[]`, `correctIndex` Int, cascade with article).
  `src/lib/quiz.ts` owns `getOrCreateArticleQuiz(articleId)` (cache hit -> generate via `chatComplete`
  asking for a JSON array of {question,options[],correctIndex}, parsed by fence-tolerant
  `parseQuizJson` which validates >=2 options and an in-range correctIndex; upserted by
  `articleId_question`; on AI-unconfigured OR empty parse returns `fallback:true` and caches nothing).
  Quiz has NO per-user state, so the helper takes only `articleId`. API: `POST /api/reader/[id]/quiz`
  (404 missing article, 401 unauth). Client `ArticleQuiz.tsx` is a lazy panel (loads on first open):
  radio options per question, "Check answers" disabled until all answered, then shows per-question
  Correct/Incorrect feedback, highlights the right option, a total score, and "Try again" reset.
  `correctIndex` is sent to the client so grading is done client-side.

## Browser verification
- Playwright is installed. Run scripts from the project root (so `@playwright/test`
  resolves). Chromium binary is at
  `~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome` ($HOME=/home/azadmin; the
  /home/agent/...chromium-1208 path is stale). Launch with `--no-sandbox`.
- Verify role/session-gated pages without real OAuth: insert a `User` + `Session`
  (sessionToken) row, add cookie `next-auth.session-token=<token>` to the browser context
  (or curl `-H "Cookie: ..."`).
