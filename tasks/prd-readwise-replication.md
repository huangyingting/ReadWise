# PRD: ReadWise — AI-Assisted English Learning Reader (Full Feature Replication of ReadingX)

## 1. Introduction / Overview

ReadWise turns real-world news articles into an AI-assisted English learning
experience. A user (or admin) ingests article links, the system cleans the
content for focused reading, and on-demand AI helpers provide translation,
vocabulary building, comprehension checks, and audio narration with synchronized
word-level highlighting.

This PRD specifies a **full feature replication** of the existing ReadingX
application under the new product name **ReadWise**. It covers the web reading
experience, AI learning tools, authentication and roles, content discovery (tags,
categories, personalized picks), reading progress tracking, an admin dashboard,
and the offline content pipeline (scrapers, batch processor, background worker,
and seeding tools).

**The PRD is stack-agnostic**: it describes the required features and behaviors,
not specific technologies. Implementers may choose any framework, database, LLM
provider, TTS provider, and auth provider that satisfies the functional
requirements below. (Reference implementation used Next.js 15, MUI, Prisma, NextAuth,
Azure OpenAI, and Azure Speech, but these are non-binding.)

**Problem solved:** English learners struggle to find level-appropriate, engaging
reading material with integrated, on-demand support (translation, vocabulary,
listening, comprehension). ReadWise combines authentic news content with AI
tutoring helpers in a single focused reader.

## 2. Goals

- Let users read cleaned, distraction-free versions of real news articles.
- Provide on-demand AI learning tools: translation, vocabulary extraction,
  comprehension quizzes, and text-to-speech with synchronized highlighting.
- Personalize content discovery by topic and English proficiency level.
- Track reading progress per user and per article, with completion detection.
- Support a tag-based content discovery and related-article recommendation system.
- Provide an admin dashboard for managing articles, tags, members, and analytics.
- Provide an automated content pipeline to scrape, AI-enrich, and seed articles
  from multiple news providers.
- Enforce role-based access control (Admin vs. Reader).
- Maintain structured logging, request tracing, and an efficient caching strategy.

## 3. User Stories

Stories are grouped by area. Each is sized for one focused implementation session.
"Verify in browser" is required for any story with UI changes.

### Area A — Authentication & User Accounts

#### US-001: OAuth sign-in
**Description:** As a visitor, I want to sign in with a third-party identity
provider (e.g., Google and a Microsoft/enterprise provider) so that I can access
my personalized learning experience without managing a password.

**Acceptance Criteria:**
- [ ] Sign-in page offers at least two OAuth providers.
- [ ] Successful sign-in creates a user account on first login and a session on each login.
- [ ] User email, name, and avatar are stored from the provider profile.
- [ ] Unauthenticated access to protected pages redirects to sign-in with a return URL.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser.

#### US-002: Role-based access control
**Description:** As the platform owner, I want users to have roles (Admin, Reader)
so that administrative features are restricted.

**Acceptance Criteria:**
- [ ] Every user has a role; default is Reader.
- [ ] The first user to sign in is automatically assigned Admin.
- [ ] Admin-only pages/routes reject non-admin users (UI hidden + API 403).
- [ ] Session exposes the user id and role to the app.
- [ ] Typecheck/lint passes.

#### US-003: Sign-out and session persistence
**Description:** As a signed-in user, I want my session to persist across visits
and to be able to sign out.

**Acceptance Criteria:**
- [ ] Session persists across page reloads/visits until expiry.
- [ ] A visible sign-out action ends the session and returns to a public state.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser.

### Area B — Onboarding & User Profile

#### US-004: First-run onboarding flow
**Description:** As a new user, I want a short onboarding questionnaire so the app
can personalize content to my level and interests.

**Acceptance Criteria:**
- [ ] New users without a completed profile are routed to onboarding.
- [ ] Onboarding collects: age range, gender (optional), English level (A1–C2),
      and topic preferences (multi-select from the category list).
