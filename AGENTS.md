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
- Text-to-speech / narration (US-013): per-article AI/Speech cache `ArticleSpeech` model
  (`articleId @unique`, cascade with article) stores `audioBase64` (mp3), `mimeType`, `spokenText`,
  and `words` (JSON-stringified `[{textOffset,length,start,end}]`, start/end in SECONDS). Unlike the
  OpenAI features, narration uses the Azure **Speech SDK** (`microsoft-cognitiveservices-speech-sdk`,
  added as a dep) server-side — `src/lib/speech.ts` `getOrCreateArticleSpeech(articleId)` synthesizes
  via `SpeechSynthesizer(cfg, null)` (null audioConfig => audio returned in `result.audioData`, no
  speaker) and collects `synthesizer.wordBoundary` events (`boundaryType === Word`), converting
  audioOffset/duration TICKS (100ns) to seconds via `/1e7`. Config via `AZURE_SPEECH_KEY/REGION/VOICE/
  OUTPUT_FORMAT`; `isSpeechConfigured()` checks KEY+REGION. Caches audio+timings on success; on
  unconfigured/empty-text/synthesis-failure returns `fallback:true` and caches NOTHING. Reuses
  `htmlToPlainText` from translation for the spoken text (note: it does NOT strip ads like
  sanitizeArticleHtml — consistent with translation/vocab/quiz which also feed raw content). The
  route MUST set `export const runtime = "nodejs"` (SDK needs Node). API: `POST /api/reader/[id]/speech`
  (404 missing article, 401 unauth). Client `ArticleSpeech.tsx` is a lazy panel: native
  `<audio controls>` (gives play/pause + seek), `buildSegments(spokenText, words)` splits text into
  plain gaps + timed word spans by `textOffset/length`, `onTimeUpdate` binary-searches the last word
  with `start <= currentTime` to set the active highlight, and auto-scrolls the active word into view
  ONLY when its rect leaves the comfortable 20%–75% viewport band. Clicking a word seeks audio to it.
- Difficulty / level assessment (US-014): Article already has `difficulty` (CEFR string A1–C2) +
  `difficultyScore` (Float, 0–100 where higher=harder) columns — no migration needed. `src/lib/difficulty.ts`
  reuses `ENGLISH_LEVELS` from `@/lib/profile` for the CEFR scale (`levelRank` gives ordinal A1=0…C2=5;
  CEFR strings also sort correctly lexicographically). `assessDifficulty(title, content)` prefers AI
  (`chatComplete`, ask for a single CEFR token, parse via `parseLevel`'s `/\b([ABC][12])\b/` regex,
  `maxOutputTokens:16`) and falls back to a deterministic `heuristicDifficulty` (Flesch Reading Ease via
  `fleschReadingEase` → CEFR band). `getOrCreateArticleDifficulty(articleId)` returns the stored value or
  assesses (AI-capable, per-article) + persists; `ensureArticleDifficulties(articles[])` is the cheap
  HEURISTIC-only batch for listings (mutates objects in place + persists missing ones, no AI) — the reader
  page does the heavier AI assessment for a single article. Both cache (heuristic is a valid assessment,
  not a placeholder, so it IS cached — unlike vocab/quiz fallbacks). Reader page calls
  `getOrCreateArticleDifficulty` and shows "Level X"; `ArticleCard` shows it too. Recommendations:
  `filterAndSortByLevel(articles, maxLevel?)` in `src/lib/articles.ts` filters to articles at/below a CEFR
  level and sorts easiest-first (unassessed sort last, never dropped). Dashboard has a `?level=` GET filter
  (`<select>` "All levels" + A1–C2 "and below").