- [ ] Completing onboarding stores a user profile and marks it complete.
- [ ] Completed users are not shown onboarding again.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser.

#### US-005: Edit profile & account settings
**Description:** As a user, I want a settings area to review my account info and
update my learning preferences.

**Acceptance Criteria:**
- [ ] Settings page shows account info (name, email, avatar, role).
- [ ] Profile form lets the user update English level, topics, age range, gender.
- [ ] Changes persist and immediately affect personalized recommendations.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser.

### Area C — Article Reading Experience

#### US-006: Article reader with cleaned content
**Description:** As a reader, I want to open an article and read a clean,
distraction-free rendering of its content.

**Acceptance Criteria:**
- [ ] Article page shows title, author/source, hero image, and cleaned body content.
- [ ] Body renders sanitized HTML/markdown without ads or extraneous markup.
- [ ] Estimated time-to-read and difficulty level are displayed when available.
- [ ] Unauthenticated access redirects to sign-in with return URL.
- [ ] Invalid/missing article ids return a not-found state.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser.

#### US-007: Reading progress tracking
**Description:** As a reader, I want my scroll progress tracked so I can resume and
see which articles I've completed.

**Acceptance Criteria:**
- [ ] Scroll position maps to a 0–100% progress value (page starts at top, no auto-scroll).
- [ ] Progress updates are throttled (≤ 1 write/second) and forward-only.
- [ ] Reaching the end marks the article as completed.
- [ ] Progress persists per user+article and is restored on revisit.
- [ ] Article cards/listings reflect saved progress.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser.

#### US-008: Batch progress fetch for listings
**Description:** As a reader, I want listing pages to show my progress for many
articles efficiently.

**Acceptance Criteria:**
- [ ] A single batch request returns progress for a set of article ids.
- [ ] Only visited articles are refreshed (not the entire cache).
- [ ] Listings merge progress without N+1 requests.
- [ ] Typecheck/lint passes.

### Area D — AI Learning Tools (on-demand, per article)

#### US-009: Article translation
**Description:** As a reader, I want to translate the article into a target
language to aid comprehension.

**Acceptance Criteria:**
- [ ] Reader can request translation into a supported target language.
- [ ] Translation is generated by an AI provider and displayed alongside/under the original.
- [ ] Translations are cached per article+language and reused on subsequent requests.
- [ ] When AI credentials are absent, a graceful placeholder/fallback is returned.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser.

#### US-010: Vocabulary extraction & study list
**Description:** As a reader, I want key vocabulary extracted with explanations and
the ability to save words to my study list.

**Acceptance Criteria:**
- [ ] Each article can present extracted vocabulary (word, explanation, sample usage).
- [ ] Reader can save/unsave a vocabulary item to their personal list.
- [ ] Saved state is per user and persists; duplicates are prevented.
- [ ] A vocabulary dialog/panel lists the article's words and saved status.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser.

#### US-011: Word lookup context menu (dictionary)
**Description:** As a reader, I want to select/click a word in the article to see
its pronunciation and meaning instantly.

**Acceptance Criteria:**
- [ ] Selecting/clicking a word opens a context menu with the word's meaning(s).
- [ ] Lookup normalizes word forms (plurals, gerunds, contractions, possessives) to a base form.
- [ ] Pronunciation and grouped meanings are shown when available.
- [ ] Unknown words return a clear "not found" state.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser.

#### US-012: Comprehension quiz
**Description:** As a reader, I want multiple-choice comprehension questions to
check my understanding.

**Acceptance Criteria:**
- [ ] Each article can present multiple-choice questions with one correct answer.
- [ ] Reader selects answers and receives correct/incorrect feedback.
- [ ] Question set is generated by AI and stored with the article.
- [ ] A comprehension dialog displays questions, options, and results.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser.

#### US-013: Text-to-speech with word-level highlighting
**Description:** As a reader, I want to listen to the article narrated aloud with
each spoken word highlighted in sync.

**Acceptance Criteria:**
- [ ] Reader can generate/play TTS audio for the article.
- [ ] Word-level timing data drives synchronized highlighting of the current word.
- [ ] Playback controls support play/pause and seeking; view auto-scrolls only when
      the active word leaves a comfortable viewport zone.
- [ ] Generated audio + timings are cached per article and reused.
- [ ] Absent TTS credentials degrade gracefully (no crash).
- [ ] Typecheck/lint passes.
- [ ] Verify in browser.

#### US-014: Difficulty scoring & level assessment
**Description:** As a reader, I want articles labeled with a difficulty/English
level so I can pick appropriate material.

**Acceptance Criteria:**
- [ ] Each article stores an AI-assessed difficulty level / English level.
- [ ] Difficulty is shown on article cards and the reader page.
- [ ] Personalized recommendations can filter/sort by level.
- [ ] Typecheck/lint passes.

### Area E — Content Discovery

#### US-015: Tag system
**Description:** As a reader, I want articles tagged so I can discover related
content by topic.

**Acceptance Criteria:**
- [ ] Articles have zero or more tags (unique name + slug).
- [ ] Tags are auto-extracted during processing and viewable on the article.
- [ ] A tag listing returns articles for a given tag.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser.

#### US-016: Related articles
**Description:** As a reader, I want to see related articles based on shared tags.

**Acceptance Criteria:**
- [ ] A related-articles panel shows other articles ranked by shared-tag overlap.
- [ ] The current article is excluded; results are de-duplicated and limited.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser.

#### US-017: Category browsing homepage
**Description:** As a reader, I want a homepage organized by news categories so I
can browse by interest.

**Acceptance Criteria:**
- [ ] Homepage exposes the category set (e.g., World, Politics, Business, Health,
      Science, Tech, Sports, Culture, Entertainment) plus a personalized "Picks" view.
- [ ] Selecting a category loads its articles; selection is reflected in the URL.
- [ ] Listings support incremental/infinite loading.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser.

#### US-018: Personalized picks
**Description:** As a reader, I want a "Picks" feed tailored to my topics and level.

**Acceptance Criteria:**
- [ ] "Picks" returns articles matching the user's topic preferences and English level.
- [ ] Falls back sensibly when the profile is sparse.
- [ ] Picks are cached and reflect progress state.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser.

### Area F — Admin Dashboard

#### US-019: Admin dashboard overview
**Description:** As an admin, I want a dashboard landing view with key stats.

**Acceptance Criteria:**
- [ ] Admin area is navigable with sections: Dashboard, Articles, Tags, Members, Analytics.
- [ ] Dashboard shows summary metrics (e.g., article counts, members, processing status).
- [ ] Non-admins cannot access the admin area.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser.

#### US-020: Admin article management
**Description:** As an admin, I want to search, inspect, rebuild, and delete articles.

**Acceptance Criteria:**
- [ ] Admin can search/filter articles and view article content/details.
- [ ] Admin can delete an article (cascades remove related AI content/progress/tags).
- [ ] Admin can trigger a rebuild/re-processing of an article's AI content.
- [ ] Destructive actions require a confirmation dialog.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser.

#### US-021: Admin member management
**Description:** As an admin, I want to view members and manage their roles.

**Acceptance Criteria:**
- [ ] Admin can list members with key info and activity.
- [ ] Admin can change a member's role and/or remove a member.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser.

#### US-022: Admin tag management
**Description:** As an admin, I want to manage tags across the catalog.

**Acceptance Criteria:**
- [ ] Admin can list, view usage counts for, and delete tags.
- [ ] Typecheck/lint passes.
- [ ] Verify in browser.

#### US-023: Admin analytics
**Description:** As an admin, I want analytics on content and engagement.

**Acceptance Criteria:**
- [ ] Analytics view shows aggregate metrics (e.g., articles by category/level, member activity).
- [ ] Typecheck/lint passes.
- [ ] Verify in browser.

### Area G — Content Pipeline (offline tooling)