- Tag system (US-015): many-to-many via an explicit join table. `Tag` (name + slug both `@unique`)
  and `ArticleTag` (`@@id([articleId, tagId])`, indexes on both fks, cascade both ways) with
  `tags ArticleTag[]` on Article. `src/lib/tags.ts`: `slugifyTag` (NFKD strip accents/punct ->
  lowercased hyphen slug), `parseTagsJson` (fence-tolerant JSON-array-of-strings, dedup by slug),
  `getOrCreateArticleTags(articleId)` (AI auto-extraction like vocab/quiz: cache-first; on miss asks
  `chatComplete` for up to 5 Title-Case topic tags, upserts Tag by slug + links via ArticleTag;
  AI-unconfigured/empty => `fallback:true`, caches NOTHING). Read-only helpers: `getArticleTags`,
  `getTagBySlug`, `listArticlesByTag(slug)` (published only, newest first), `listTagsWithCounts`
  (counts published articles, drops empties). Reader page calls `getOrCreateArticleTags` and renders
  `.tag-chip` links to `/tags/[slug]`. Tag listing `/tags/[slug]` (gated; in middleware PROTECTED_PREFIXES
  + matcher) reuses `ArticleCard` + `getProgressMap` + `ensureArticleDifficulties` + `ListingProgressSync`;
  `notFound()` for unknown slugs. API `POST /api/reader/[id]/tags` (401 unauth, 404 missing article).