#### US-024: Multi-provider article scraper
**Description:** As an operator, I want a CLI to scrape articles from multiple news
providers so the catalog can be populated.

**Acceptance Criteria:**
- [ ] A scraper CLI supports multiple providers (e.g., NBC News, National Geographic, Time, HuffPost).
- [ ] Each provider extracts title, body, image, author, source, category, and published date.
- [ ] Extracted content is cleaned and saved as draft articles, de-duplicated by source URL.
- [ ] Typecheck/lint passes.

#### US-025: Article processing pipeline
**Description:** As an operator, I want a CLI to enrich existing articles with AI
content (analysis, vocabulary, questions, translation, TTS).

**Acceptance Criteria:**
- [ ] A processor CLI runs AI enrichment for selected/all unprocessed articles.
- [ ] It generates difficulty/level, vocabulary, comprehension questions, tags, and (optionally) TTS.
- [ ] Processing is idempotent and skips already-completed steps.
- [ ] Drafts are published when enrichment completes.
- [ ] Typecheck/lint passes.

#### US-026: Background processing worker
**Description:** As an operator, I want a long-running worker that continuously
processes the article queue.

**Acceptance Criteria:**
- [ ] A worker process polls for unprocessed articles and enriches them continuously.
- [ ] It handles failures with retries/backoff and logs progress.
- [ ] It can be started/stopped safely and resumes pending work.
- [ ] Typecheck/lint passes.

#### US-027: Seeding tool
**Description:** As an operator, I want a one-command seeder to populate the
database with enriched sample articles.

**Acceptance Criteria:**
- [ ] A seed command scrapes a provider and runs full AI enrichment + TTS.
- [ ] Re-running the seeder does not create duplicates.
- [ ] Typecheck/lint passes.

### Area H — Platform Concerns

#### US-028: Consistent API handler wrapper
**Description:** As a developer, I want all API endpoints wrapped with a shared
handler for auth, validation, logging, and error handling.

**Acceptance Criteria:**
- [ ] A reusable handler wrapper centralizes auth checks, request-id logging, and error formatting.
- [ ] Protected endpoints require authentication; public endpoints are explicitly exempt.
- [ ] All inputs are validated with a schema; client-provided ids are never trusted.
- [ ] Production error responses are generic; internals are logged, not leaked.
- [ ] Typecheck/lint passes.

#### US-029: Structured logging & request tracing
**Description:** As an operator, I want structured logs with per-request context
and performance metrics, plus client-side error capture.

**Acceptance Criteria:**
- [ ] Each request carries a request id available throughout its lifecycle (request-scoped context).
- [ ] Logs include user id (when authed), timings, and outcome.
- [ ] Client-side runtime errors are captured and reported.
- [ ] Typecheck/lint passes.

#### US-030: Caching with tag-based invalidation
**Description:** As an operator, I want category/picks/listing responses cached and
invalidated precisely when content changes.

**Acceptance Criteria:**
- [ ] Expensive listing/recommendation queries are cached server-side.
- [ ] Cache entries are invalidated by tag when underlying content changes.
- [ ] No stale content is served after an admin edit/delete/rebuild.
- [ ] Typecheck/lint passes.

#### US-031: Data model & integrity
**Description:** As a developer, I want a relational schema with constraints that
guarantee integrity.

**Acceptance Criteria:**
- [ ] Models exist for: User, Article, UserArticleProgress, Vocabulary, Question,
      ArticleTranslation, ArticleSpeech, UserVocabulary, Tag, ArticleTag, UserProfile
      (plus auth Account/Session/VerificationToken).
- [ ] Composite unique constraints prevent duplicates (e.g., userId+articleId,
      articleId+word, articleId+language, userId+vocabularyId, articleId+tagId).
- [ ] Foreign keys cascade deletes to dependent rows.
- [ ] Migrations create the schema reproducibly.
- [ ] Typecheck/lint passes.

#### US-032: Automated test suite
**Description:** As a developer, I want tests covering API routes, AI utilities,
scrapers, tags, and profiles so regressions are caught.