- Category browsing (US-017): Article has a `category String?` column (+ `@@index([category])`) holding a
  slug from `src/lib/categories.ts` (`CATEGORIES`/`isValidCategorySlug`). Browse homepage `/browse` (gated;
  in middleware PROTECTED_PREFIXES + matcher) renders a category tab bar (All + each category + personalized
  Picks); the active view is reflected in the URL (`?category=<slug>` or `?view=picks`). Listing helpers in
  `src/lib/articles.ts`: `listCategoryPage(category|null, {offset,limit})` and `listPicksPage(maxLevel,
  {offset,limit})` both return `{articles, hasMore}` (offset pagination, `take: limit+1` to compute hasMore);
  Picks reuses `filterAndSortByLevel` + `ensureArticleDifficulties` against the user's profile englishLevel.
  `toListingArticle(article)` produces the plain serializable `ListingArticle` (id/title/author/source/
  category/difficulty/readingMinutes) sent to the client. Incremental "Load more" hits `GET /api/articles`
  (`view`/`category`/`offset`/`limit` -> `{articles, progress, hasMore, offset}`, session-gated 401).
  IMPORTANT card refactor: `ArticleCard` (server) now just maps Article -> ListingArticle and delegates to
  the presentational `ArticleCardView` (reusable by client listings); keep the `js-progress-*` hooks +
  `data-article-id` in `ArticleCardView`. The client `CategoryBrowser` holds the feed state — the page MUST
  pass `key={activeView}` so it REMOUNTS on tab change (else useState retains the previous view's cards).
- Admin area (US-019): everything under `/admin` shares `src/app/admin/layout.tsx`, which gates the WHOLE
  area via `requireAdmin("/admin")` (redirects Readers to `/forbidden`, unauthed to `/signin`) and renders the
  shared `AdminNav` (client comp using `usePathname` for active-link highlight: Dashboard, Articles, Tags,
  Members, Analytics). Sub-pages still call `requireAdmin(...)` themselves (defense-in-depth + they need the
  session). Section pages live at `/admin/{articles,tags,members,analytics}` (placeholders until US-020–023).
  Admin metrics are centralized in `src/lib/admin.ts` `getAdminOverview()` (users/admins/articles/published/
  tags/readingProgress counts + `article.groupBy({by:["status"]})` for processing status); both the `/admin`
  dashboard and `GET /api/admin/stats` consume it. The `/admin` prefix is already in middleware (covers all
  sub-routes). Styling helpers in globals.css: `.admin-nav`/`.admin-nav-link`/`.admin-stat-grid`/`.admin-stat`.
- Admin article management (US-020): `src/lib/admin-articles.ts` owns `searchArticles({query,status,page})`
  (LIKE-`contains` on title/author/source — SQLite LIKE is case-insensitive for ASCII; offset paginated, default
  `ADMIN_ARTICLES_PAGE_SIZE=20`), `getAdminArticleDetail(id)` (article + counts of derived translations/vocab/quiz/
  tags/speech + readingProgress), `deleteArticle(id)` (relies on schema cascades — deleting an Article removes
  Translation/VocabularyItem/QuizQuestion/ArticleSpeech/ArticleTag/ReadingProgress; SavedWord.articleId is a plain
  string, NOT an FK, so saved words survive), and `rebuildArticleAi(id)` which "rebuilds" by CLEARING the cached AI
  rows (translations/vocab/quiz/tags/speech) in a `$transaction` so they regenerate LAZILY on the next reader visit
  via the `getOrCreate*` helpers (reader progress is preserved). This degrades gracefully when AI is unconfigured.
  APIs (all `requireAdminApi`): `GET /api/admin/articles` (q/status/page), `DELETE /api/admin/articles/[id]` (404
  if missing), `POST /api/admin/articles/[id]/rebuild` (404 if missing). Pages: list `/admin/articles` (server; GET
  search form via searchParams + status `<select>` built from `findMany({distinct:["status"]})` + paginated table),
  detail `/admin/articles/[id]` (content preview via `sanitizeArticleHtml`, derived-content counts, `notFound()` for
  bad ids). Destructive actions use the client `src/components/AdminArticleActions.tsx` — an INLINE confirmation
  panel (`.admin-confirm`, not `window.confirm` — easier to Playwright-test) then `fetch` + `router.refresh()` (or
  `router.push` on delete). Styling: `.admin-search`/`.admin-input`/`.admin-table`/`.btn-danger`/`.admin-confirm`/
  `.admin-pagination`/`.admin-article-preview` in globals.css.
- Admin member management (US-021): `src/lib/admin-members.ts` owns `listMembers({query,role,page})` (LIKE-`contains`
  on name/email + optional role filter; offset paginated, default `ADMIN_MEMBERS_PAGE_SIZE=20`; activity counts via
  `_count`+a `readingProgress.groupBy({completed:true})` batch), `updateMemberRole(id,role)` and `deleteMember(id)` —
  both return a structured `{ok}` / `{ok:false,error,status}` and GUARD against demoting/removing the LAST remaining
  admin (count Admins; reject with 409). Deleting a User cascades accounts/sessions/profile/readingProgress/savedWords
  (all `onDelete: Cascade`). API `PATCH|DELETE /api/admin/members/[id]` (`requireAdminApi`; 400 bad role, 404 missing,
  409 guard) ALSO refuses self-demotion/self-deletion via `auth.session.user.id` so an admin can't lock themselves out.
  Page `/admin/members` (server; reuses `.admin-search`/`.admin-table`/pagination) renders avatar+name+email, role pill,
  joined date and activity; the client `src/components/AdminMemberActions.tsx` is a role `<select>` (PATCH on change) +
  Remove button with inline `.admin-confirm` (controls disabled for the acting admin's own row, flagged with a "You"
  pill). Avatars use `next/image` with `unoptimized` (remote provider images, no remotePatterns config needed). New CSS:
  `.admin-member-cell`/`.admin-member-avatar`/`.admin-member-name`.
- Admin tag management (US-022): `src/lib/admin-tags.ts` owns `listAdminTags({query,page})` (LIKE-`contains` on
  name/slug; paginated, default `ADMIN_TAGS_PAGE_SIZE=20`; ordered by usage desc via
  `orderBy:{articles:{_count:"desc"}}`; per-tag `articleCount` (all statuses) via `_count` + a `published`
  subset from one `articleTag.groupBy({by:["tagId"], where:{article:{status:"published"}}})` batch) and
  `deleteTag(id)` (structured `{ok}`/`{ok:false,error,status}`, 404 missing). Deleting a `Tag` cascades its
  `ArticleTag` rows (articles lose the tag, content untouched). API `DELETE /api/admin/tags/[id]`
  (`requireAdminApi`; 401 unauth, 404 missing). Page `/admin/tags` (server; reuses `.admin-search`/
  `.admin-table`/pagination) lists name, slug (links to `/tags/[slug]`), usage and a delete action; the
  client `src/components/AdminTagActions.tsx` is the inline-`.admin-confirm` delete pattern (mirrors
  AdminMemberActions/AdminArticleActions).
- Article scraper CLI (US-024): `npm run scrape -- ...` runs `scripts/scrape.ts` via Node's
  type-stripping (`node --import ./scripts/register-ts.mjs`). Node strip-types needs explicit `.ts`
  extensions + can't resolve the `@/` alias, so `scripts/ts-resolve-hook.mjs` is an ESM resolve hook
  that maps `@/*`→`src/*` and adds `.ts`/`index.ts`; `scripts/package.json` `{"type":"module"}` scopes
  ESM to the dir (silences the TYPELESS warning) — use this same harness for any future TS CLI. Scraper
  lib is `src/lib/scraper/`: `providers.ts` (registry of NBC/NatGeo/Time/HuffPost keyed by hostname +
  `articleUrlPattern` for discovery + `categoryFor` mapping to `categories.ts` slugs), `extract.ts`
  (provider-agnostic: schema.org JSON-LD `NewsArticle` first, then OpenGraph/`<title>`/`<p>` fallback;
  body cleaned via `sanitizeArticleHtml`; rejects <50-word bodies), `index.ts` (`scrapeUrl`,
  `discoverProviderUrls`, `saveDraftArticle`). Saves `status:"draft"`, de-duped by `sourceUrl`
  (`findFirst`). GOTCHA: category regexes must NOT trail with `\b` (e.g. `\bsport\b` misses "sports") —
  anchor the stem at the start only. Provider article-URL patterns drift (Time moved to
  `/article/YYYY/MM/DD/slug/`); fix `articleUrlPattern` when discovery finds 0 links. CLI flags:
  `--provider <key> [--limit N]`, `--all`, `<url>...`, `--file <path> --url <u>` (offline), `--dry-run`,
  `--list-providers`.
- Article processing pipeline (US-025): `npm run process -- ...` runs `scripts/process.ts` (same
  TS-CLI harness as the scraper). `src/lib/processor.ts` orchestrates AI enrichment by calling the
  existing cache-first `getOrCreate*` helpers (difficulty → tags → vocabulary → quiz → optional
  translations → optional TTS) so the WHOLE pipeline is idempotent for free (re-running = cheap reads,
  steps reported `skipped`). `processArticle(id, {tts?, translateLangs?})` loads a `before` state via
  one `findUnique` with `_count` (tags/vocabulary/quizQuestions) + `translations`/`speech` selects to
  label each step `generated`/`skipped`/`fallback`/`failed`, then PUBLISHES drafts
  (`status:"draft"→"published"` + `publishedAt`) only when no step failed. GOTCHA:
  `getOrCreateArticleVocabulary` needs a userId (only for per-user saved flags) — pass the throwaway
  `PROCESSOR_USER_ID` constant; the AI extraction it caches is user-agnostic. `listUnprocessedArticleIds
  ({includePublished?, limit?})` selects work (default: drafts only; `includePublished` also matches
  published articles missing difficulty/tags/vocab/quiz via relation `none:{}` filters). Degrades
  gracefully when AI/Speech unconfigured (difficulty still works via heuristic; AI steps → `fallback`,
  drafts still publish). Reuse `processArticle`/`listUnprocessedArticleIds` for the US-026 worker +
  US-027 seeder. CLI flags: `<id>...`, `--all`, `--include-published`, `--limit N`, `--tts`,
  `--translate <es,fr,...>` (validated against `isSupportedLanguage`).

## Browser verification
- Playwright is installed. Run scripts from the project root (so `@playwright/test`
  resolves). Chromium binary is at
  `~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome` ($HOME=/home/azadmin; the
  /home/agent/...chromium-1208 path is stale). Launch with `--no-sandbox`.
- Verify role/session-gated pages without real OAuth: insert a `User` + `Session`
  (sessionToken) row, add cookie `next-auth.session-token=<token>` to the browser context
  (or curl `-H "Cookie: ..."`).