**Acceptance Criteria:**
- [ ] Tests cover API routes (progress, vocabulary, translation, TTS, admin),
      AI utilities (analyzer, translator, TTS), scraper(s), tags/related, and profile.
- [ ] Tests run without external DB/network (stubs/mocks) and pass green.
- [ ] Typecheck/lint passes.

## 4. Functional Requirements

Authentication & Roles
- FR-1: Support OAuth sign-in with at least two providers; create user + session on login.
- FR-2: Assign roles (Admin, Reader); default Reader; first user becomes Admin.
- FR-3: Restrict admin pages/routes to Admin role (UI hidden + API authorization).
- FR-4: Redirect unauthenticated access to protected pages to sign-in with return URL.

Onboarding & Profile
- FR-5: Route new users to onboarding to collect age range, gender (optional),
  English level (A1–C2), and topic preferences.
- FR-6: Persist a user profile and skip onboarding once completed.
- FR-7: Provide settings to view account info and edit learning preferences.

Reading Experience
- FR-8: Render cleaned, sanitized article content with title, source/author, image.
- FR-9: Display estimated time-to-read and difficulty/English level when available.
- FR-10: Track scroll-based reading progress (0–100%), throttled and forward-only,
  starting from the top with no auto-scroll, and detect completion.
- FR-11: Persist progress per user+article and restore on revisit; reflect in listings.
- FR-12: Provide a batch endpoint to fetch progress for multiple article ids.

AI Learning Tools
- FR-13: Translate an article to a target language on demand and cache per article+language.
- FR-14: Extract vocabulary (word, explanation, sample usage) and store per article.
- FR-15: Let users save/unsave vocabulary to a personal list; prevent duplicates.
- FR-16: Provide word lookup with base-form normalization (plurals, gerunds,
  contractions, possessives), returning pronunciation and meanings.
- FR-17: Generate multiple-choice comprehension questions with a correct answer and
  grade user responses.
- FR-18: Generate TTS audio with word-level timings; highlight the spoken word in
  sync; provide playback controls; cache audio+timings per article.
- FR-19: Auto-scroll the reader to the active word only when it exits a comfortable
  viewport zone.
- FR-20: Assess and store article difficulty/English level via AI.
- FR-21: When AI/TTS credentials are absent, return graceful fallbacks without errors.

Discovery
- FR-22: Support tags (unique name + slug); auto-extract tags during processing.
- FR-23: Return articles for a tag and compute related articles by shared-tag overlap.
- FR-24: Provide a homepage with the defined category set plus a personalized "Picks" feed.
- FR-25: Reflect selected category in the URL and support incremental loading.
- FR-26: Personalize "Picks" by the user's topic preferences and English level with fallbacks.

Admin
- FR-27: Provide an admin dashboard with Dashboard, Articles, Tags, Members, Analytics sections.
- FR-28: Allow admins to search/filter, view, rebuild, and delete articles (with confirmation).
- FR-29: Allow admins to list members and change roles / remove members.
- FR-30: Allow admins to list and delete tags with usage counts.
- FR-31: Provide aggregate analytics on content and engagement.

Content Pipeline
- FR-32: Provide a multi-provider scraper CLI that extracts and cleans articles and
  saves them as drafts, de-duplicated by source URL.
- FR-33: Provide a processor CLI that enriches articles (difficulty, vocabulary,
  questions, tags, translation, TTS) idempotently and publishes when complete.
- FR-34: Provide a background worker that continuously processes the queue with
  retries/backoff and logging.
- FR-35: Provide a seed command that scrapes + fully enriches sample articles without duplicates.

Platform
- FR-36: Wrap all API endpoints with a shared handler for auth, schema validation,
  request-id logging, and consistent error formatting.
- FR-37: Validate all inputs with schemas; never trust client-provided ids.
- FR-38: Emit structured logs with per-request context, user id, timings, and outcomes;
  capture client-side errors.
- FR-39: Cache expensive listing/recommendation responses with tag-based invalidation;
  invalidate on admin edit/delete/rebuild.
- FR-40: Implement the relational schema with composite unique constraints and cascading deletes.
- FR-41: Provide reproducible database migrations.
- FR-42: Provide an automated test suite that runs without external DB/network and passes.

## 5. Non-Goals (Out of Scope)

- No native mobile app (web only for this replication).
- No password/email-link authentication (OAuth only).
- No payment, subscription, or monetization features.
- No social features (comments, sharing, following, leaderboards).
- No real-time collaboration or multi-user presence.
- No spaced-repetition/SRS scheduling for saved vocabulary (beyond storing the list).
- No content licensing/rights management; scrapers are for personal/educational use.
- No new roadmap features beyond what the existing product implements (this is a
  replication, not an enhancement).
- No object-storage/CDN migration, rate limiting, or external monitoring integration
  (listed as future "Next Steps", not requirements here).

## 6. Design Considerations

- Clean, focused reading layout: prominent title, hero image, readable typography,
  minimal chrome; learning tools accessible via a toolbar/panel.
- Reading tools panel surfaces: Vocabulary, Comprehension/Quiz, Listen (TTS),
  Translation, and Related articles.
- Word interactions: selecting a word opens a lightweight context menu with meaning
  and pronunciation; saving vocabulary is one action.
- Homepage uses category chips/tabs with icons; "Picks" is the default personalized view.
- Admin uses a sidebar layout with the five sections and confirmation dialogs for
  destructive actions.
- Audio highlighting must feel smooth: highlight the active word and keep it within a
  comfortable viewport band (~20–80%).
- Reuse a shared confirmation-dialog component for all destructive actions.
- Accessibility: keyboard operability for playback and dialogs; sufficient contrast.

## 7. Technical Considerations

(Stack-agnostic — these are constraints/behaviors, not mandated technologies.)

- AI provider abstraction: translation, analysis (difficulty/vocabulary/questions/tags),
  and TTS should sit behind an interface so providers can be swapped and so missing
  credentials yield safe fallbacks.
- TTS requires a mechanism that returns word-level timing data to drive highlighting.
- Caching layer must support tag-based invalidation keyed to content changes.
- Request-scoped context (e.g., request id) must be available to logging throughout a request.
- Server-side rendering should merge progress data for instant first paint where possible.
- Database: integer auto-increment primary keys for content entities are acceptable;
  auth entities may use string ids per the chosen auth library.
- Pipeline tools (scraper/processor/worker/seeder) run outside the request lifecycle and
  share the same data layer and AI abstraction.
- A dictionary data source backs word lookup; word normalization rules cover contractions,
  possessives, plurals, and gerunds.
- Secrets live in environment configuration; sensitive keys are never exposed to the client.

## 8. Success Metrics

- Feature parity: all 32 user stories above implemented and passing acceptance criteria.
- A reader can: sign in, complete onboarding, open an article, translate it, look up a
  word, save vocabulary, take a quiz, and listen with synced highlighting — end to end.
- Personalized "Picks" returns level/topic-appropriate articles for a profiled user.
- Reading progress persists and resumes correctly across sessions; completion is detected.
- Admin can search, rebuild, and delete articles, manage members/tags, and view analytics.
- The content pipeline can scrape, enrich, and seed articles without duplicates.
- Automated test suite passes without external DB/network dependencies.
- Caching serves no stale content after admin edits/deletes/rebuilds.

## 9. Open Questions

- Which exact OAuth providers must be supported for ReadWise (Google + which enterprise/IdP)?
- Which target languages must translation support at launch (single vs. multiple)?
- Which news providers are in scope for scraping, and are there usage/legal constraints to honor?
- What is the source and licensing of the dictionary dataset used for word lookup?
- Should saved-vocabulary have a dedicated review/study page, or only an in-article list?
- Are there required default category definitions/order beyond the listed set?
- What are the data-retention expectations for user progress and saved vocabulary?
- Are draft articles ever visible to readers, or strictly hidden until published?
