# Refactoring backlog

This document captures refactoring candidates that should be turned into future
epics and issues. It is planning material, not an implementation changelog.

Last updated: 2026-06-25. Rounds: first, second, third, fourth, fifth, sixth, seventh, eighth, ninth, and tenth analysis passes.

## Guiding principles

- Prefer modular, reusable subsystems over large mixed-responsibility files.
- Make boundaries explicit: domain logic, data access, route glue, UI state,
  presentational components, and styling should not all live in one file.
- Remove duplicated code by extracting small shared helpers or feature-scoped
  services with clear tests.
- Delete old code and compatibility layers after callers and data have been
  migrated. Do not add new compatibility wrappers unless a migration plan also
  removes them.
- Split large files along stable domain seams, not arbitrary line counts.
- Improve readability while preserving current behavior, security boundaries,
  privacy guarantees, accessibility behavior, and graceful degradation.
- Keep source, tests, schema, and docs aligned in every refactor PR.

## Evidence snapshot

The first scan found these prominent hotspots:

- `src/app/globals.css`: 5,037 lines, with styles for landing, command palette,
  reader layout/tools, annotations, tutor, translation, quiz, pronunciation,
  lists, and legacy token aliases.
- `src/lib/config.ts`: 1,077 lines, while `src/lib/runtime-config/*` currently
  mostly re-export from it.
- Large client components: `ArticlePronunciation.tsx` (1,002),
  `FlashcardReview.tsx` (956), `WordLookup.tsx` (756),
  `OnboardingForm.tsx` (741), `CommandPalette.tsx` (719),
  `ListSwitcher.tsx` (708).
- Large service modules: `src/lib/jobs.ts` (726),
  `src/lib/recommendations.ts` (682), `src/lib/scraper/providers.ts` (579),
  `src/lib/study-plan.ts` (515).
- Large tests: `tests/db/postgres.test.ts` (1,280) and several 450+ line route
  and domain test files.
- Repeated reader article access/rate-limit patterns across reader AI routes.
- Remaining compatibility paths: JSON-string fallbacks for `Profile.topics` and
  quiz options, `htmlToPlainText` alias, `--jobs` worker no-op,
  `ArticleSpeech.audioBase64` fallback, legacy CSS aliases, and the historical
  `searchPublishedArticles` entry point.

The second scan found additional hotspots:

- Client-side API calls: `src/lib/client-fetch.ts` exists, but only a few
  components use it while dozens still hand-roll `fetch`, JSON parsing,
  non-OK handling, timeout/abort behavior, and user-facing error strings.
- Client error reporting: `ClientErrorReporter`, route-group `error.tsx` files,
  `global-error.tsx`, and `ReaderPanelErrorBoundary` each POST directly to
  `/api/client-errors` with similar payload logic.
- Scraper/content ingestion: provider definitions, category rules, URL
  extraction, fetch/SSRF limits, content extraction, discovery, persistence,
  content-source governance, and provider health are split across several files
  but still lack a clear package boundary.
- Feed/recommendation duplication: `src/lib/feed.ts` has its own scoring,
  diversity, context loading, and cache logic while `src/lib/recommendations.ts`
  has another recommendation engine.
- Observability/data modules: `src/lib/metrics.ts`, `analytics-queries.ts`,
  `speech.ts`, `offline-db.ts`, `ArticleTutor.tsx`, and `ai/eval.ts` each mix
  several stable responsibilities that can become reusable subsystems.
- Tenant/classroom workflows: `src/lib/org.ts`, `src/lib/classroom.ts`, and
  teacher forms mix authorization, writes, read models, progress matrices, and
  repeated client mutation UI patterns.

The third scan found additional hotspots:

- Content processing and rebuild workflows: `processor.ts`, `backfill.ts`,
  `processing-state.ts`, `admin-ai-ops.ts`, worker scripts, and admin backfill
  UI all coordinate article enrichment, processing steps, AI budgets, job queue
  work, and operator reporting without a single explicit processing subsystem.
- AI platform cross-cuts: `ai.ts`, `ai-budget.ts`, `ai-ledger.ts`,
  `ai-cache.ts`, and `ai/prompts.ts` are individually useful but mix provider
  orchestration, retry, budget enforcement, ledger writes, prompt registry,
  cache orchestration, and admin summaries.
- Learning domain services: study plan, skill mastery, word mastery, article
  mastery, SRS flashcards, and cloze logic share learning signals but are spread
  across separate flat modules with repeated score/threshold patterns.
- Reader shell and providers: the reader page loads many independent data
  sources, owns JSON-LD and preference bootstrap scripts, and composes several
  stateful providers (`ReaderAudioProvider`, `ReaderHighlightsProvider`,
  `ReaderToolsProvider`) that each mix API calls, optimistic state, DOM/audio
  concerns, offline behavior, and accessibility announcements.
- Personal import and admin UI: the import API route combines URL/text import,
  quota, SSRF, scraping, sanitization, persistence, audit, analytics, and
  heuristic difficulty; admin pages/components repeat table, filter, action
  panel, busy/error, and confirmation patterns.
- Test and script infrastructure: route tests repeat session/jsonReq/module-mock
  scaffolding, while CLI scripts repeat argument parsing, help text, summaries,
  signal handling, and environment/runtime setup.

The fourth scan found additional hotspots:

- Media storage: `src/lib/storage/*` is already a small package, but storage
  runtime selection, cloud seam fallbacks, filesystem/Azure adapters,
  speech-specific migration, and future S3/R2 support need clearer provider and
  migration boundaries.
- Push/reminders: `push.ts` and `reminder-preferences.ts` mix VAPID setup,
  subscription delivery, dead endpoint pruning, due-card discovery,
  timezone/quiet-hour preferences, and reminder job reporting.
- Security and compliance: rate limiting, shared rate-limit store fallback,
  security event ring/spike alerting, audit metadata scrubbing, CSRF, trusted IP
  resolution, RBAC, and session/API guards are separate flat modules with
  overlapping privacy and request-context concerns.
- Search/cache/listing: `article-search.ts`, `cache.ts`, `articles.ts`, and
  `tags.ts` each contain search/listing/ranking/cache invalidation pieces that
  are related but not packaged as a clear discovery/search subsystem.
- Article library data services: article access, public/private article listing,
  admin article detail/actions, tags, bookmarks/reading lists, content review,
  and takedown rights workflows all touch article lifecycle and visibility but
  live in separate broad modules.
- Validation and auth ergonomics: the schema helper is useful but generic route
  schemas live inline in routes; session/page guards and API auth guards are
  split across small modules with compatibility wrappers still documented.

The fifth scan found additional hotspots:

- Engagement and progress systems: `progress.ts`, `activity.ts`,
  `reading-speed.ts`, `reading-speed-stats.ts`, and learner analytics share
  date/timezone, forward-only progress, streaks, heatmaps, speed, and weekly
  aggregation concepts without a unified engagement package.
- Leveling and placement: `leveling.ts`, `difficulty.ts`, `placement.ts`, and
  level-history helpers each own CEFR ranks, thresholds, explanations,
  recommendations, and evidence collection in overlapping ways.
- Language AI feature services: vocabulary, quiz, translation,
  sentence-translation, grammar, and difficulty use similar cache-first,
  prompt-rendering, access, validation, fallback, and persistence patterns but
  are implemented as separate flat modules.
- Lexical tooling: dictionary lookup, word normalization, saved vocabulary,
  word mastery, cloze, and dictionary UI hooks share word-form normalization and
  provider/fallback concepts that are not packaged together.
- Analytics event stream and observability: `analytics.ts`, one-line analytics
  barrel files, learner/tenant analytics, error reporting, logger, tracing, and
  SLO evaluation share metadata/redaction/versioning concerns with only partial
  subsystem boundaries.
- Practice and annotation domains: quiz attempts, pronunciation attempts,
  dictation grading, highlights, offline conflict resolution, and anchor
  revalidation share attempt/history/optimistic/offline reconciliation patterns.
- Account/member lifecycle: account export/delete, admin member list/detail,
  session revocation, support repair, and member export reuse privacy-sensitive
  data collection/audit patterns that are not yet a cohesive account subsystem.

The sixth scan found additional hotspots:

- App shell/navigation: desktop sidebar, mobile bottom tabs, More sheet,
  header search, active-route logic, role-gated admin links, localStorage
  collapsed state, and reader-route overrides are spread across shell components
  without a single navigation state/model subsystem.
- Reader display preferences: `ReaderControls`, `reader-prefs.ts`, reader-page
  no-flash scripts, reader CSS tokens, Popover/Sheet behavior, and localStorage
  parsing all coordinate the same reading mode/font/spacing state.
- PWA/offline runtime: `public/sw.js`, `public/offline-reader.html`,
  `cache-version.ts`, `offline-db.ts`, `OfflineDownloadButton`, and
  `ServiceWorkerRegister` duplicate cache/version/store constants. The static
  offline reader currently opens IndexedDB with version `1` while the app store
  is version `2`, a drift risk.
- UI primitives/design system: `Button`, `Card`, `Field`, `Input`, `Select`,
  `Textarea`, `Sheet`, `Popover`, `Tooltip`, `SegmentedControl`, badges, and
  focus-trap helpers are reusable but not yet governed by component contracts,
  stories, or cross-component accessibility tests.
- Listing/card UX: `CategoryBrowser`, `ForYouFeed`, `PersonalImports`,
  `ArticleCardView`, `ListingProgressSync`, `ListingBookmarkSync`, and bookmark
  controls repeat load-more, SSR hydration, DOM selector sync, progress, and
  saved-state behavior.
- Page composition: marketing home, dashboard, progress, settings, and import
  pages contain large local section/widget components and static content arrays
  rather than feature-owned page section modules.
- Runtime/deployment config: middleware protected route prefixes, Next security
  headers/CSP, service-worker registration, Dockerfile/entrypoint, Playwright
  env defaults, and package scripts can drift because route, security, and
  runtime policy are hand-maintained in separate files.

The seventh scan found additional hotspots:

- Reader study panels: `ArticleVocabulary`, `ArticleQuiz`, `ArticleDictation`,
  and `ArticleStudySection` still mix lazy fetch, AI fallback UI, optimistic
  mutations/offline queueing, scoring, history, sentence navigation, and panel
  presentation outside the larger reader-tool refactors.
- Route segment states: many `loading.tsx`, `error.tsx`, and `not-found.tsx`
  files repeat skeleton/error layout, report-client-error snippets, dashboard
  links, digest display, and page-specific copy without shared state components.
- Authentication/profile entry points: `auth.ts`, sign-in pages/buttons,
  profile route, settings page/form, middleware session cookie names, and
  first-user admin bootstrap are small but cross-cut auth/profile/onboarding
  concerns.
- Seed and test fixtures: `src/lib/seed.ts`, `scripts/seed.ts`, and
  `e2e/support/seed.ts` all create representative users/articles and reset data
  with overlapping assumptions about article shape, providers, enrichment,
  session cookies, and safe databases.
- Worker runtime: `src/lib/worker.ts` owns polling, sleeping, abort handling,
  job handler dispatch, default job-type handlers, worker stats, tracing,
  metrics, and error capture on top of the job queue itself.
- AI safety/parser layer: `ai/validation.ts`, `ai/moderation.ts`, and provider
  error classifiers define structured-output parsing, heuristic moderation,
  normalized provider errors, and retry metadata but are not packaged as a
  distinct AI safety/output contract subsystem.

The eighth scan found additional hotspots:

- Prisma schema and migrations: SQLite and PostgreSQL schemas are both large
  and intended to stay semantically aligned; schema comments encode many domain
  decisions, while migration parity and generated artifacts are easy to drift.
- API surface contracts: 80+ `src/app/api/**/route.ts` files use shared handler
  wrappers, but request/response shapes, route naming, pagination conventions,
  and status-code contracts are not captured in a machine-readable API catalog.
- Documentation and ADR corpus: docs are extensive, and `docs/refactoring.md`
  itself has become a large backlog that will need taxonomy, prioritization,
  deduplication, and issue-generation workflow before becoming epics.
- HTML/content transformation safety: sanitizer, provider cleanup,
  optional HTML normalization, article HTML-to-reader-text conversion,
  bilingual paragraph alignment, and offline reader rendering all transform
  stored/scraped HTML with separate safety assumptions.
- External network clients: scraper fetch/SSRF/robots, dictionary fetch, AI
  provider fetch, speech token calls, OAuth providers, push delivery, and remote
  media all implement different timeout/retry/safety behavior.
- Product copy and localization readiness: user-facing English copy is embedded
  throughout routes, pages, components, errors, metadata, notification payloads,
  and marketing content, while supported target languages are handled separately.
- Legal/static pages and metadata: terms, privacy, manifest, OpenGraph/Twitter
  metadata, landing copy, and offline static pages repeat product positioning
  and are not governed as a content subsystem.

The ninth scan found additional hotspots:

- Client/server and package boundaries: many client components and server route
  files import from broad `@/lib/*` modules directly. There is no automated
  boundary check that prevents client bundles from accidentally importing
  server-only modules, Prisma, secrets, Node APIs, logging/tracing, or runtime
  config.
- Browser storage contracts: localStorage/sessionStorage keys are spread across
  theme, reader prefs, sidebar state, bilingual mode, translation language,
  visited articles, reader referrer, bookmark changes, welcome/hint dismissal,
  level recommendation dismissal, and service-worker/offline messages.
- Keyboard and focus interactions: the shortcut reference is display-only while
  runtime key handlers live in command palette, flashcards, reader tools,
  overlays, swatches, note editors, dictation/tutor forms, and focus traps.
- Tooling and TypeScript runtime: package scripts repeat Node flags, custom
  TypeScript ESM resolver hooks, experimental strip-types, `.env` loading, and
  script-specific package config; ESLint currently ignores scripts entirely.
- Public assets: OpenDyslexic fonts, icons, SVG, offline pages, manifest assets,
  and image/font references are manually managed without an asset manifest,
  ownership rules, or bundle/performance checks.
- Page/data access layering: some server pages and routes still import Prisma or
  low-level domain modules directly instead of going through feature read-models
  or service boundaries, making it easy for page composition to leak domain
  details.

The tenth scan found additional hotspots:

- Domain result/error contracts: services variously return `{ ok:false, error,
  status }`, `null`, thrown `Error`, thrown `ApiError`, or custom error classes.
  Routes then map these shapes manually, which makes command/service contracts
  uneven.
- Display formatting: relative time, dates, durations, percentages, currency,
  WPM labels, lock ages, score rounding, and week buckets are implemented in
  many pages/components despite some shared aggregation helpers already
  existing.
- Client-safe option registries: categories, supported translation languages,
  frequency tiers, profile options, CEFR labels, badge variants, and UI labels
  are spread across lib and component modules with mixed client/server import
  constraints.
- Small shared utilities: `aggregation`, `backoff`, `safe-json`, `cn`, focus
  helpers, storage-key helpers, and browser storage helpers are useful but lack
  a cohesive platform-utilities package and ownership/testing standards.
- Dependency-injection/test seams: many services define ad hoc `deps` types for
  tests (`BackfillDeps`, `SeedDeps`, worker deps, query clients), while others
  mock modules directly. There is no convention for where seams belong.

## Themes, epics, and index

REF items are grouped by subsystem theme for planning and epic creation. Use
this index to find related items, understand sequencing dependencies, drive
priority-tier planning, and generate GitHub issues without re-running analysis.

### Theme taxonomy

Each theme maps to one or more GitHub epics labelled `area: <theme>`. Assign
the label when creating issues from candidates below.

| Theme | Description | REF items |
|-------|-------------|-----------|
| **platform** | Runtime config, auth/security governance, CLI tooling, import boundaries, utility modules, domain error contracts, compatibility cleanup | REF-002, REF-009, REF-037, REF-044, REF-052, REF-060, REF-064, REF-073, REF-076, REF-079, REF-082, REF-085 |
| **api** | Route handlers, shared handler wrappers, client fetch, tenant services, validation schemas, API contracts, page data access | REF-003, REF-014, REF-024, REF-042, REF-043, REF-070, REF-081 |
| **ai** | AI client orchestration, budgets/ledger, prompt registry, AI eval, cache-first feature services, AI output validation, tag taxonomy | REF-022, REF-023, REF-026, REF-027, REF-041, REF-047, REF-067 |
| **reader** | Reader page shell, client providers, WordLookup, pronunciation, reader display prefs, study panels, annotation domain service | REF-004, REF-005, REF-029, REF-030, REF-050, REF-055, REF-062 |
| **learning** | Flashcard/SRS, learning mastery, study plan, engagement/streaks, CEFR/difficulty/placement, lexical tooling, practice attempts | REF-006, REF-028, REF-045, REF-046, REF-048, REF-051 |
| **content-ingestion** | Scraper providers, feed/recommendations, processing subsystem, article import, article search, article library, HTML safety pipeline | REF-010, REF-016, REF-017, REF-025, REF-031, REF-038, REF-040, REF-072 |
| **data-schema** | Prisma schema parity, migrations, analytics queries, listing cache keys, analytics event stream | REF-019, REF-039, REF-049, REF-069 |
| **observability** | Client error reporting, metrics registry, observability core (logger, tracing, SLO) | REF-015, REF-018, REF-053 |
| **frontend** | Global CSS, reading-list UI, onboarding, command palette, offline storage UI, admin UI, app shell, UI primitives, listing cards, dashboard pages, route segment states, profile/preferences UI, product copy, legal pages, browser storage keys, keyboard shortcuts, static assets, display formatting, option registries | REF-001, REF-007, REF-011, REF-012, REF-021, REF-032, REF-054, REF-057, REF-058, REF-059, REF-063, REF-068, REF-074, REF-075, REF-077, REF-078, REF-080, REF-083, REF-084 |
| **tests** | PostgreSQL test support, route test harnesses, seed/E2E fixtures, DI/test seam patterns | REF-013, REF-033, REF-065, REF-086 |
| **operations** | Job queue, speech pipeline, CLI utilities, media storage, push/reminders, worker runtime, PWA/offline, word-frequency data | REF-008, REF-020, REF-034, REF-035, REF-036, REF-056, REF-061, REF-066 |
| **planning** | Refactoring program governance, backlog organization, issue-generation workflow | REF-071 |

### Priority tiers

| Priority | Definition | P0 items | P1 items | P2 items | P3 items |
|----------|-----------|----------|----------|----------|----------|
| **P0** | Foundation blockers — address before other items in the same area can land safely | REF-001, REF-002, REF-003, REF-014, REF-016, REF-025, REF-026, REF-060, REF-069, REF-072, REF-076, REF-082 | — | — | — |
| **P1** | High-value refactors — pick up immediately after P0 items in the same theme are complete | — | REF-004, REF-005, REF-006, REF-007, REF-008, REF-009, REF-015, REF-017, REF-018, REF-020, REF-021, REF-024(?), REF-029, REF-030, REF-031, REF-033, REF-037, REF-038, REF-040, REF-047, REF-050, REF-055, REF-056, REF-058, REF-062, REF-066, REF-071 | — | — |
| **P2** | Normal backlog — pick up in dependency order after higher-priority items clear | — | — | REF-010, REF-011, REF-012, REF-013, REF-019, REF-022, REF-023, REF-024, REF-027, REF-028, REF-032, REF-034, REF-035, REF-036, REF-039, REF-041, REF-042, REF-043, REF-044, REF-045, REF-046, REF-048, REF-049, REF-051, REF-052, REF-053, REF-054, REF-057, REF-059, REF-063, REF-064, REF-065, REF-067, REF-068, REF-070, REF-073, REF-077, REF-078, REF-079, REF-081, REF-083, REF-084, REF-086 | — |
| **P3** | Deferred / nice-to-have — address opportunistically | — | — | — | REF-061, REF-074, REF-075, REF-080, REF-085 |

### Dependency map

Items that should be completed (or substantially started) before downstream
work begins. Arrows indicate "must precede".

```
Platform foundations
  REF-002 (runtime config)   → REF-073 (external HTTP clients)
  REF-076 (import boundaries) → all client-component migrations

API / route foundations
  REF-014 (client fetch layer) → REF-004, REF-007, REF-011, REF-012, REF-030, REF-058
  REF-043 (route schemas)      → REF-003, REF-014, REF-024, REF-042
  REF-003 (reader route guard) → REF-004, REF-005, REF-029, REF-030, REF-062
  REF-044 (auth guards)        → REF-037, REF-052

AI foundations
  REF-026 (AI orchestration)   → REF-027 (prompt registry), REF-047 (cache-first AI), REF-067 (AI validation)
  REF-047 (cache-first AI)     → REF-022 (tutor), REF-041 (tag taxonomy)

Content ingestion chain
  REF-016 (scraper package)    → REF-017 (feed/recommendations), REF-031 (import), REF-072 (HTML pipeline)
  REF-025 (processing subsystem) → REF-031 (import service), REF-066 (worker runtime)
  REF-072 (HTML pipeline)      → REF-004 (WordLookup safe render), REF-050 (annotations)

Reader chain
  REF-029 (reader page shell)  → REF-030 (reader providers), REF-055 (reader prefs), REF-062 (study panels)
  REF-050 (annotations)        → REF-004 (WordLookup), REF-030 (reader providers)

Learning chain
  REF-028 (mastery signals)    → REF-045 (engagement), REF-051 (practice attempts)
  REF-046 (CEFR/difficulty)    → REF-028 (mastery), REF-048 (lexical tooling)

Observability chain
  REF-053 (observability core) → REF-015 (client error reporting), REF-018 (metrics), REF-049 (analytics)

Data/schema chain
  REF-069 (Prisma parity)      → REF-009 (legacy compat removal), REF-039 (cache keys)

Test infrastructure
  REF-033 (route test harnesses) → REF-013 (postgres test support), REF-065 (seed/fixtures)
  REF-086 (DI/seam patterns)     → REF-033, REF-065
```

### Overlapping and cross-linked candidates

Items that share domain or implementation scope. When picking up a candidate,
read all items it is cross-linked with to avoid inconsistent solutions.

| Primary item | Cross-linked items | Overlap description |
|---|---|---|
| REF-010 | REF-017 | Both address the dual recommendation/feed engines. REF-017 is the broader consolidation. |
| REF-015 | REF-053 | Client error reporting is a subsystem of the observability core. Start REF-053 first. |
| REF-037 | REF-044, REF-060 | Security governance, auth guards, and CSP/headers all govern request safety. Align in one epic. |
| REF-039 | REF-047 | Cache key centralization and cache-first AI services both need a consistent cache-key contract. |
| REF-041 | REF-016, REF-027 | Tag taxonomy rules appear in AI tag prompts and scraper category rules. |
| REF-046 | REF-028, REF-048 | CEFR/difficulty, mastery signals, and lexical tooling share leveling thresholds and word-form normalization. |
| REF-054 | REF-068, REF-012 | App shell navigation, user profile preferences, and command palette all read/write shell localStorage state. |
| REF-082 | REF-043, REF-070 | Domain command contracts, route validation schemas, and the API catalog define the same API surface. |
| REF-083 | REF-084, REF-085 | Display formatting, option registries, and utility modules are all platform-primitive concerns. |
| REF-085 | REF-086 | Utility module governance and DI/seam patterns are both platform hygiene items — address together. |

---

## Issue-generation workflow

Use this workflow when converting a REF candidate into a GitHub issue or epic.
It applies equally to manual issue creation and to automated output from
`scripts/export-backlog.ts`.

### Pre-flight checklist

Before opening an issue for a REF candidate:

- [ ] Read the full candidate text (problem, best strategy, detailed
      requirements, acceptance checks, suggested issue split).
- [ ] Check the **Overlapping candidates** table above. If the candidate
      overlaps with others, decide whether to address them together or leave
      explicit cross-links in the issue body.
- [ ] Check the **Dependency map**. List any upstream items that should land
      before this one.
- [ ] Confirm the candidate is not already tracked in the issue tracker
      (search by REF ID and by title keywords).
- [ ] Choose an issue split strategy from the candidate's "Suggested issue
      split" section.

### Issue body template

Paste this template when opening a GitHub issue from a REF candidate. Fill
every field; leave no placeholder text in the opened issue.

```markdown
## Refactoring candidate <REF-NNN>

Parent epic: #<epic-issue-number> — [EPIC] <epic-title>

Source backlog: `docs/refactoring.md`, heading `<REF-NNN>` (anchor: `<anchor>`).

## Why this matters

<One paragraph copied or paraphrased from the candidate "Problem" section.>

## Source backlog details

Priority: <P0|P1|P2|P3>. Area: <area>. Theme: <theme>.

<Full "Detailed requirements" block from the candidate.>

## Dependencies

Depends on: <list REF IDs or issue numbers, or "none">.
Blocking: <list downstream REF IDs, or "none">.

## Cross-links

Overlaps with: <list cross-linked REF IDs with one-line note, or "none">.

## Acceptance checks

<Full "Acceptance checks" block from the candidate.>

## Risk and validation scope

Risk: <low|medium|high> — <one sentence why>.
Validation: <narrowest useful check, e.g. "npm run typecheck && npm test">.
Docs impact: <yes — update X / no>.
Migration impact: <yes — describe / no>.
Compatibility-removal gate: <describe guard condition, or "n/a">.

## Suggested issue split

<Full "Suggested issue split" block from the candidate.>

## Coding-agent execution checklist

- [ ] Read `AGENTS.md` and the source files referenced by the backlog item before editing.
- [ ] Identify current behavior and preserve it unless this issue explicitly calls for deletion of legacy/compatibility code.
- [ ] Make the smallest incremental refactor that creates a clearer boundary or reusable subsystem.
- [ ] Avoid broad rewrites and unrelated formatting changes.
- [ ] Add or update focused tests at the narrowest useful seam; mock database/network/AI/storage where appropriate.
- [ ] Update docs if behavior, scripts, env vars, schema, runtime workflows, or operator instructions change.
- [ ] Run the narrowest relevant validation first, then broaden if the touched area warrants it.
- [ ] Include this issue number in the PR description and summarize any follow-up issues discovered.
```

### Epic structure

Each theme gets one parent epic issue. Child issues (one per REF candidate, or
one per "Suggested issue split" item) are linked to the parent using GitHub's
sub-issue / parent relationship. Recommended epic labels:

| Epic title | Labels |
|---|---|
| [EPIC] Refactor Platform Foundations | `epic`, `area: platform`, `refactoring` |
| [EPIC] Refactor API Contracts and Route Layer | `epic`, `area: api`, `refactoring` |
| [EPIC] Refactor AI Platform and Feature Services | `epic`, `area: ai`, `refactoring` |
| [EPIC] Refactor Reader Shell and Providers | `epic`, `area: reader`, `refactoring` |
| [EPIC] Refactor Learning Systems | `epic`, `area: learning`, `refactoring` |
| [EPIC] Refactor Content Ingestion Pipeline | `epic`, `area: content-ingestion`, `refactoring` |
| [EPIC] Refactor Data and Schema Governance | `epic`, `area: data-schema`, `refactoring` |
| [EPIC] Refactor Observability and Error Reporting | `epic`, `area: observability`, `refactoring` |
| [EPIC] Refactor Frontend and Design System | `epic`, `area: frontend`, `refactoring` |
| [EPIC] Refactor Test Infrastructure | `epic`, `area: tests`, `refactoring` |
| [EPIC] Refactor Operations and Runtime | `epic`, `area: operations`, `refactoring` |

### Export for planning

Run the backlog export script to generate a JSON or CSV snapshot suitable for
spreadsheet/project-management import:

```bash
# Dry-run (prints JSON to stdout, no files written):
node --experimental-strip-types --import ./scripts/register-ts.mjs \
  scripts/export-backlog.ts

# Write JSON file:
node --experimental-strip-types --import ./scripts/register-ts.mjs \
  scripts/export-backlog.ts --format json --out backlog-export.json

# Write CSV file:
node --experimental-strip-types --import ./scripts/register-ts.mjs \
  scripts/export-backlog.ts --format csv --out backlog-export.csv
```

The script parses `docs/refactoring.md` directly and does not contact GitHub or
write to any external service. It is safe to run in any environment.

---

## Closing and superseding candidates

When a refactor lands, update this document to record the outcome.

### Process

1. **Open**: add the issue to the tracker using the template above. Leave the
   candidate in `docs/refactoring.md` unchanged so the full rationale is
   preserved for PR reviewers.

2. **In progress**: add a "Status" line to the candidate heading:

   ```markdown
   ### REF-NNN — <title>

   Status: in progress — tracked in #<issue-number>.
   ```

3. **Done**: replace the "Status" line with a "Resolved" line after the PR
   merges:

   ```markdown
   ### REF-NNN — <title>

   Status: resolved in #<pr-number> (<YYYY-MM-DD>).
   ```

   Do not delete the candidate text; it serves as an audit trail and
   rationale for reviewers of subsequent changes.

4. **Superseded / merged**: if the candidate is fully covered by another item
   or absorbed into a broader refactor, add:

   ```markdown
   Status: superseded by REF-NNN / #<issue-number>.
   ```

5. **Won't fix / deferred indefinitely**: document the decision in a
   "Status" line with a brief rationale so future engineers do not re-open it:

   ```markdown
   Status: deferred — <one-line reason> (<YYYY-MM-DD>).
   ```

---

## Candidate issues

### REF-001 — Split global CSS into styling subsystems

Priority: P0. Area: styling/design system.

Problem: `src/app/globals.css` has become a cross-feature stylesheet. It mixes
base tokens, utility classes, landing animations, command palette styles, reader
layout, tool surfaces, annotations, tutor UI, study interactions, pronunciation,
and list switcher styles. This makes ownership unclear and encourages new
features to add more global selectors. `src/app/tokens.css` still references a
much smaller legacy `globals.css`, showing the comments are stale.

Best strategy: split by styling subsystem while keeping one global import path
for Next.js. Keep `src/app/globals.css` as a thin orchestrator that imports
Tailwind, tokens, and ordered feature CSS files under `src/app/styles/`.

Detailed requirements:

- Preserve CSS order and cascade behavior: Tailwind import first, tokens before
  any token consumers, base styles before utilities, feature styles after shared
  primitives.
- Create stable subfiles such as `base.css`, `utilities.css`, `landing.css`,
  `command-palette.css`, `reader-layout.css`, `reader-tools.css`,
  `annotations.css`, `tutor.css`, `study.css`, `pronunciation.css`, and
  `lists.css` only where the existing selectors justify them.
- Replace milestone comments (`M#`, issue-number archaeology) with durable
  domain comments.
- Do not move component class names into CSS modules until the component is
  refactored; first preserve behavior with a pure file split.
- Add a rule for new work: colocate styles in components with utilities or a
  feature CSS file; do not append unrelated feature CSS to `globals.css`.
- Verify reader, command palette, annotations, pronunciation, lists, and landing
  pages at mobile and desktop breakpoints.

Acceptance checks:

- `src/app/globals.css` is mostly imports plus a small documented base layer.
- No visual regressions in the existing smoke paths.
- No stale references to the old `globals.css` size or legacy milestone labels.

Suggested issue split:

1. Create style subsystem files and move CSS without semantic edits.
2. Remove stale comments and document the new style ownership rules.
3. Add focused visual/a11y checks for reader tools and command palette.

### REF-002 — Complete runtime configuration modularization

Priority: P0. Area: configuration/runtime readiness.

Problem: `src/lib/config.ts` centralizes unrelated configuration concerns: AI,
speech, push, rate limiting, quotas, observability, trusted proxy, CSRF,
security events, analytics, and readiness validation. The `src/lib/runtime-config`
directory exists, but its files currently mostly re-export from `config.ts`, so
the modular boundary is incomplete.

Best strategy: finish the strangler migration into a real `runtime-config`
subsystem, then delete the old compatibility facade after all imports move.

Detailed requirements:

- Introduce shared low-level helpers in a small module such as
  `src/lib/runtime-config/env.ts` for env reads, booleans, integers, URLs, and
  issue construction.
- Move feature-owned config into dedicated files:
  `ai.ts`, `speech.ts`, `push.ts`, `rate-limit.ts`, `observability.ts`,
  `security.ts`, `analytics.ts`, and `runtime.ts`.
- Keep `validateRuntimeConfig` behavior identical, including optional-provider
  graceful degradation and readiness error/warning semantics.
- Replace all direct imports from `@/lib/config` with feature-specific
  `@/lib/runtime-config/*` imports.
- Remove `src/lib/config.ts` once no callers depend on it. If a temporary facade
  is needed during migration, it must be removed in the same epic.
- Update `.env.example` and docs when env ownership or validation messages move.
- Add or preserve unit coverage for required/optional provider validation,
  invalid URL handling, rate limit defaults, CSRF origin normalization, and
  analytics defaults.

Acceptance checks:

- `grep` finds no production imports from `@/lib/config`.
- Runtime readiness reports remain stable for fully configured, partially
  configured, and local/test environments.
- Optional AI, Speech, Push, OAuth, storage, tracing, and analytics providers
  still degrade gracefully.

Suggested issue split:

1. Extract shared env helper primitives.
2. Move feature config modules one domain at a time.
3. Migrate imports and delete the old facade.
4. Update docs and validation tests.

### REF-003 — Extract reader article API access and AI route guard

Priority: P0. Area: API/security/reuse.

Problem: Reader routes repeatedly build `articleAccessContext(session.user)`,
call `getReadableArticleById`, throw the same 404, and then apply AI rate
limits. The same pattern appears in translation, vocabulary, quiz, speech,
tags, grammar, tutor, pronunciation attempt, highlights, progress, offline, and
reading-time routes. The security regression tests already table-drive many of
these cases, which shows the invariant is cross-cutting.

Best strategy: create a small reader-route subsystem that composes with
`createHandler` and centralizes readable-article lookup plus optional AI
rate-limit enforcement.

Detailed requirements:

- Provide helpers such as `requireReadableArticle`, `withReadableArticle`, or a
  `createReaderArticleHandler` wrapper that returns the article and access
  context to route business logic.
- For AI routes, enforce the required order: validate params/body, check article
  readability, then consume the user-keyed AI rate limit, then call AI work.
  This preserves the current IDOR protection and avoids spending rate-limit
  quota on denied private article IDs.
- Preserve the uniform 404 response for non-viewable and missing articles.
- Keep explicit route-level validation schemas; do not hide request validation
  inside the access helper.
- Avoid broad helpers that know about every AI feature. The helper should own
  access/rate-limit invariants only.
- Update route tests to assert the shared helper behavior once, and keep
  representative per-route tests for feature-specific body/query behavior.

Acceptance checks:

- Reader AI route files no longer duplicate article access and rate-limit
  boilerplate.
- `tests/security-regressions.test.ts` continues to prove that AI work is not
  invoked for non-viewable article IDs and that AI rate limits are user-keyed.
- Route handlers still use the shared API handler wrappers.

Suggested issue split:

1. Add reader-route helper and tests.
2. Migrate low-risk reader routes.
3. Migrate AI routes and security regression cases.
4. Remove route-local `requireViewable` duplicates.

### REF-004 — Split `WordLookup` into reader interaction subsystems

Priority: P1. Area: reader UI/annotations.

Problem: `src/components/WordLookup.tsx` owns too many responsibilities in one
client component: raw DOM word detection, selection anchoring, dictionary
lookup, save/unsave vocabulary, highlight mark rendering, highlight editing,
sentence translation, grammar explanation, TTS prose highlighting, popover
positioning, focus handling, outside-click handling, and the sanitized HTML
render surface.

Best strategy: split into a reader interaction subsystem with a small container
component and focused hooks/components. Use a reducer or explicit surface state
controller so only one surface can be open at a time.

Detailed requirements:

- Keep the sanitized HTML contract intact: `WordLookup` must never render stored
  article HTML that has not already passed through `sanitizeArticleHtml`.
- Preserve the stable `dangerouslySetInnerHTML` object behavior so React does
  not wipe highlight `<mark>` nodes during unrelated state updates.
- Extract pure DOM/selection helpers (`wordAtPoint`, context-sentence
  extraction, selection normalization) into a testable module.
- Extract dictionary popover and vocabulary save/unsave client logic from the
  surface controller.
- Extract highlight selection actions (`highlight`, `add note`, overlap merge)
  from toolbar rendering.
- Preserve focus restoration, Escape handling, outside-click behavior, and
  screen-reader labels across all surfaces.
- Preserve TTS word highlighting and highlight mark rendering interaction; one
  should not erase the other's DOM annotations.

Acceptance checks:

- `WordLookup.tsx` becomes a thin orchestrator that wires a prose surface,
  surface controller, and popover components.
- Pure helpers have focused tests where possible.
- Existing annotation, dictionary, translation, grammar, and TTS reader flows
  remain behaviorally unchanged.

Suggested issue split:

1. Extract selection/context helpers and tests.
2. Extract dictionary popover + save-word hook.
3. Extract highlight toolbar action hook.
4. Introduce a surface reducer and simplify the container.

### REF-005 — Split pronunciation practice into state machine and UI parts

Priority: P1. Area: reader speech/pronunciation UI.

Problem: `src/components/ArticlePronunciation.tsx` is 1,002 lines. It already
uses several hooks, but still combines the pronunciation state machine,
sentence navigation, token fetch, mic lifecycle, TTS range playback, persistence,
history display, scoring UI, error panels, privacy copy, and detailed JSX.

Best strategy: make pronunciation a feature folder with a state-machine hook and
small presentational components.

Detailed requirements:

- Extract state transitions into a hook such as `usePronunciationSession` or a
  reducer. The hook should own phases, token refresh, recording start/stop,
  processing, persistence, and cleanup.
- Extract presentational components: `SentenceStepper`, `SentenceCard`,
  `RecordingPanel`, `PronunciationResult`, `ErrorNotice`, `ScoreRing`,
  `SubScoreBars`, `WordsToWorkOn`, and `PronunciationLegend`.
- Keep the Azure Speech SDK SSR-safe: never import the SDK at module scope.
- Preserve cleanup on unmount and when the Speak tab becomes inactive: stop mic
  meter, cancel timers, stop playback, and close the recognizer.
- Preserve the “jump to current reading paragraph once per activation” behavior.
- Preserve privacy wording: recordings are streamed to Azure and not stored by
  ReadWise; only numeric scores are saved.
- Coordinate with REF-001 so pronunciation-specific CSS moves out of
  `globals.css` without changing class semantics first.

Acceptance checks:

- Main component is a small feature orchestrator.
- Existing pronunciation tests and manual flows still pass: unavailable speech,
  mic denied, no device, transient error, record/stop, result, history, and
  “Hear it”.
- No module-level browser-only or Azure SDK imports are introduced.

Suggested issue split:

1. Extract presentational result/recording components.
2. Extract pronunciation session state hook.
3. Move styles into the pronunciation style subsystem.

### REF-006 — Refactor flashcard review into SRS session components

Priority: P1. Area: study/SRS UI.

Problem: `src/components/FlashcardReview.tsx` is 956 lines and mixes session
fetching, SRS grading, optimistic advancement, flashcard rendering, cloze
rendering, browser SpeechSynthesis, keyboard shortcuts, focus management,
screen-reader announcements, completion summary, and grade buttons.

Best strategy: split SRS session behavior from card-mode rendering. Use a
reducer-backed hook for session state and separate components for flashcard,
cloze, controls, and summary.

Detailed requirements:

- Extract a `useReviewSession` hook/reducer that owns phases, fetching, current
  index, grade counts, optimistic grade submission, and due-count updates.
- Extract `useSpeechSynthesisWord` for browser speech availability, active word,
  cancellation, and cleanup.
- Extract components for `ReviewStartCard`, `FlashcardFace`, `ClozeCard`,
  `GradeButtons`, `ReviewProgress`, and `ReviewComplete`.
- Preserve keyboard behavior: Space/Enter reveals/submits, `1`-`4` grade,
  Escape ends session, and focus moves into active controls.
- Preserve cloze privacy: pronunciation must not reveal a masked answer until
  the user submits.
- Preserve current network behavior: grading failures should not block
  optimistic session advancement.

Acceptance checks:

- Feature logic can be tested without rendering the whole card UI.
- Keyboard and screen-reader behavior remain intact.
- Flashcard and cloze modes share grade controls and session state rather than
  duplicating behavior.

Suggested issue split:

1. Extract reducer/hook with tests for session transitions.
2. Extract card-mode components.
3. Extract speech and keyboard/focus helpers.

### REF-007 — Remove duplicated reading-list CRUD UI logic

Priority: P1. Area: lists UI/reuse.

Problem: `src/components/ListSwitcher.tsx` duplicates rename/delete state and
fetch logic between `ListRow` and `MobileListManager`, and duplicates create
form rendering between desktop and mobile views. This increases the chance that
validation, errors, pending states, or router refresh behavior drift between
breakpoints.

Best strategy: extract shared reading-list mutation hooks and reusable form
components, then keep desktop/mobile layout differences as thin wrappers.

Detailed requirements:

- Extract `useReadingListMutations` or equivalent for create, rename, delete,
  pending state, and error mapping.
- Extract shared `ListCreateForm`, `ListRenameForm`, and `ListDeleteControl`
  components with breakpoint-specific layout props rather than duplicated
  business logic.
- Preserve client validation: non-empty names, max 60 characters, default list
  cannot be renamed or deleted.
- Preserve router behavior: deleting the active list redirects to `/lists`,
  other mutations refresh server data, and creating a list navigates to it.
- Keep accessible labels, Escape cancel behavior, and focus restoration.

Acceptance checks:

- Rename/delete/create network calls exist in one shared client path each.
- Desktop and mobile list management produce identical validation and errors.
- Default list protections remain visible and enforced server-side.

Suggested issue split:

1. Extract mutation hook and tests/mocks.
2. Extract shared create/rename/delete UI controls.
3. Simplify desktop and mobile switcher views.

### REF-008 — Modularize the durable job queue subsystem

Priority: P1. Area: background jobs/operations.

Problem: `src/lib/jobs.ts` combines retry policy, error classification,
payload types, enqueue/dedupe logic, PostgreSQL and generic claim algorithms,
stale-lock recovery, lifecycle transitions, admin/introspection helpers, and
private error-history helpers. It is stable but difficult to extend safely.

Best strategy: turn `jobs` into a feature subsystem under `src/lib/jobs/` with
explicit modules and a small public barrel after callers are migrated.

Detailed requirements:

- Split stable modules along domain seams:
  - `types.ts` for exported payloads/status groups.
  - `retry-policy.ts` for policies and backoff.
  - `errors.ts` for `JobError` and classification.
  - `enqueue.ts` for enqueue and dedupe behavior.
  - `claim.ts`, `claim-postgres.ts`, and `claim-generic.ts` for locking.
  - `lifecycle.ts` for start, heartbeat, complete, fail, retry, cancel, archive.
  - `queries.ts` for list/get/count helpers.
- Preserve PostgreSQL `FOR UPDATE SKIP LOCKED` semantics exactly.
- Preserve SQLite/test generic claim behavior and stale-lock recovery.
- Avoid circular imports with `src/lib/worker.ts` and `src/lib/admin-jobs.ts`.
- Keep metrics/logging calls in the same lifecycle moments.
- Migrate imports before deleting the old `src/lib/jobs.ts` compatibility file.

Acceptance checks:

- Job tests for claiming, stale lock recovery, dead-lettering, retry, and admin
  actions continue to pass.
- Public job APIs remain discoverable through the new subsystem index.
- The old monolithic file is removed by the end of the epic.

Suggested issue split:

1. Extract retry/error/payload modules.
2. Extract enqueue and lifecycle modules.
3. Extract claim adapters and preserve concurrency tests.
4. Migrate imports and delete the old file.

### REF-009 — Remove legacy compatibility paths after data migration proof

Priority: P1. Area: cleanup/schema/scripts.

Problem: Several compatibility paths remain after earlier migrations and naming
changes. They reduce readability and keep old data shapes alive indefinitely.
Examples include JSON-string fallbacks for `Profile.topics` and quiz options,
the `htmlToPlainText` alias for `articleHtmlToReaderText`, the worker `--jobs`
no-op, the `ArticleSpeech.audioBase64` fallback, legacy CSS token aliases, and
the historical `searchPublishedArticles` name.

Best strategy: run a compatibility-deletion epic with explicit proof steps.
Delete only after data and callers have been migrated, and remove tests that
assert obsolete behavior in the same issue.

Detailed requirements:

- For JSON fields:
  - Confirm all deployed rows store `Profile.topics` and `QuizQuestion.options`
    as native JSON arrays in SQLite and PostgreSQL.
  - Add or run a one-time migration/backfill if old string rows can exist.
  - Delete JSON-string parsing fallbacks in `parseTopics` and
    `parseStoredOptions`.
  - Remove tests that require legacy string rows.
- For reader text naming:
  - Replace all `htmlToPlainText` imports/calls with
    `articleHtmlToReaderText`.
  - Delete the alias and update comments that refer to the old name.
- For worker CLI:
  - Remove the `--jobs` no-op flag from parser and help text.
  - Update docs/scripts that mention it.
- For speech media:
  - Decide whether object storage is mandatory in production. If yes, provide a
    migration that moves `audioBase64` rows into storage and records
    `storageKey`/`mediaAssetId`.
  - Remove `audioBase64` schema field and base64 route/runtime fallbacks only
    after migration and rollback guidance exist.
  - Keep local/test graceful behavior if storage is intentionally optional; if
    so, document why this fallback is not yet removable.
- For CSS aliases:
  - Replace legacy aliases such as `--panel`, `--muted`, and legacy `--accent`
    usages with semantic tokens.
  - Remove alias definitions once no selectors reference them.
- For search naming:
  - Rename `searchPublishedArticles` to a name that matches current visibility
    semantics, such as `searchReadableArticles`.
  - Migrate `/api/search` and tests, then delete the old export.

Acceptance checks:

- No production code paths parse legacy JSON strings or expose old text/search
  names.
- Removed compatibility behavior has either a data migration, a documented
  non-removal decision, or a rollback-safe deletion plan.
- Schema changes keep SQLite and PostgreSQL intent aligned.

Suggested issue split:

1. Remove low-risk naming compatibility (`htmlToPlainText`, search function).
2. Remove worker CLI no-op.
3. Backfill and remove JSON string compatibility.
4. Plan and execute speech media fallback removal.
5. Remove CSS token aliases after REF-001.

### REF-010 — Split recommendation scoring from data loading and cached picks

Priority: P2. Area: personalization/recommendations.

Problem: `src/lib/recommendations.ts` mixes pure scoring formulas, explanation
generation, diversity ranking, user context data loading, cached public pick
loading, and paginated response shaping. This makes scoring changes riskier
because DB/caching behavior sits next to pure math.

Best strategy: create a recommendation subsystem that separates pure scoring
from persistence/caching.

Detailed requirements:

- Move pure scoring functions and weights into `recommendations/scoring.ts`.
- Move explanation/headline generation into `recommendations/explanations.ts`.
- Move diversity ranking into `recommendations/diversity.ts`.
- Move DB context loading into `recommendations/context.ts`.
- Move cached public pick loading and pagination into
  `recommendations/picks.ts`.
- Keep exported types stable while callers migrate, then delete the old flat
  module if possible.
- Preserve deterministic unit tests for each score component and ranked output.
- Preserve cache keys and `maxLevel`/topics contract until a separate product
  change intentionally revises them.

Acceptance checks:

- Pure scoring tests do not import Prisma.
- DB/cached listing tests cover only data loading and pagination.
- Recommendation explanations remain stable for existing cases.

Suggested issue split:

1. Extract pure scoring and tests.
2. Extract ranking/explanations.
3. Extract context and picks data modules.

### REF-011 — Break onboarding wizard into steps, state, and placement logic

Priority: P2. Area: onboarding UI/product flow.

Problem: `src/app/onboarding/OnboardingForm.tsx` is 741 lines and includes step
components, placement scoring, topic selection, demographic fields, review UI,
navigation, validation, submit behavior, and router side effects.

Best strategy: split the wizard into a feature folder with step components and a
small state hook.

Detailed requirements:

- Move each step (`level`, `placement`, `topics`, `about`, `review`) into a
  focused component.
- Extract placement scoring and suggestion logic into a pure module with tests.
- Extract wizard state/navigation into `useOnboardingWizard`.
- Keep submit payload shape and `/api/onboarding` behavior unchanged.
- Preserve keyboard/focus behavior between steps and existing copy.

Acceptance checks:

- Main form becomes an orchestrator for step rendering and submit.
- Placement scoring can be tested without rendering React.
- Existing onboarding behavior and defaults remain unchanged.

Suggested issue split:

1. Extract pure placement scoring.
2. Extract step components.
3. Extract wizard state hook and simplify submit path.

### REF-012 — Split command palette state, search, and rendering

Priority: P2. Area: shell/search UI.

Problem: `src/components/command/CommandPalette.tsx` is 719 lines and mixes
item derivation, fuzzy filtering, article search, keyboard navigation, focus
trap, scroll management, route activation, live-region announcements, and
desktop/mobile dialog rendering.

Best strategy: extract command palette model/state helpers while keeping the UI
behavior stable.

Detailed requirements:

- Extract item derivation and grouping into a pure module.
- Extract keyboard navigation and active-index management into a hook.
- Extract focus trap/body scroll lock into reusable dialog helpers if no shared
  helper already exists.
- Keep article search hook separate from page/action filtering.
- Preserve ARIA combobox/listbox semantics, active descendant IDs, live-region
  announcements, and opener focus restoration.
- Preserve reader referrer behavior when opening an article from search.

Acceptance checks:

- Command item filtering can be tested without mounting the full palette.
- Keyboard navigation tests cover wraparound, Home/End, Enter, Escape, and Tab.
- Visual/mobile behavior remains unchanged.

Suggested issue split:

1. Extract item model/grouping.
2. Extract keyboard/focus hooks.
3. Split render sections into smaller components.

### REF-013 — Modularize PostgreSQL integration test support

Priority: P2. Area: tests/database.

Problem: `tests/db/postgres.test.ts` is 1,280 lines. It contains migration SQL
parsing/application helpers, cleanup helpers, query-plan inspection helpers,
fixture seeding, baseline migration tests, privacy tests, cascade tests, full
text search tests, worker/job tests, and index-plan tests in one file.

Best strategy: create a PostgreSQL integration test support package and split
the test file by domain.

Detailed requirements:

- Move shared helpers into `tests/support/postgres/`:
  migration loading, SQL splitting, cleanup, explain-plan helpers, index
  assertions, and common fixture builders.
- Split tests into focused files such as `postgres-migrations.test.ts`,
  `postgres-privacy.test.ts`, `postgres-search.test.ts`, and
  `postgres-jobs.test.ts`.
- Preserve `RUN_DB_INTEGRATION=1` and PostgreSQL URL guards so tests never run
  accidentally against the wrong database.
- Preserve the current cleanup prefix strategy and after/afterEach cleanup.
- Keep query-plan tests explicit about documented index names.

Acceptance checks:

- Each PostgreSQL integration test file can be understood independently.
- Shared helpers are reused without hidden global state.
- Existing `npm run test:db` behavior remains unchanged.

Suggested issue split:

1. Extract support helpers without changing tests.
2. Split migration/privacy/search/job test groups.
3. Tighten fixture builders and remove duplicated SQL setup.

### REF-014 — Migrate client components to a shared API/mutation layer

Priority: P0. Area: client data access/reuse.

Problem: `src/lib/client-fetch.ts` already standardizes timeout, JSON parsing,
and `ApiResponseError`, but only a small number of components use it. Many
client components still hand-roll `fetch`, `Content-Type`, `res.ok` checks,
`res.json().catch`, busy/error state, optimistic rollback, and router refresh.
This creates inconsistent timeout behavior and uneven user-facing errors.

Best strategy: make a reusable client API/mutation subsystem and migrate raw
JSON call sites incrementally. Keep browser-only utilities separate from server
code.

Detailed requirements:

- Extend `src/lib/client-fetch.ts` with the missing primitives needed by current
  callers: `putJson`, `patchJson`, `deleteJson`, bodyless requests, optional
  `keepalive`, and a typed `requestJson` base.
- Preserve privacy: never log request bodies, article text, selected text,
  prompts, credentials, or private user content in client helper errors.
- Add a small mutation helper/hook for the repeated pattern: set busy, clear
  error, call API, map `ApiResponseError`, reset form, then `router.refresh` or
  navigate.
- Migrate repeated form/action call sites first: teacher forms,
  admin action buttons, list management, push preferences, vocabulary actions,
  bookmark toggles, and reader AI panels.
- Do not force offline mutations through this helper when they require
  idempotency headers and queue semantics; integrate only through a deliberate
  adapter if needed.
- Keep abort semantics for search/autocomplete call sites that already use
  `AbortController`.

Acceptance checks:

- Raw JSON `fetch` call sites drop significantly and remaining ones are
  documented exceptions: beacons, offline queue/idempotency, streaming/binary,
  service-worker integration, or non-JSON responses.
- Components show consistent server `{ error }` messages.
- No component loses timeout/abort behavior during migration.

Suggested issue split:

1. Fill gaps in `client-fetch.ts` and add tests.
2. Add a reusable client mutation hook/form helper.
3. Migrate teacher/admin/list/vocabulary/bookmark call sites.
4. Migrate reader AI panels and document intentional exceptions.

### REF-015 — Centralize client error reporting and error-page UI

Priority: P1. Area: client observability/UI reuse.

Problem: Multiple client error boundaries and error pages each build and POST
their own `/api/client-errors` payload. The payload shape, URL privacy handling,
user agent inclusion, `sendBeacon` vs `fetch`, and fallback UI buttons are
similar but not shared.

Evidence includes `src/components/ClientErrorReporter.tsx`,
`src/components/ReaderPanelErrorBoundary.tsx`, `src/app/global-error.tsx`,
`src/app/(app)/error.tsx`, `src/app/admin/error.tsx`, and page-specific
`error.tsx` files for browse, lists, notes, progress, reader, and settings-like
flows.

Best strategy: extract a client-safe error reporting module plus reusable error
screen components. Keep the route sink and backend scrubbing behavior unchanged.

Detailed requirements:

- Add a client-only helper such as `reportClientError(input)` that owns:
  payload truncation, source labels, stack/digest fields, query/hash stripping,
  `sendBeacon` preference, `keepalive` fallback, dedupe/throttle where needed,
  and never-throw behavior.
- Keep `/api/client-errors` as the server sink; preserve IP rate limiting,
  scrubbing, and `captureError` aggregation.
- Replace repeated POST logic in global reporter, route error pages, and reader
  panel boundaries with the shared helper.
- Extract shared error UI primitives: icon panel, title/description, digest,
  Try again button, Back to dashboard link, and compact panel fallback.
- Allow page-specific copy and icons without duplicating reporting code.
- Ensure client-reported URLs never include query strings or hashes.

Acceptance checks:

- All client error reports pass through one helper except documented special
  cases.
- Error pages remain client components where Next.js requires them.
- Existing client error route tests continue to pass.

Suggested issue split:

1. Extract `reportClientError` and migrate reporters.
2. Extract shared error screen/panel UI.
3. Remove duplicated POST payload construction from error pages.

### REF-016 — Package scraper providers, discovery, extraction, and governance

Priority: P1. Area: content ingestion/scrapers.

Problem: The scraper system has several mature pieces, but the boundaries are
not yet explicit enough for adding providers safely. `providers.ts` is a
579-line registry with provider data, regex filters, category mapping,
provider-specific extractors, and cleanup rules. `extract.ts` owns fetch limits,
SSRF-safe reads, metadata parsing, JSON-LD parsing, body extraction, sanitizing,
and article shaping. `index.ts` owns scrape/save/discovery orchestration.
`content-sources.ts` owns provider health and enablement. Together they form a
subsystem but are still organized as flat files.

Best strategy: create a `src/lib/scraper/` package with registry, discovery,
fetching, extraction, persistence, and governance modules. Move provider
definitions toward data/adapter files by provider.

Detailed requirements:

- Split provider registry into provider-specific modules or declarative manifest
  files grouped under `src/lib/scraper/providers/`.
- Keep provider definitions code-governed; do not move untrusted provider logic
  into runtime DB fields.
- Extract shared category mapping and URL filtering helpers so provider modules
  do not duplicate regex plumbing.
- Keep SSRF and robots checks mandatory for every seed/extractor candidate.
- Split extraction into layers: fetch/read limits, metadata/JSON-LD parsing,
  body extraction/cleanup, sanitization, and `ScrapedArticle` shaping.
- Keep `sanitizeArticleHtml` as the authoritative final safety pass.
- Keep persistence/audit/de-duplication separate from network discovery so tests
  can run with fixtures and no DB/network.
- Make provider health recording in `content-sources.ts` consume a stable
  crawl-result interface instead of reaching across scraper internals.

Acceptance checks:

- Adding a provider requires a focused provider module plus tests, not editing a
  giant registry block.
- Existing scraper tests for RSS, GraphQL, seed HTML fallback, SSRF, robots,
  cleanup, pagination, quality, and provider health continue to pass.
- No provider can bypass hostname, article pattern, optional filter, or robots
  validation.

Suggested issue split:

1. Extract provider category/filter helpers and provider modules.
2. Split extraction pipeline into parse/clean/shape modules.
3. Split discovery/persistence/governance adapters.
4. Update scraper docs with provider addition rules.

### REF-017 — Consolidate feed and recommendation ranking engines

Priority: P1. Area: personalization/discovery.

Problem: `src/lib/feed.ts` has its own heuristic scoring weights,
level-proximity score, freshness score, diversity pass, profile/progress/tag
context loading, in-process cache, and page shaping. `src/lib/recommendations.ts`
has another recommendation engine with similar concepts. This duplication makes
future ranking changes hard to reason about and can make the dashboard feed,
For You rail, and scored picks diverge unexpectedly.

Best strategy: create one discovery-ranking subsystem with reusable pure score
components, context loaders, and page builders. Keep product-specific tuning as
configuration, not copy-pasted algorithms.

Detailed requirements:

- Define shared concepts: candidate article projection, learner context,
  score components, diversity policy, reasons/explanations, and pagination.
- Reuse pure scoring components where the signals overlap: CEFR proximity,
  topic/tag match, freshness, progress/completion, mastery gaps, and word load.
- Allow separate weight profiles for feed vs scored picks when product behavior
  intentionally differs.
- Move cache behavior into a shared listing/discovery cache adapter with clear
  invalidation rules.
- Preserve no-profile fallback behavior in `getPersonalizedFeed`.
- Preserve completed-article exclusion and in-progress soft penalty semantics
  unless a product issue changes them.
- Keep pure scoring tests independent of Prisma.

Acceptance checks:

- Feed and recommendations import shared ranking primitives instead of owning
  separate scoring copies.
- Existing feed and recommendation tests pass with stable output.
- Differences between feed and scored picks are explicit weight/policy choices.

Suggested issue split:

1. Extract shared ranking primitives from feed/recommendations.
2. Introduce weight profiles and product-specific page builders.
3. Migrate feed, then scored picks, preserving tests after each step.

### REF-018 — Split metrics registry, recorders, and Prometheus exporter

Priority: P1. Area: observability.

Problem: `src/lib/metrics.ts` is a 498-line in-process metrics module that owns
label normalization, low-cardinality route grouping, counter/histogram storage,
API/worker/AI/cache/content/security/job recorders, snapshot generation,
Prometheus rendering, and test reset. As metrics grow, unrelated domains must
edit one file and risk cardinality mistakes.

Best strategy: keep one in-process registry, but split domain recorders and
exporters into an observability metrics package.

Detailed requirements:

- Extract core registry primitives: normalized labels, series keys, counters,
  histograms, snapshots, and reset.
- Extract route normalization (`routeGroupFromPath`) with focused tests for
  dynamic API segments and cardinality caps.
- Move domain recorders into modules: `api`, `worker`, `ai`, `cache`,
  `content`, `security`, and `jobs`.
- Move Prometheus rendering into an exporter module with escaping tests.
- Preserve the hard rule that user ids, request ids, raw article ids, full paths,
  prompts, selected text, IPs, and private content never become metric labels.
- Keep current metric names stable unless a migration note is added for
  dashboards/alerts.

Acceptance checks:

- Metric snapshots and Prometheus output remain byte-for-byte stable for
  representative fixtures, except intentional ordering already normalized.
- Tests cover route grouping, label normalization, histogram bucket counts, and
  Prometheus escaping.
- Adding a new domain metric no longer requires editing the registry internals.

Suggested issue split:

1. Extract registry and exporter without changing public recorders.
2. Move route grouping and add tests.
3. Move domain recorders behind a barrel export.

### REF-019 — Split analytics queries into segments, overview, retention, and loaders

Priority: P2. Area: analytics/admin dashboards.

Problem: `src/lib/analytics-queries.ts` combines time-range parsing, funnel
metadata, feature labels, overview computation, retention cohort computation,
segment resolution through `Profile`, query `where` construction, Prisma
loaders, and admin-facing result shapes. The pure functions are already
separated inside the file, but not as modules.

Best strategy: promote the existing internal sections into an analytics query
subsystem with pure computation modules and repository modules.

Detailed requirements:

- Move time range presets/resolution into `analytics/queries/range.ts`.
- Move segment types and `resolveSegmentUserIds` into
  `analytics/queries/segments.ts`.
- Move funnel/overview constants and `computeOverview` into
  `analytics/queries/overview.ts`.
- Move cohort types and `computeRetentionCohorts` into
  `analytics/queries/retention.ts`.
- Move Prisma loaders into `analytics/queries/repository.ts` or separate loader
  modules.
- Keep topic filtering behavior explicit: currently topic segments parse JSON
  in TypeScript for portability.
- Ensure exported dashboard API shapes remain stable.

Acceptance checks:

- Pure overview/retention tests import no Prisma.
- Loader tests can mock Prisma or a small client interface.
- Admin analytics route/page tests continue to pass.

Suggested issue split:

1. Extract pure range/overview/retention modules.
2. Extract segment resolver and DB loaders.
3. Migrate admin analytics imports and delete the flat module.

### REF-020 — Modularize server-side speech synthesis and timing alignment

Priority: P1. Area: speech/media pipeline.

Problem: `src/lib/speech.ts` combines stored timing validation, Azure Speech SDK
setup, output-format mapping, synthesis timeout handling, word-boundary capture,
fallback responses, cache lookup, corrupt-cache recovery, object-storage writes,
media-asset upserts, base64 fallback, and article access. `src/lib/speech-timing.ts`
is a 431-line algorithm module that also owns tokenization regexes and timing
helpers.

Best strategy: split server speech into provider, repository, storage, and
timing submodules while keeping UI pronunciation work separate.

Detailed requirements:

- Extract Azure provider code into `speech/provider-azure.ts`; it should be the
  only module importing `microsoft-cognitiveservices-speech-sdk`.
- Extract output format mapping and speech config resolution into a small
  provider config module.
- Extract `ArticleSpeech` cache read/write, corrupt-row handling, and media
  asset upsert into a repository/storage adapter.
- Keep object storage behind `getMediaStorage`; do not let callers handle raw
  storage keys directly.
- Move `parseStoredSpeechWords` into timing/validation or repository code with
  tests for malformed JSON.
- Split `speech-timing.ts` into tokenization/comparable-key helpers and the
  banded alignment algorithm if it improves readability; keep public functions
  stable.
- Coordinate with REF-009 before deleting `audioBase64`; this issue can improve
  boundaries without removing data fallbacks.

Acceptance checks:

- Existing speech, pronunciation, speech-alignment, and storage tests pass.
- No browser/client bundle imports Azure Speech SDK accidentally.
- Cached speech, corrupt timing regeneration, storage-backed audio, and base64
  fallback behavior remain unchanged until a dedicated deletion issue changes
  them.

Suggested issue split:

1. Extract Azure synthesis provider and output-format tests.
2. Extract speech repository/storage adapter.
3. Split timing tokenization/alignment helpers and preserve alignment tests.

### REF-021 — Split offline storage and mutation queue adapters

Priority: P1. Area: offline/PWA.

Problem: `src/lib/offline-db.ts` owns IndexedDB database opening/upgrades,
offline article CRUD, article expiry/eviction, mutation queue persistence,
dedupe replacement, queue updates, queue clearing, and full privacy purge.
`offline-mutations.ts` owns browser connectivity, state pub/sub, send-or-enqueue,
background sync, queue flushing, and service-worker cache purge. `offline-sync.ts`
is already a pure engine, but the browser adapters are still broad.

Best strategy: make offline a feature package with separate stores, queue
repository, browser lifecycle adapter, and mutation endpoint registry.

Detailed requirements:

- Extract IndexedDB open/upgrade/transaction helpers into `offline/idb.ts` with
  versioned migration tests where possible.
- Move article cache operations into `offline/article-store.ts`.
- Move queued mutation persistence into `offline/mutation-store.ts`.
- Keep pure retry/order/classification in `offline-sync.ts` or move under the
  package barrel unchanged.
- Extract sync-state pub/sub and browser listeners into `offline/sync-runtime.ts`.
- Define allowed offline mutation types/endpoints in one registry so queued
  mutations are auditable and future routes cannot silently bypass idempotency.
- Preserve privacy purge across articles, queued mutations, and service-worker
  caches.

Acceptance checks:

- Existing offline sync, cache version, highlights/notes/progress offline tests
  continue to pass.
- IndexedDB unavailable paths still degrade safely.
- Sign-out/account deletion still purge all offline private content best-effort.

Suggested issue split:

1. Extract IndexedDB helpers and article/mutation stores.
2. Extract sync runtime/browser lifecycle.
3. Add an offline mutation registry and migrate callers.

### REF-022 — Split tutor chat UI, provider state, and safe markdown rendering

Priority: P2. Area: reader AI tutor.

Problem: `src/components/ArticleTutor.tsx` is 564 lines and owns safe markdown
rendering, relative time formatting, message row rendering, thinking/fallback
states, scroll-to-bottom logic, composer auto-grow, keyboard submit,
conversation clearing, starter chips, and accessibility announcements.
`ReaderTutorProvider.tsx` separately hand-rolls GET/POST/DELETE fetch state and
transient message handling.

Best strategy: create a tutor feature folder with a provider hook, safe renderer,
scroll/composer hooks, and presentational message components.

Detailed requirements:

- Move safe tutor markdown rendering into a dedicated renderer module that
  remains text-only and never uses `dangerouslySetInnerHTML`.
- Extract relative-time formatting into a shared/date helper if other chat-like
  UI needs it.
- Extract `useTutorConversation` for loading, ask, transient user/thinking/error
  states, fallback handling, and clear.
- Use the shared client fetch/error helper from REF-014 once available.
- Extract `useAutoScrollLog` and `useAutoGrowingTextarea` hooks for the UI.
- Preserve privacy rule: only the current paragraph context may be sent with a
  tutor question, capped server-side; no reading history or private user data.
- Preserve role="log", live-region announcements, retry behavior, clear
  confirmation, and keyboard submit semantics.

Acceptance checks:

- Tutor markdown tests continue to prove output is React text nodes only.
- Tutor route/provider tests continue to pass.
- Manual smoke: load conversation, ask, fallback, retry error, clear, scroll
  jump, keyboard submit, mobile keyboard focus.

Suggested issue split:

1. Extract safe renderer and message components.
2. Extract conversation provider hook using shared client fetch.
3. Extract scroll/composer hooks and simplify `ArticleTutor.tsx`.

### REF-023 — Modularize AI eval harness by feature evaluator and runner

Priority: P2. Area: AI quality/evals.

Problem: `src/lib/ai/eval.ts` is 475 lines and contains all feature evaluator
definitions, property-check helper functions, live model calling, dataset
loading, report aggregation, prompt-version collection, and failure extraction.
Adding a new AI feature or property check requires editing the same file that
owns the runner.

Best strategy: split the eval harness into evaluator registry, feature-specific
evaluators, runner, datasets loader, and report utilities.

Detailed requirements:

- Move generic result/dataset/report types into `ai/evals/types.ts`.
- Move shared property helpers (`pass`, `containsHtml`, paragraph counting,
  string/number coercion) into `ai/evals/assertions.ts`.
- Move each feature evaluator into `ai/evals/evaluators/<feature>.ts`.
- Keep a central registry that maps feature keys to evaluators and rejects
  datasets with unknown features.
- Move live-model caller wiring into `ai/evals/live-runner.ts`; offline mode
  must not import provider stacks or require secrets.
- Move dataset path/loading into `ai/evals/datasets.ts`.
- Keep report shape stable for CI and docs.

Acceptance checks:

- `npm run eval` offline output remains compatible with existing consumers.
- AI eval tests cover unknown features, missing `modelOutput`, live caller
  injection, and failure collection.
- Adding a new evaluator does not require touching the runner logic.

Suggested issue split:

1. Extract shared eval types/assertions/dataset loader.
2. Move feature evaluators into registry modules.
3. Extract runner/report utilities and preserve CLI output.

### REF-024 — Split tenant/classroom services and reuse teacher form mutations

Priority: P2. Area: multi-tenancy/teacher workflows.

Problem: `src/lib/org.ts` and `src/lib/classroom.ts` are broad domain modules.
They mix capability helpers, session guards, reads, writes, last-admin rules,
classroom roster management, assignments, student-facing reads, and raw progress
matrix loading. Teacher forms repeat the same client mutation pattern for create
org, create classroom, add student, and assign article.

Best strategy: split tenant and classroom services into authorization, commands,
queries, and read-model modules; pair that with reusable teacher form mutation
helpers from REF-014.

Detailed requirements:

- Split `org.ts` into slug helpers, capability/session guards, membership
  commands, membership queries, and organization commands/queries.
- Split `classroom.ts` into authorization helpers, classroom commands, roster
  commands/queries, assignment commands/queries, student assignment reads, and
  progress read models.
- Keep last OrgAdmin protections in command modules with dedicated tests.
- Keep system-admin vs tenant-role semantics explicit; an OrgAdmin must not
  become a global Admin by accident.
- Extract teacher form primitives for busy/error/reset/refresh behavior and
  field validation, reusing the shared client API layer.
- Preserve server-side authorization; hidden UI and client validation are not
  security boundaries.

Acceptance checks:

- Existing org, classroom, tenant analytics, RBAC, and assignment route tests
  continue to pass.
- Teacher forms have one shared mutation/error path instead of per-form fetch
  boilerplate.
- Public exports make it clear whether a function is a command, query, guard,
  or read-model builder.

Suggested issue split:

1. Split org service modules and migrate imports.
2. Split classroom service modules and migrate imports.
3. Extract teacher form mutation helpers and migrate forms.

### REF-025 — Define an article processing and rebuild subsystem

Priority: P1. Area: content processing/jobs/admin operations.

Problem: Article enrichment spans `src/lib/processor.ts`,
`src/lib/processing-state.ts`, `src/lib/backfill.ts`, `src/lib/admin-ai-ops.ts`,
job queue helpers, worker scripts, and admin UI. Each file is understandable in
isolation, but the subsystem boundary is implicit. Processing step names,
feature keys, translation step keys, rebuild cache clearing, job payloads,
operator summaries, and admin dashboards can drift.

Best strategy: create a first-class `content-processing` subsystem that owns
feature definitions, step state, processing orchestration, rebuild/backfill
planning, and operator read models.

Detailed requirements:

- Define one canonical feature/step registry that maps feature key → processing
  step key, cache clear operation, job payload shape, display label, and whether
  the feature supports translation languages or TTS.
- Refactor `processArticle` so it iterates over registered steps instead of
  hard-coding each enrichment block inline.
- Keep per-step durable state writes (`beginStep`, `finishStep`) best-effort and
  preserve current statuses: generated, skipped, fallback, failed/running.
- Move rebuild/backfill plan construction to use the same registry as the
  processor, so clearing caches and enqueuing jobs cannot disagree with normal
  processing.
- Keep background AI context and budget semantics unchanged: enrichment uses
  background quotas and skips gracefully when budgets are exhausted.
- Keep user-owned study data safe during rebuild: SavedWord, progress,
  highlights, notes, quiz attempts, and pronunciation attempts must not be
  cleared.
- Keep admin AI/content ops summaries as read models over the same step/job
  vocabulary.

Acceptance checks:

- Existing processor, backfill, admin jobs, admin AI ops, and PostgreSQL job
  tests pass.
- Adding a new enrichment feature requires adding a registry entry plus tests,
  not editing processor, backfill, admin summaries, and scripts separately.
- Rebuild dry-run and real-run plans match for the same inputs except for actual
  enqueue/clear side effects.

Suggested issue split:

1. Introduce processing feature/step registry and migrate constants.
2. Refactor `processArticle` to registry-driven steps.
3. Refactor backfill/rebuild planning and cache clearing to the same registry.
4. Align admin ops summaries and scripts with the registry.

### REF-026 — Split AI client orchestration from budgets, ledger, and usage summaries

Priority: P1. Area: AI platform/governance.

Problem: `src/lib/ai.ts` is the stable chat-completion entry point, but it also
coordinates provider lookup, retry/backoff, timeout signals, quota decisions,
ledger writes, metrics, tracing, logging, and response normalization. Nearby
modules (`ai-budget.ts`, `ai-ledger.ts`, `admin-ai-ops.ts`) also combine runtime
policy, storage, and reporting concerns. The result is a powerful but dense AI
platform layer.

Best strategy: keep `chatComplete` as the public facade, but split internal AI
platform concerns into focused modules and adapters.

Detailed requirements:

- Extract retry/timeout orchestration into an AI request runner that accepts a
  provider and normalized request options.
- Extract budget/quota preflight into a policy module that returns explicit
  decisions for interactive vs background work.
- Keep ledger writes metadata-only. Never persist prompts, article text,
  selected text, user-private content, credentials, or raw model output.
- Extract ledger recording/querying from usage summary read models.
- Move admin cost/latency/fallback summaries into read-model modules that depend
  on ledger summaries, not on chat runner internals.
- Preserve provider abstraction: Azure remains the default provider, but the
  orchestration layer should not import provider-specific code directly.
- Keep graceful fallback behavior: unconfigured provider returns null and records
  unconfigured metadata; background quota exhaustion skips rather than throwing;
  interactive quota exhaustion returns the current clean 429 path.

Acceptance checks:

- Existing AI provider, AI budget, AI ledger, admin AI ops, AI validation, and
  route tests pass.
- Public `chatComplete` and `chatCompleteWithMeta` signatures remain stable.
- A representative fixture proves ledger/metrics/tracing are emitted on success,
  empty/content-filter, unconfigured, aborted, retry, and terminal error paths.

Suggested issue split:

1. Extract AI request runner and retry policy.
2. Extract budget preflight adapter and ledger writer adapter.
3. Split ledger storage from usage/admin read models.
4. Keep `@/lib/ai` as the facade and migrate internals behind it.

### REF-027 — Split prompt registry into feature-owned prompt modules

Priority: P2. Area: AI prompts/maintainability.

Problem: `src/lib/ai/prompts.ts` is a single registry containing prompt message
types, model parameters, target counts, prompt variables, and every feature
template: translation, vocabulary, quiz, tags, difficulty, grammar, tutor, and
sentence translation. Any prompt edit touches the same file and can create merge
conflicts across unrelated AI features.

Best strategy: keep one prompt registry API, but move feature prompt templates
and variable types into feature-owned prompt modules.

Detailed requirements:

- Move generic prompt types and registry helpers into `ai/prompts/types.ts` and
  `ai/prompts/registry.ts`.
- Create feature prompt modules such as `translation.ts`, `vocabulary.ts`,
  `quiz.ts`, `tags.ts`, `difficulty.ts`, `grammar.ts`, `tutor.ts`, and
  `sentence-translation.ts`.
- Preserve current prompt versions and model parameter behavior.
- Keep `renderPrompt`, `activePromptVersion`, `promptModelParams`,
  `featuresWithStalePrompts`, and `PROMPT_FEATURES` public API stable during
  migration.
- Add a registry contract test that every prompt feature has a version, model
  params, render function, and eval dataset if applicable.
- Avoid moving prompts to runtime-editable storage unless a separate governance
  epic defines review, versioning, rollback, and safety controls.

Acceptance checks:

- Existing AI prompt/eval tests pass with unchanged rendered messages for
  representative fixtures.
- Prompt version lookups remain stable for AI cache keys and ledger metadata.
- Adding a new prompt feature requires a feature module and registry entry, not
  editing a large template file.

Suggested issue split:

1. Extract generic prompt registry/types.
2. Move feature templates into modules with snapshot/fixture tests.
3. Add registry contract tests and migrate imports.

### REF-028 — Consolidate learning mastery and study-plan signal modules

Priority: P2. Area: learning systems/mastery.

Problem: Learning signals are spread across `study-plan.ts`, `skill-mastery.ts`,
`word-mastery.ts`, `article-mastery.ts`, `quiz-mastery.ts`, `srs.ts`,
`flashcards.ts`, and `cloze.ts`. Several modules use similar score clamping,
thresholds, evidence summaries, confidence/familiarity concepts, and Prisma
read/write patterns, but there is no cohesive learning-signal subsystem.

Best strategy: create a `learning` or `mastery` subsystem with shared score
primitives, evidence types, repositories, and plan/read-model modules.

Detailed requirements:

- Keep pure scoring algorithms separate from Prisma repositories: SM-2,
  familiarity, confidence, comprehension, weak-area diagnosis, and plan building
  should be testable without DB mocks.
- Define shared value objects for bounded scores, evidence summaries, skill
  names, weak areas, and mastery thresholds.
- Move DB writes into repositories/commands: word exposure/review, skill
  evidence, article mastery update, quiz/pronunciation aggregates.
- Keep study-plan generation as a read model that gathers diagnostics and then
  calls pure diagnosis/plan functions.
- Avoid circular dependencies between recommendations, study plan, mastery, and
  leveling. Shared types should live in low-level modules.
- Keep learner privacy: mastery diagnostics should not log article text,
  selected text, user-private content, or detailed answer content.

Acceptance checks:

- Existing mastery, study-plan, flashcard, cloze, quiz mastery, word mastery,
  article mastery, and leveling tests pass.
- Pure algorithm modules import no Prisma.
- Thresholds used by UI and services are defined once or explicitly
  feature-scoped.

Suggested issue split:

1. Extract shared score/evidence primitives.
2. Move pure algorithms into a learning subsystem.
3. Move Prisma repositories/commands behind focused APIs.
4. Rebuild study-plan diagnostics as a read-model module.

### REF-029 — Extract reader page data loading and shell composition

Priority: P1. Area: reader architecture/server components.

Problem: `src/app/(app)/reader/[id]/page.tsx` is a 411-line server component
that handles metadata, auth/access, analytics event recording, related article
fallbacks, progress/bookmark/difficulty/tag/feedback fetching, sanitization,
plain-text conversion, JSON-LD, no-flash preference bootstrap scripts, provider
nesting, article header rendering, study CTA, related articles, and tools
surface composition.

Best strategy: split reader server work into data loader/read model, metadata,
structured data, preference bootstrap, and presentational shell components.

Detailed requirements:

- Extract `loadReaderPageData(articleId, session)` to gather article, progress,
  tags, related articles, bookmark membership, feedback, sanitized HTML, plain
  text, and derived display flags.
- Keep authorization server-side through `getReadableArticleById` and the
  current article access context.
- Keep analytics event recording best-effort and metadata-only.
- Extract JSON-LD generation into a pure helper that uses safe JSON stringifying.
- Extract the reader preference no-flash script into a named helper/component so
  the inline script is documented and testable for generated content.
- Move article header/meta/tag rendering into a presentational server component.
- Keep provider order intentional and documented: audio, highlights, tools, then
  reader layout/surface/mini-player.
- Preserve Next.js 15 promised `params` behavior.

Acceptance checks:

- Reader page tests/smoke paths still pass for public, private owner, forbidden,
  missing, completed, bookmarked, related, and no-related fallback cases.
- No stored article HTML is rendered unless sanitized.
- Metadata and JSON-LD output remain equivalent for representative articles.

Suggested issue split:

1. Extract data loader/read model and tests.
2. Extract metadata/JSON-LD/preference bootstrap helpers.
3. Extract article header and related-section server components.
4. Simplify `page.tsx` into route orchestration and composition.

### REF-030 — Split reader client providers into stores, API adapters, and DOM/audio hooks

Priority: P1. Area: reader client state.

Problem: Reader providers are doing many jobs. `ReaderAudioProvider` owns the
shared audio element, narration fetch, base64-to-blob conversion, dictation
segment derivation, active word binary search, loop mode, warm error state, and
blob URL lifecycle. `ReaderHighlightsProvider` owns highlight fetch, optimistic
CRUD, offline mutation enqueue, orphan tracking, announcements, and context
state. These concerns are reusable beyond their current providers.

Best strategy: keep provider contexts as the UI-facing API, but extract stores,
API adapters, and DOM/audio hooks behind them.

Detailed requirements:

- Extract narration API adapter from `ReaderAudioProvider`, eventually using the
  shared client fetch layer when compatible with the response shape.
- Extract base64/data-URI to Blob URL conversion and URL revocation into a small
  media helper with tests.
- Extract active-word search and loop segment behavior into pure/audio hooks.
- Extract highlight API adapter and optimistic reducer from
  `ReaderHighlightsProvider`.
- Define offline mutation integration points clearly: create, color, note, and
  delete must keep current dedupe/idempotency semantics.
- Preserve aria-live announcements and fallback behavior.
- Keep contexts stable for existing consumers: WordLookup, Notes panel,
  ReaderMiniPlayer, dictation/pronunciation/listen tools.

Acceptance checks:

- Existing reader audio, pronunciation, dictation, highlight, offline sync, and
  annotation tests pass.
- Blob URLs are revoked on unmount and replaced audio.
- Offline highlight create/update/delete behavior remains optimistic and
  eventually syncs.

Suggested issue split:

1. Extract reader audio API/media helpers and active-word/loop logic.
2. Extract highlight optimistic reducer and API adapter.
3. Keep provider facades stable and migrate internals.

### REF-031 — Extract personal article import service from the API route

Priority: P1. Area: imports/security/content pipeline.

Problem: `src/app/api/articles/import/route.ts` is 373 lines and combines route
schemas, query parsing, daily quota, URL SSRF validation, scraping, duplicate
checks before and after canonicalization, personal/private article creation,
text-to-HTML conversion, sanitization, word count validation, heuristic
difficulty, audit logging, security events, product analytics, and paginated
import listing.

Best strategy: move import business logic into a service with URL-import,
text-import, quota, duplicate resolution, and list read-model modules. Keep the
route as validation and response mapping.

Detailed requirements:

- Extract daily quota policy and UTC-day calculation into an import policy
  module with tests.
- Extract URL import flow into a service that enforces SSRF before scraping and
  dedupes raw and canonical URLs before consuming quota.
- Extract text import flow into a service that converts paragraphs to sanitized
  HTML, validates minimum word count, and creates private imported articles.
- Keep heuristic difficulty non-fatal and side-effect scoped to the new article.
- Keep audit and analytics metadata-only; never record imported text or article
  body in audit/analytics metadata.
- Preserve duplicate-on-unique-conflict behavior for concurrent imports.
- Keep listing imports separate from mutation flows.
- Preserve route response shapes: duplicate 200 with id, created 201 with id,
  list response shape matching article listings.

Acceptance checks:

- Existing import route tests and security regression tests pass.
- Tests cover unsafe URL rejection before scraping/row creation, duplicate raw
  URL, duplicate canonical URL, daily quota after duplicate checks, short text,
  concurrent P2002 duplicate, audit, and analytics metadata.

Suggested issue split:

1. Extract quota and duplicate helpers.
2. Extract URL import service.
3. Extract text import service.
4. Reduce route to validation/response mapping and update tests.

### REF-032 — Build shared admin UI primitives for tables, filters, and action panels

Priority: P2. Area: admin UI/reuse.

Problem: Admin pages and action components repeat table layout, search/filter
query building, time/status formatting, badge variant mapping, busy/error state,
confirmation panels, action buttons, and router refresh behavior. Examples
include admin jobs, articles, article detail, AI analytics, tag actions, member
actions, source actions, article actions, backfill, and ingest.

Best strategy: create reusable admin UI primitives and action hooks while
preserving feature-specific permissions and copy.

Detailed requirements:

- Extract admin table primitives: page header, summary cards, filter form,
  pagination links, empty state, status badge mapping, and timestamp/age
  formatting.
- Extract admin action helper hook for busy/error/openPanel state and API error
  mapping, integrated with REF-014 client-fetch where appropriate.
- Keep destructive actions behind `ConfirmAction` or a stronger shared admin
  confirmation component.
- Keep capability checks server-side; UI primitives must not imply security.
- Provide feature-specific slots for article review fields, job actions, tag
  merge controls, source toggles, and AI ops summaries.
- Avoid over-abstracting tables until at least two admin pages share the same
  primitive cleanly.

Acceptance checks:

- Existing admin route/page tests pass.
- Admin action components have less duplicated busy/error/fetch logic.
- Keyboard and screen-reader behavior for confirmation and filters remains at
  least as accessible as today.

Suggested issue split:

1. Extract admin formatting and pagination/filter helpers.
2. Extract admin action hook/panel primitives.
3. Migrate jobs/articles/tags/members/sources incrementally.

### REF-033 — Create shared test harnesses for route handlers and module mocks

Priority: P1. Area: tests/developer productivity.

Problem: Many route and domain tests repeat boilerplate: `RouteHandler` types,
session fixtures, `jsonReq` helpers, promised `params`, `mock.module` setup for
`@/lib/api-auth`, Prisma mock shapes, cache/audit mocks, and before/beforeEach
reset logic. This makes tests longer and raises the chance that route tests
diverge from Next.js 15 conventions.

Best strategy: create test support modules that provide small, explicit helpers
for common route and mock patterns while keeping each test's domain assertions
clear.

Detailed requirements:

- Add route helpers under `tests/support/route.ts` for JSON requests, method
  selection, promised `params`, reading JSON responses, and common session
  fixtures.
- Add API auth mock helpers that can configure authenticated, unauthenticated,
  admin, and capability-denied states.
- Add Prisma mock builder helpers only for repeated shapes; avoid a giant magic
  mock that hides test setup.
- Keep module mocking explicit enough that each test still shows its important
  dependencies.
- Preserve Node test runner semantics and `--experimental-test-module-mocks`
  compatibility.
- Update route tests gradually; do not rewrite every test in one giant PR.

Acceptance checks:

- New support helpers are used by at least several route test files and reduce
  duplicated `jsonReq`/session/mock boilerplate.
- Existing route tests continue to pass.
- Route tests continue to call handlers with `Request` and promised `params`
  where applicable.

Suggested issue split:

1. Add route request/params/session helpers.
2. Add API-auth and selected Prisma mock helpers.
3. Migrate a small set of route tests, then expand by feature area.

### REF-034 — Extract shared CLI runtime utilities for scripts

Priority: P2. Area: scripts/operations.

Problem: Operational scripts repeat their own argument parsing, help text,
summary formatting, main/exit handling, signal handling, dry-run behavior, and
environment setup assumptions. Examples include `scripts/process.ts`,
`scripts/scrape.ts`, `scripts/worker.ts`, `scripts/push-reminders.ts`,
`scripts/migrate-storage.ts`, and `scripts/eval.ts`.

Best strategy: add a small script runtime helper package and migrate scripts
incrementally, without changing script names or package.json commands.

Detailed requirements:

- Extract common `runCli(main)` behavior: catch errors, print user-facing
  messages, set exit codes, and avoid leaking secrets.
- Extract small argument parsing helpers for flags, integer values, comma lists,
  booleans, and `--help`.
- Extract signal handling for long-running scripts/workers where appropriate.
- Keep script help text accurate and generated from the script's own options or
  at least tested against package scripts.
- Preserve script-specific output summaries; do not force all scripts into one
  generic format.
- Coordinate with REF-009 before removing compatibility flags such as worker
  `--jobs`.

Acceptance checks:

- Existing package scripts still work with the same CLI flags.
- Script tests or dry-run checks cover parseArgs/help for process, scrape,
  worker, push reminders, and migrate storage.
- Secrets/env values are never printed by shared error handling.

Suggested issue split:

1. Add CLI runtime and argument helpers.
2. Migrate low-risk one-shot scripts.
3. Migrate long-running worker signal handling.
4. Add script help/parse tests.

### REF-035 — Formalize media storage providers and migration workflows

Priority: P2. Area: media storage/operations.

Problem: `src/lib/storage/*` is partially modular already, but its provider
selection and migration story are still tied to speech audio. `runtime.ts`
constructs adapters directly, `config.ts` owns env parsing, Azure and filesystem
adapters implement the same interface, and `speech-migration.ts` performs a
speech-specific migration from DB base64 to object storage. Future S3/R2 or
additional media kinds will need clearer seams.

Best strategy: keep the storage abstraction small, but introduce an explicit
provider registry plus media migration framework that is not speech-only.

Detailed requirements:

- Introduce a provider registry keyed by `MediaStorageKind` so runtime selection
  does not hard-code adapter construction in a switch that grows indefinitely.
- Keep `database` as a deliberate null-storage mode with documented fallback
  semantics.
- Split provider config parsing from adapter construction; each provider module
  should validate only its own env/config.
- Keep S3/R2 as explicit unsupported seams until real adapters exist; warn once
  and degrade predictably.
- Generalize migration result types around media kind, scanned/migrated/failed,
  and skipped-no-storage.
- Keep speech migration idempotent and lossless: clear base64 only after storage
  write and `MediaAsset` update both succeed.
- Add contract tests for every storage adapter: key generation, checksum, get
  missing object, put/get round trip, and safe failure behavior.

Acceptance checks:

- Existing Azure/filesystem/storage/speech migration tests pass.
- Adding S3/R2 requires adding an adapter + registry entry + contract tests, not
  editing unrelated speech migration code.
- No storage path logs or persists credentials or signed URLs.

Suggested issue split:

1. Add storage provider registry and adapter contract tests.
2. Split provider config/adapter construction.
3. Generalize media migration scaffolding and keep speech migration as first
   implementation.
4. Document unsupported cloud seams and fallback behavior.

### REF-036 — Split push delivery, reminder scheduling, and subscription health

Priority: P2. Area: push notifications/reminders.

Problem: `src/lib/push.ts` combines VAPID configuration, `web-push` initialization,
subscription delivery, endpoint pruning, failure counters, due-card query,
preference/timezone checks, reminder payload construction, and job summary
reporting. `reminder-preferences.ts` combines pure preference validation/schedule
logic with Prisma accessors. The pieces are mature enough to become a push
subsystem.

Best strategy: split push into provider setup, subscription repository,
delivery service, reminder scheduler, and preference modules.

Detailed requirements:

- Extract VAPID/web-push initialization into `push/provider.ts`; it should be
  the only module importing `web-push`.
- Extract subscription health updates into a repository/service: success resets
  failure counts, transient failure increments, 404/410 or threshold exceeded
  prunes.
- Extract `sendToSubs` into a delivery service that accepts preloaded
  subscriptions and a payload.
- Extract due-card discovery and reminder payload building into a scheduler
  module.
- Keep reminder preference pure functions separate from Prisma reads/writes.
- Preserve graceful fallback: unconfigured VAPID is a no-op, not a hard failure.
- Preserve privacy: push payloads should include counts and links, not word
  lists, article text, or private study content.

Acceptance checks:

- Existing push and reminder preference tests pass.
- Delivery behavior is covered for success, gone endpoint, transient failure,
  threshold pruning, disabled preference, quiet hours, preferred hour, and
  invalid timezone fallback.
- Reminder job remains batch-oriented and avoids N+1 subscription queries.

Suggested issue split:

1. Extract VAPID provider and subscription repository.
2. Extract delivery service and tests.
3. Extract reminder scheduler and preference repository.
4. Migrate scripts/routes/components to the push subsystem barrel.

### REF-037 — Create a security governance package for rate limit, audit, CSRF, IP, and security events

Priority: P1. Area: security/compliance/observability.

Problem: Security-sensitive behavior is spread across `rate-limit.ts`,
`rate-limit-store.ts`, `security-events.ts`, `audit.ts`, `csrf.ts`,
`client-ip.ts`, `rbac.ts`, `session.ts`, and `api-auth.ts`. Each module is
useful, but privacy/redaction, request context, actor identity, trusted IP
resolution, alerting, and capability semantics are cross-cutting and easy to
apply inconsistently.

Best strategy: create a `security/` package with explicit submodules and shared
redaction/request-context contracts. Keep public imports stable through barrels
while migrating.

Detailed requirements:

- Move trusted client IP parsing/CIDR/proxy logic under `security/client-ip.ts`
  with focused tests for IPv4, IPv6, mapped IPv6, CIDR, proxy hops, proxy lists,
  and platform headers.
- Move CSRF origin checks under `security/csrf.ts` and keep same-origin defaults
  unchanged.
- Move rate limit scopes/policies/store fallback under `security/rate-limit/`.
- Move audit log sanitization and metadata redaction into shared privacy helpers
  that security events and error reporting can reuse where appropriate.
- Keep security event spike detection and ring buffer bounded; do not persist
  sensitive metadata.
- Keep RBAC/capability role maps close to auth guard modules but do not conflate
  global roles, tenant roles, and classroom roles.
- Document which functions may throw request-blocking errors and which are
  best-effort monitoring side effects.

Acceptance checks:

- Existing security, audit, RBAC, rate-limit, client IP, CSRF, and API handler
  tests pass.
- Redaction tests prove emails, tokens, cookies, secrets, URLs, prompts, and
  article text cannot appear in audit/security metadata.
- Route wrappers still record denied admin access, 401/403/429 events, CSRF
  blocks, and admin mutations.

Suggested issue split:

1. Extract client IP and CSRF modules under a security package.
2. Extract rate-limit policy/store modules.
3. Extract audit/security-event shared redaction and monitoring helpers.
4. Migrate auth/RBAC guards behind stable exports.

### REF-038 — Split article search into query parsing, providers, ranking, and annotation sources

Priority: P1. Area: search/indexing.

Problem: `src/lib/article-search.ts` mixes query tokenization, portable Prisma
contains filters, PostgreSQL FTS SQL, readable-article access, annotation and
saved-word match sources, candidate scoring, candidate merging, pagination, and
the backwards-compatible `searchPublishedArticles` entry point. Search will get
harder to evolve as PostgreSQL FTS, highlighting, saved-word matches, and tenant
search grow.

Best strategy: create a search subsystem with provider adapters and shared
ranking/candidate types.

Detailed requirements:

- Extract query parsing/tokenization and limits into `search/query.ts`.
- Extract ranking/scoring into `search/ranking.ts` with tests for title, excerpt,
  byline, content, annotation, saved word, owner/private boosts, recency, and
  stable tie-breaks.
- Extract annotation/saved-word source lookup into `search/annotations.ts`.
- Split provider adapters:
  - portable Prisma contains provider,
  - PostgreSQL FTS provider,
  - future tenant/org-aware provider if needed.
- Keep readable article filtering mandatory in every provider.
- Preserve SQLite/dev fallback behavior.
- Rename the compatibility entry point (`searchPublishedArticles`) only through
  REF-009 cleanup after callers migrate.

Acceptance checks:

- Existing search/articles-search tests pass for public, private owner,
  annotations, saved words, pagination, and no-query cases.
- PostgreSQL FTS failures fall back gracefully to portable search.
- Pure ranking tests import no Prisma.

Suggested issue split:

1. Extract query/ranking pure modules and tests.
2. Extract annotation source lookup.
3. Split Prisma and PostgreSQL providers behind `ArticleSearchProvider`.
4. Migrate route/callers and clean compatibility naming separately.

### REF-039 — Centralize listing cache keys, invalidation tags, and tenant cache policy

Priority: P2. Area: caching/listings/tenancy.

Problem: `src/lib/cache.ts` owns Next Data Cache wrappers, tag constants,
tenant key helpers, per-tenant memoization, metrics recording, and revalidation
helpers. Listing modules such as articles, tags, feed, recommendations, and
tenant/org views depend on cache behavior, but cache policy is not expressed as
a reusable listing-cache subsystem with contracts.

Best strategy: keep Next's cache as the backing implementation, but extract
cache policy, key/tag builders, and invalidation APIs into a dedicated package.

Detailed requirements:

- Define cache scopes (`public`, `user`, `org`) and key/tag construction in pure
  helpers with tests.
- Keep public listing keys unchanged unless a migration note explains invalidated
  caches.
- Make tenant cache rules explicit: user/org scoped keys must never collide with
  public keys or each other.
- Move metrics recording into cache wrapper internals without requiring listing
  modules to know metric names.
- Provide invalidation helpers by domain: articles, tags, org, user, and future
  media/search if needed.
- Document when CLI/worker code cannot call `revalidateTag` and relies on
  time-based revalidation.

Acceptance checks:

- Existing cache, article listing, tag listing, feed, recommendation, and tenant
  cache tests pass.
- Tests prove tenant key/tag isolation for user/org/public scopes.
- Revalidation helpers remain safe outside request scope.

Suggested issue split:

1. Extract pure cache policy/key/tag helpers.
2. Extract cache wrapper and metrics integration.
3. Migrate listing modules to named cache policy helpers.
4. Document invalidation ownership by domain.

### REF-040 — Split article library services into access policy, listings, admin, moderation, and collections

Priority: P1. Area: article domain/content library.

Problem: Article-domain behavior is spread across several broad modules:
`article-access.ts` owns visibility policy and where builders, `articles.ts`
owns public/personal listings and card shaping, `admin-articles.ts` owns admin
search/detail/delete/rebuild, `content-review.ts` owns moderation corrections,
`content-policy.ts` owns takedown rights, `tags.ts` owns taxonomy and related
articles, and `bookmarks.ts` owns reading lists. These modules all depend on
article lifecycle, visibility, and cache invalidation but do not form a single
article-library package.

Best strategy: create an article-library subsystem with policy, repositories,
read models, commands, moderation, taxonomy, and collections modules.

Detailed requirements:

- Keep access policy (`canReadArticle`, `readableArticleWhere`, etc.) separate
  and dependency-light so every query can reuse it.
- Move listing read models into focused modules: public listings, category
  pages, picks, personal imports, admin listings, related articles.
- Move article card shaping (`toListingArticle`, reading minutes) into a shared
  presentation mapper module.
- Move admin article commands (delete/rebuild) into command modules that own
  audit/cache side effects.
- Move moderation/review and takedown rights under content governance modules,
  but keep their interaction with article status explicit.
- Move tags/taxonomy and reading-list/bookmarks under article collections if
  they remain article-adjacent, while preserving user ownership checks.
- Keep cache invalidation explicit after mutations: article edits/deletes,
  tag changes, list membership where applicable.

Acceptance checks:

- Existing articles, article access, admin articles, content review, content
  routes, tags, bookmarks, and visibility regression tests pass.
- No query that returns articles bypasses article access/visibility policy.
- Admin/operator commands preserve audit and security-event behavior.

Suggested issue split:

1. Extract article policy and listing read-model modules.
2. Extract presentation mappers and cache invalidation helpers.
3. Extract admin commands and moderation/takedown modules.
4. Extract taxonomy/bookmark collection modules behind stable exports.

### REF-041 — Extract taxonomy/tag scope rules from AI tag generation and tag listings

Priority: P2. Area: tags/taxonomy/multi-tenancy.

Problem: `src/lib/tags.ts` mixes slugification, AI tag parsing/generation,
tag scope/namespace rules, tag upsert, article tag reconciliation, public tag
lookups, tag article listings, related article ranking, cached tag counts, and
admin moderation support. Tag scope rules are security-sensitive because private
imports must not leak into public tag namespaces.

Best strategy: split taxonomy into pure slug/scope helpers, tag repository,
AI generation adapter, listing/read-model modules, and admin reconciliation
commands.

Detailed requirements:

- Extract slugification and namespace/scope derivation into pure helpers with
  tests for public, private user, and future org scopes.
- Extract tag repository operations: find/upsert scoped tag, link/unlink article
  tags, read article tags.
- Keep AI tag generation separate from manual/admin tag reconciliation.
- Keep public tag listings restricted to public tags on public-listable articles.
- Keep private tag scopes out of public tag pages, related article listings, and
  tag count caches.
- Preserve cache invalidation for tag changes via the cache subsystem.

Acceptance checks:

- Existing tag tests, admin tag tests, article visibility regression tests, and
  related article tests pass.
- Private imported article tags cannot appear on public tag pages or public tag
  count listings.
- AI tag generation still degrades gracefully when AI is unavailable.

Suggested issue split:

1. Extract slug/scope helpers and tests.
2. Extract tag repository/link reconciliation.
3. Split AI generation from manual/admin tag commands.
4. Split public tag listings and related article read models.

### REF-042 — Split reading-list/bookmark commands from listing read models and membership queries

Priority: P2. Area: bookmarks/collections.

Problem: `src/lib/bookmarks.ts` mixes default-list creation, list listing,
list-with-articles read model, list create/rename/delete commands, add/remove
commands, default-list toggle, batch bookmarked article lookup, and list-picker
membership queries. All operations are ownership-checked, but command/read-model
boundaries are not explicit.

Best strategy: split reading-list collection logic into command modules,
repositories, and read models while preserving structured result shapes for API
routes.

Detailed requirements:

- Extract default-list policy (`Saved`, lazy upsert, cannot delete) into a small
  policy/helper module.
- Move list commands (`createList`, `renameList`, `deleteList`, `addToList`,
  `removeFromList`, `toggleBookmark`) into command modules that return the same
  structured results.
- Move read models (`getUserLists`, `getListWithArticles`,
  `getBookmarkedArticleIds`, `getArticleListMembership`) into query modules.
- Keep article readability checks before adding/toggling bookmarks to prevent
  draft/foreign private article leaks.
- Keep idempotency: duplicate adds and missing removes remain successful.
- Coordinate with REF-007/REF-014 so UI mutations call the command routes via
  shared client helpers.

Acceptance checks:

- Existing bookmark route/service tests pass.
- Tests still prove IDOR protections for wrong-owner lists and non-viewable
  articles.
- Public route result shapes remain unchanged.

Suggested issue split:

1. Extract default-list policy and read models.
2. Extract list/item command modules.
3. Migrate API routes and UI callers behind stable exports.

### REF-043 — Move route schemas and domain validation into feature-owned schema modules

Priority: P2. Area: validation/API contracts.

Problem: `src/lib/validation.ts` is a useful tiny schema toolkit, but many
routes still define request body/query schemas inline. Domain-specific validators
also live inside services (`content-review`, `content-policy`,
`reminder-preferences`, import route, admin routes). This makes API contract
reuse and route/service testing harder.

Best strategy: keep the tiny validation primitives, but move route/domain
schemas into feature-owned schema modules that both routes and tests can import.

Detailed requirements:

- Keep `src/lib/validation.ts` as generic primitives only.
- Create feature schema modules near domains, e.g. `imports/schemas.ts`,
  `reader/schemas.ts`, `admin/articles/schemas.ts`, `bookmarks/schemas.ts`,
  `push/schemas.ts`, `content-review/schemas.ts`.
- Export inferred TypeScript types from schemas where route handlers and services
  need the normalized values.
- Avoid duplicating validation rules between route schemas and service-level
  validation. Service functions may still enforce invariants that require DB
  state.
- Keep unknown-key dropping behavior unless a route explicitly needs strict
  rejection.
- Preserve error messages where tests or clients depend on them.

Acceptance checks:

- Route tests can import schemas directly for validation-specific cases.
- API handlers remain built with `createHandler` body/query/params schemas.
- Existing validation, route, import, content review, bookmarks, push, and admin
  tests pass.

Suggested issue split:

1. Identify high-duplication inline schemas and create feature schema modules.
2. Migrate import/bookmark/push/admin article schemas first.
3. Migrate reader route schemas after REF-003 reader route helper work.
4. Add schema-level unit tests for complex domain contracts.

### REF-044 — Consolidate session, API auth, and capability guard wrappers

Priority: P2. Area: auth/RBAC/developer ergonomics.

Problem: Page/server guards live in `src/lib/session.ts`, API guards live in
`src/lib/api-auth.ts`, role/capability maps live in `src/lib/rbac.ts`, and docs
still mention compatibility wrappers such as `requireAdmin` and
`requireAdminApi`. The modules are small, but guard naming and capability vs
role semantics can be confusing for future routes/pages.

Best strategy: create an auth/authorization guard package that clearly separates
session loading, page redirects, API `NextResponse` errors, global capabilities,
tenant capabilities, and compatibility wrappers slated for removal.

Detailed requirements:

- Keep global role checks and tenant/classroom capability checks conceptually
  separate.
- Rename or group guards by environment: page guards redirect, API guards return
  response errors, service-level helpers return booleans/results.
- Prefer capability guard names over raw admin-role guard names for new code.
- Add deprecation/removal plan for compatibility wrappers after callers migrate.
- Keep `createHandler` integration stable for session/admin/capability auth
  modes.
- Document when a missing session should redirect vs return 401.

Acceptance checks:

- Existing RBAC, API handler, auth provider, admin route, tenant/classroom, and
  route tests pass.
- New routes/pages can choose the correct guard from names alone.
- Grep shows no new usages of deprecated admin-wrapper names after migration.

Suggested issue split:

1. Introduce auth guard package/barrel with clear naming.
2. Migrate page guards and API guards incrementally.
3. Update docs and mark compatibility wrappers for REF-009 deletion.

### REF-045 — Split engagement progress, activity, streaks, and reading-speed telemetry

Priority: P2. Area: learner engagement/progress analytics.

Problem: Reading engagement behavior is spread across `progress.ts`,
`activity.ts`, `reading-speed.ts`, `reading-speed-stats.ts`, learner analytics,
and UI trackers. `saveProgress` owns forward-only progress and triggers daily
activity as a side effect. `activity.ts` owns timezone day math, streak shields,
heatmaps, and dashboard streak summaries. Reading-speed stats are computed from
article mastery rows. These are related engagement signals but not packaged as
a clear subsystem.

Best strategy: create an engagement/progress subsystem with separate pure time
math, progress commands, activity/streak services, reading-speed algorithms, and
analytics read models.

Detailed requirements:

- Extract timezone/date helpers (`dateKey`, local day start, week buckets where
  applicable) into a shared time module with tests for UTC and non-UTC users.
- Keep forward-only progress writes race-safe and completion sticky.
- Move daily activity recording behind an explicit domain event or service call
  so `saveProgress` side effects are visible and testable.
- Extract streak-shield rules into pure functions with fixtures for gap fill,
  shield earning, max shield cap, and no-profile behavior.
- Keep heatmap cell generation pure and independent of Prisma.
- Keep reading-speed math pure; repositories should only fetch source rows.
- Preserve privacy: progress/activity analytics must not log article text or
  private content.

Acceptance checks:

- Existing progress, activity, reading-speed, learner analytics, and dashboard
  tests pass.
- Pure date/streak/speed tests import no Prisma.
- Concurrent progress writes still never decrease stored percent.

Suggested issue split:

1. Extract shared engagement time/date helpers.
2. Extract progress command and activity/streak services.
3. Extract reading-speed repository/read model.
4. Rewire learner analytics to consume the new engagement read models.

### REF-046 — Consolidate CEFR level, difficulty, placement, and adaptive recommendation logic

Priority: P2. Area: leveling/difficulty/onboarding.

Problem: CEFR-related logic is duplicated across `difficulty.ts`, `leveling.ts`,
`placement.ts`, `progress-helpers.ts`, onboarding placement UI, and recommendation
systems. Each module owns some combination of level ordering, thresholds,
evidence gathering, explanations, difficulty heuristics, placement questions,
and user-level history. This makes it harder to evolve CEFR behavior coherently.

Best strategy: create a leveling subsystem with shared CEFR primitives, pure
recommendation algorithms, evidence repositories, and placement/difficulty
adapters.

Detailed requirements:

- Define one CEFR primitive module for levels, ranks, ranges, labels, and
  validation.
- Move Flesch/heuristic difficulty and AI difficulty assessment behind a
  difficulty assessment service.
- Move placement question bank and scoring into a placement module that can be
  used by onboarding and tests without rendering UI.
- Move adaptive recommendation pure logic and evidence gathering into separate
  modules.
- Preserve user profile level as the source of truth; adaptive recommended level
  must not mutate profile automatically.
- Keep explanation strings deterministic and tested for representative evidence.
- Coordinate with recommendation/feed scoring so level ranking comes from the
  same primitive module.

Acceptance checks:

- Existing difficulty, leveling, placement, onboarding, recommendation, and
  study-plan tests pass.
- No module defines its own CEFR rank/order table after migration.
- Placement and adaptive recommendation pure tests import no Prisma.

Suggested issue split:

1. Extract CEFR primitives and migrate imports.
2. Extract placement scoring/question bank.
3. Extract difficulty assessment service.
4. Extract adaptive recommendation evidence/read-model modules.

### REF-047 — Standardize cache-first language AI feature services

Priority: P1. Area: AI language features/content tools.

Problem: Vocabulary, quiz, tags, difficulty, translation, sentence translation,
and grammar all follow similar patterns: validate/access article or selected
text, check cache, render prompt, call AI, validate/moderate output, persist on
success, and return graceful fallback without caching failed output. Some use
`getOrCreateArticleAi`, while sentence translation and grammar implement custom
flows. The shared pattern is not explicit enough for future language tools.

Best strategy: create a language-feature service layer on top of AI governance,
prompt registry, and article access that standardizes cache-first behavior while
allowing feature-specific validation and persistence.

Detailed requirements:

- Define reusable feature contracts for article-level AI outputs and selection-
  level AI outputs.
- Keep `getOrCreateArticleAi` or its successor as the shared article-level
  cache orchestrator, but make extension points clearer: load article, read
  cache, build prompt, parse/validate, persist, result mapping, fallback.
- Add a parallel pattern for selection-scoped tools like sentence translation
  and grammar explanation, including normalized text/phrase hashing.
- Preserve no-cache-on-fallback behavior for failed/placeholder AI output.
- Preserve moderation/validation gates before caching grammar/tutor-like output.
- Keep article access enforced before AI work.
- Preserve language support validation and prompt version metadata for cache and
  ledger records.

Acceptance checks:

- Existing vocabulary, quiz, tags, difficulty, translation, sentence translation,
  grammar, AI cache, and security regression tests pass.
- New language feature tests can exercise cache hit, cache miss, AI fallback,
  validation failure, and persistence through a common harness.
- No feature caches partial translation chunks or unsafe output.

Suggested issue split:

1. Clarify article-level AI feature contract and migrate existing users.
2. Add selection-level AI feature contract for sentence/grammar tools.
3. Move feature-specific validators/persistence into small adapters.
4. Add shared feature-service test harness.

### REF-048 — Package lexical tooling: dictionary provider, word normalization, saved words, and cloze

Priority: P2. Area: vocabulary/lexical tools.

Problem: Lexical behavior spans `dictionary.ts`, `dictionary-normalize.ts`,
`vocabulary.ts`, `word-mastery.ts`, `cloze.ts`, dictionary UI hooks, and saved
word/SRS flows. Word-form normalization powers dictionary lookup and should also
be consistent with saved-word matching, cloze grading, and mastery lemma logic,
but these rules currently live in separate modules.

Best strategy: create a lexical subsystem with pure normalization, provider
adapters, saved-word repository/read models, cloze utilities, and word mastery
integration.

Detailed requirements:

- Define one canonical word normalization/lemma module and compare it against
  existing dictionary candidates and word mastery `lemmaFor` behavior.
- Extract dictionary provider interface so Free Dictionary API is one provider,
  not hard-coded in the service.
- Add optional dictionary response caching policy if needed, with privacy-safe
  metadata only.
- Keep dictionary network failures graceful (`found:false`) and low-noise in
  logs.
- Align saved-word matching, cloze grading, and mastery lemma behavior where
  product semantics should match; document intentional differences.
- Keep examples/definitions out of analytics/audit metadata.

Acceptance checks:

- Existing dictionary, dictionary-normalize, vocabulary, word mastery, cloze,
  and flashcard tests pass.
- Pure lexical tests cover contractions, possessives, plurals, gerunds, past
  tense, comparatives, punctuation, and empty/non-English-ish input.
- Dictionary provider can be mocked without network.

Suggested issue split:

1. Extract canonical lexical normalization/lemma module.
2. Extract dictionary provider adapter interface and tests.
3. Align saved-word/cloze/mastery use of lexical helpers.
4. Document provider fallback and caching policy.

### REF-049 — Split analytics event stream writer from analytics read models and compatibility barrels

Priority: P2. Area: analytics/event stream/privacy.

Problem: `src/lib/analytics.ts` owns event type constants, schema version,
property sanitization, best-effort writes, retention prune, and per-user delete.
Meanwhile `src/lib/analytics/events.ts`, `product.ts`, `learner.ts`, `admin.ts`,
and `tenant.ts` are one-line barrels to older module locations. Analytics read
models are split elsewhere. This creates a partly-migrated analytics namespace.

Best strategy: make `src/lib/analytics/` the real package, with event stream,
schemas, retention, and read models under it; then delete transitional barrels.

Detailed requirements:

- Move event type constants and schema version into `analytics/events/catalog.ts`.
- Move property sanitization into `analytics/events/sanitize.ts` with tests for
  sensitive keys, text/url/prompt/translation keys, arrays, long strings, and
  nested objects.
- Move writer functions into `analytics/events/writer.ts` and retention/erasure
  into `analytics/events/retention.ts`.
- Move product/admin/learner/tenant read models under the same analytics package
  or stable subpackages.
- Preserve public imports through temporary barrels only during migration.
- Delete one-line compatibility barrels once call sites migrate.
- Keep analytics metadata-only; no article text, selected text, dictionary
  definitions, prompts, translations, URLs, emails, or PII.

Acceptance checks:

- Existing analytics, admin analytics, tenant analytics, learner analytics, and
  account deletion/export tests pass.
- `recordEvent` remains best-effort and never breaks user actions.
- Grep confirms old one-line barrels are gone or explicitly marked temporary.

Suggested issue split:

1. Move event catalog/sanitizer/writer/retention into analytics package.
2. Move read models or update barrels to the new real package layout.
3. Migrate imports and delete compatibility barrels.

### REF-050 — Build an annotation domain service for highlights, anchors, notes, and offline conflicts

Priority: P1. Area: reader annotations/offline sync.

Problem: Highlight and note behavior spans `highlights.ts`, `offline-conflict.ts`,
`ReaderHighlightsProvider`, `WordLookup`, `ReaderNotesPanel`, and API routes.
Server-side highlight CRUD, anchor validation, anchor revalidation, note conflict
merge, optimistic client state, and offline mutation queuing are related but not
packaged as an annotation subsystem.

Best strategy: create an annotations subsystem with pure anchor/conflict helpers,
server commands/read models, and client/offline adapters.

Detailed requirements:

- Keep pure anchor validation, revalidation, whitespace-tolerant matching, and
  note merge logic in dependency-free modules.
- Move server highlight commands into an annotation command module: create,
  update color, update note with conflict detection, delete.
- Move annotation read models into query modules: article highlights, all user
  highlights, counts by article.
- Keep article readability/ownership checks mandatory in route/service layers.
- Preserve optimistic UI and offline mutation semantics from existing provider.
- Define how optimistic create-then-delete offline should reconcile; if current
  behavior is accepted, document it and add tests.
- Keep note text and selected text out of analytics/audit metadata unless
  explicitly sanitized and allowed by policy.

Acceptance checks:

- Existing highlights, reader annotations, offline conflict, notes, and security
  regression tests pass.
- Pure anchor/conflict tests cover moved, missing, valid, whitespace reflow,
  duplicate quote, last-write-wins, and merge conflict cases.
- No stored/scraped article HTML is rendered unsanitized during anchor work.

Suggested issue split:

1. Extract pure annotation anchor/conflict helpers.
2. Extract server annotation commands/read models.
3. Migrate client provider/offline adapter behind stable APIs.
4. Document and test offline edge cases.

### REF-051 — Standardize practice attempt recording and history read models

Priority: P2. Area: practice/assessment history.

Problem: Quiz attempts, pronunciation attempts, dictation grading, and future
practice modes share concepts: validated score inputs, idempotency for offline
sync, per-article history, best/last/average summaries, trend points, and mastery
updates. Today `quiz-mastery.ts`, `pronunciation.ts`, `dictation.ts`, and related
routes implement these patterns separately.

Best strategy: introduce a practice-attempt subsystem with shared score
validation, idempotency helpers, trend/history read models, and feature-specific
adapters.

Detailed requirements:

- Extract bounded score validation helpers for 0–100 integer scores and count-
  based percentages.
- Provide a generic idempotent-attempt helper for routes that accept
  `clientMutationId` from offline queue replay.
- Keep feature-specific payloads separate: quiz counts/questions, pronunciation
  subscores/reference text, dictation diff tokens.
- Define common history summary shapes where useful: attempts, best, last,
  average, count, recent trend.
- Keep user scoping mandatory for every history/read query.
- Preserve mastery side effects; do not silently change how quiz/pronunciation
  contributes to skill/article mastery.

Acceptance checks:

- Existing quiz mastery, pronunciation, dictation, offline sync, and practice
  route tests pass.
- Duplicate offline quiz attempt delivery still returns the original row rather
  than double-recording.
- Pure grading tests import no Prisma.

Suggested issue split:

1. Extract shared practice score/idempotency helpers.
2. Extract quiz attempt service around existing behavior.
3. Extract pronunciation attempt service around existing behavior.
4. Define dictation attempt persistence only if/when product needs it; keep
   current pure dictation grading separate meanwhile.

### REF-052 — Consolidate account lifecycle, privacy export/delete, and admin member support workflows

Priority: P2. Area: account/privacy/admin support.

Problem: Account and member lifecycle behavior is split across `account.ts`,
`admin-members.ts`, `admin-member-detail.ts`, admin routes/components, audit
helpers, analytics erasure, and backfill repair. Data export/delete, last-admin
guards, session revocation, member repair, support help, and admin member detail
read models all touch privacy-sensitive user data.

Best strategy: create an account lifecycle subsystem with privacy-safe export,
deletion, admin support commands, member read models, and audit integration.

Detailed requirements:

- Separate user self-service account commands from admin member commands.
- Keep privacy export shape stable and documented; never include secrets,
  sessions, tokens, provider credentials, or raw private content outside the
  intended export contract.
- Keep account deletion safe: last-admin protection, analytics event deletion,
  owned/private data cascade expectations, and audit retention must be explicit.
- Move admin member detail read model away from support commands.
- Move support commands (revoke sessions, export member data, repair/backfill,
  resend sign-in help) into explicit command modules with audit factories.
- Keep global admin and tenant/org admin distinctions clear.

Acceptance checks:

- Existing account, admin members, admin member detail, audit, analytics erasure,
  and support route tests pass.
- Deleting a user preserves required audit logs while removing/erasing private
  analytics and user-owned data per docs.
- Export tests prove sensitive tokens/session data are excluded.

Suggested issue split:

1. Extract account export/delete services and tests.
2. Extract admin member list/detail read models.
3. Extract admin support commands with audit integration.
4. Update account/privacy/admin docs if export/delete contracts move.

### REF-053 — Package observability core: logger context, error reporting, tracing, and SLO evaluation

Priority: P2. Area: observability/platform.

Problem: Observability platform behavior is split across `logger.ts`,
`error-reporting.ts`, `tracing.ts`, `tracing-node.ts`, `metrics.ts`, and `slo.ts`.
Metrics already has a refactor candidate, but the rest of the stack also shares
request context, redaction, safe attributes, error fingerprinting, alert hooks,
and SLO report evaluation. These should be a coherent observability package.

Best strategy: create `src/lib/observability/` with logger context, error
capture, tracing helpers, SLO evaluation, and metrics integration as explicit
submodules.

Detailed requirements:

- Move request context and structured logger creation into
  `observability/logger.ts` while preserving `createLogger` imports through a
  compatibility barrel during migration.
- Move error scrubbing/fingerprinting/capture sinks into
  `observability/errors.ts`; coordinate redaction helpers with security/audit
  refactors.
- Move tracing attribute sanitization and span helpers into
  `observability/tracing.ts`, keeping safe attribute allowlists low-cardinality.
- Move Node SDK startup into an environment-specific module.
- Move SLO catalog/evaluation into `observability/slo.ts` and keep it driven by
  metrics snapshots.
- Ensure no observability path records prompts, article text, selected text,
  credentials, cookies, tokens, or user-private content.

Acceptance checks:

- Existing logger, error-reporting, tracing, metrics, SLO, API handler, and
  security event tests pass.
- Request ID/user ID context still flows through API handlers, logs, errors,
  metrics, and traces as before.
- Public imports remain stable until consumers migrate.

Suggested issue split:

1. Create observability package and move logger/error helpers.
2. Move tracing helpers and Node startup.
3. Move SLO evaluation and integrate with metrics package from REF-018.
4. Migrate imports and delete compatibility barrels once stable.

### REF-054 — Model app shell navigation and responsive chrome as a subsystem

Priority: P2. Area: app shell/navigation UX.

Problem: Navigation state and chrome behavior are spread across
`AppSidebar`, `BottomTabBar`, `MoreSheet`, `HeaderSearch`, `nav-items.ts`,
`ThemeToggle`, keyboard-shortcuts UI, and middleware protected-route lists.
Desktop and mobile navigation render from shared nav arrays, but each component
owns its own active-state, role gating, localStorage state, reader-route special
case, and close-on-navigation behavior.

Best strategy: create a shell/navigation subsystem with a shared nav model,
responsive presenters, and a small persistence/state hook.

Detailed requirements:

- Define one navigation model that includes href, label, icon, group, mobile tab
  eligibility, role/capability visibility, and protected-route metadata.
- Use that model in sidebar, bottom tabs, More sheet, header/search shortcuts,
  and middleware/protected-route generation where practical.
- Extract sidebar collapsed persistence into `useSidebarState`, including
  responsive default and reader-route transient override.
- Keep reader routes in focused-reading mode by default without overwriting the
  user's global sidebar preference.
- Keep mobile More sheet behavior accessible: focus trap, Escape/scrim close,
  close on navigation, and focus restoration.
- Keep admin links server-authorized; shell visibility is convenience only, not
  a security boundary.

Acceptance checks:

- Shell/navigation tests cover active path matching, admin visibility, reader
  route override, localStorage persistence, mobile More close-on-navigation, and
  protected-route list generation if automated.
- Existing shell, command palette, middleware, and navigation smoke tests pass.

Suggested issue split:

1. Extract nav model and active/protected route helpers.
2. Extract sidebar state hook and migrate `AppSidebar`.
3. Migrate mobile tabs/More sheet/header search to the model.
4. Align middleware protected prefixes with the nav/protected route model.

### REF-055 — Extract reader display preferences and no-flash bootstrap into a reader settings subsystem

Priority: P1. Area: reader UX/preferences.

Problem: Reader display preferences are coordinated across `ReaderControls`,
`src/lib/reader-prefs.ts`, inline no-flash script in the reader page, reader CSS
tokens/classes, `Popover`, `Sheet`, and localStorage. The same state controls
reading mode, font scale, font family, and line spacing. The logic is currently
split between a React component, a React-free helper, and embedded script text.

Best strategy: create a reader display/settings subsystem that owns the
preference schema, storage, DOM application, bootstrap script generation, and UI
controls.

Detailed requirements:

- Keep `reader-prefs.ts` React-free and make it the schema/source of truth for
  valid modes, fonts, spacing, font-scale steps, defaults, and labels.
- Generate the pre-paint bootstrap script from a named helper or at least keep a
  tested string builder near the preference schema.
- Extract `ReaderDisplayPanel` from `ReaderControls`; keep controls focused on
  toolbar composition.
- Keep desktop Popover vs mobile Sheet behavior unchanged.
- Preserve accessibility: stepper live announcements, radiogroup semantics,
  focus restoration, Escape/outside close, and reduced-motion behavior.
- Preserve reader-scoped theme independence from global app theme.
- Coordinate with CSS split so reading-mode tokens and selectors live in the
  reader style subsystem.

Acceptance checks:

- Reader preference tests cover localStorage parsing, invalid values, defaults,
  DOM application, font-scale stepping, and bootstrap script output.
- Manual smoke confirms no flash of wrong reader theme/font before hydration.

Suggested issue split:

1. Extract/test reader preference schema and bootstrap script helper.
2. Extract `ReaderDisplayPanel` and toolbar integration.
3. Move reader preference CSS into the reader style subsystem.

### REF-056 — Package PWA service worker, offline reader, cache versions, and offline download flow

Priority: P1. Area: PWA/offline runtime.

Problem: PWA/offline behavior spans `public/sw.js`, `public/offline-reader.html`,
`public/offline.html`, `src/lib/cache-version.ts`, `src/lib/offline-db.ts`,
`OfflineDownloadButton`, `OfflineSyncIndicator`, and `ServiceWorkerRegister`.
The service worker cannot import TypeScript, so constants are manually mirrored.
The static offline reader also duplicates IndexedDB names/expiry/store behavior
and currently opens the offline database with version `1` while the app uses
version `2`.

Best strategy: create a PWA/offline runtime package and add a build/test step
that keeps service-worker/offline static assets aligned with TypeScript sources.

Detailed requirements:

- Define offline runtime constants once: cache version/name, IndexedDB database
  name/version/store names, mutation sync tag/message names, article expiry,
  and offline payload version.
- Because `public/sw.js` and `offline-reader.html` are static, introduce either
  code generation, a checked constants manifest, or tests that parse the static
  files and compare constants to TypeScript.
- Fix IndexedDB version drift in `offline-reader.html` so it can open the same
  DB version as `offline-db.ts`.
- Extract offline reader rendering/storage logic where possible; if it must stay
  static, keep it minimal and generated/test-verified.
- Keep authenticated pages network-only in the service worker; never cache
  private SSR/API responses.
- Preserve sign-out/account deletion cache purge behavior.
- Keep push notification and background sync handlers low-risk and tested.

Acceptance checks:

- Tests fail when SW cache version, IndexedDB version, sync tag, or store names
  drift from TypeScript constants.
- Offline article download, offline reader fallback, stale content refresh, cache
  purge, push click, and background sync smoke paths still work.
- Private authenticated HTML/API responses are not cached.

Suggested issue split:

1. Add PWA constants manifest/tests and fix offline-reader DB version drift.
2. Extract/generate service-worker constants and static offline reader data.
3. Add service-worker behavior tests or Playwright offline smoke coverage.

### REF-057 — Define UI primitive contracts and overlay/focus behavior tests

Priority: P2. Area: design system/components.

Problem: The UI primitive layer (`Button`, `Card`, `Input`, `Select`, `Textarea`,
`Field`, `Sheet`, `Popover`, `Tooltip`, `SegmentedControl`, badges, `Switch`,
`Skeleton`, `Spinner`) is growing organically. Several primitives implement
accessibility-sensitive behavior such as focus traps, roving tabindex, Escape
handling, outside clicks, live regions, and variant classes, but there are no
component-level contracts or shared interaction tests.

Best strategy: turn `src/components/ui` into a documented design-system package
with stable public API, accessibility contracts, and focused tests for
interaction primitives.

Detailed requirements:

- Document each primitive's controlled/uncontrolled model, required labels,
  keyboard behavior, focus behavior, and styling variants.
- Add tests for `Sheet`: initial focus, Tab trap, Shift+Tab trap, Escape close,
  scrim close, focus restoration, and empty-focusable case.
- Add tests for `Popover`: outside click, Escape close, focus restoration, and
  arrow navigation for menuitem/option children.
- Add tests for `SegmentedControl`: roving tabindex, arrow/Home/End behavior,
  controlled value updates, and live announcements.
- Keep class-variance-authority variant exports stable for existing consumers.
- Coordinate with CSS/style split so primitives rely on tokens/utilities, not
  feature-specific global selectors.

Acceptance checks:

- UI primitive tests cover keyboard and screen-reader critical behavior.
- Existing component imports continue to work through `src/components/ui/index.ts`.
- New feature components prefer primitives over hand-rolled overlay/focus code.

Suggested issue split:

1. Write UI primitive API/contract documentation.
2. Add interaction tests for Sheet/Popover/SegmentedControl.
3. Audit feature components for hand-rolled overlay/focus behavior and migrate
   where primitives are sufficient.

### REF-058 — Consolidate listing card, load-more, and post-navigation sync patterns

Priority: P1. Area: listings/cards/client hydration.

Problem: Listing UIs repeat similar patterns across `CategoryBrowser`,
`ForYouFeed`, `PersonalImports`, dashboard rails, `ArticleCardView`,
`ListingProgressSync`, `ListingBookmarkSync`, `CardBookmarkButton`, and
`ListPickerPopover`. Load-more state, duplicate filtering, progress maps,
saved-state maps, live announcements, retry UI, DOM selector hooks, and
sessionStorage-based changed-id sync are implemented separately.

Best strategy: create a listing/card UI subsystem with reusable load-more state,
card state hydration, and post-navigation sync adapters.

Detailed requirements:

- Extract a generic `useLoadMoreList` hook that handles offset, loading guard,
  error, append/dedupe, hasMore, and live announcements.
- Keep endpoint-specific response mapping explicit for feed, category browse,
  and personal imports.
- Replace direct DOM selector sync with a more React-friendly state update where
  practical; if DOM hooks remain for server-rendered cached pages, formalize the
  DOM contract in one module.
- Keep `ArticleCardView` data attributes/classes stable until sync components
  are migrated.
- Extract bookmark/progress post-navigation changed-id tracking into reusable
  adapters.
- Preserve SSR first paint correctness and batch refresh behavior; no N+1
  refreshes.

Acceptance checks:

- Existing browse, feed, imports, bookmarks, progress, and listing tests pass.
- Load-more behavior is consistent across category browse, For You feed, and
  personal imports.
- Bookmark/progress state remains correct after visiting reader pages and
  returning to cached listings.

Suggested issue split:

1. Extract load-more hook and migrate one listing.
2. Formalize progress/bookmark sync contract and adapters.
3. Migrate remaining listing components and simplify card sync code.

### REF-059 — Split dashboard, progress, and marketing pages into section components and view models

Priority: P2. Area: page composition/product UI.

Problem: Several page files contain substantial local section/widget logic.
`dashboard/page.tsx` fetches many read models and renders identity, onboarding,
level banner, due-review CTA, progress widgets, continue-reading rail, For You
feed, and browse CTA. `progress/page.tsx` defines local chart/stat components
and renders multiple analytics sections. `app/page.tsx` owns marketing copy
arrays and all landing sections. These files are readable but hard to evolve or
test at the section level.

Best strategy: split page data loading/view-model construction from section
components, keeping pages as composition roots.

Detailed requirements:

- Extract dashboard data loading into a typed view model: user identity,
  progress widgets, due review, continue reading, feed, topics/new-user flags,
  bookmarks/progress maps.
- Extract dashboard sections: identity card, due review CTA, progress band,
  continue reading rail, For You section, browse CTA.
- Extract progress page local components (`MiniBar`, `WeeklyBars`, `StatCard`)
  into reusable analytics widgets if they are used or planned elsewhere.
- Extract progress page section components: overview, reading activity,
  vocabulary, quiz trend, level distribution, heatmap, timeline.
- Move marketing landing copy/content arrays into a feature-owned content module
  and keep section components small.
- Preserve server component data-fetch parallelism and metadata.

Acceptance checks:

- Existing dashboard/progress/landing smoke tests pass.
- Section components can be rendered with fixture view models without database
  access.
- Page files become thin orchestration/composition roots.

Suggested issue split:

1. Extract dashboard view model and sections.
2. Extract progress analytics widgets and sections.
3. Extract marketing landing content and sections.

### REF-060 — Centralize route protection, security headers, CSP, and deployment runtime policy

Priority: P1. Area: runtime/deployment/security configuration.

Problem: Runtime policy is hand-maintained across `middleware.ts`,
`next.config.ts`, `Dockerfile`, `docker-entrypoint.sh`, Playwright config,
package scripts, and docs. Protected route prefixes and middleware matcher lists
are duplicated. Security headers/CSP include inline/eval allowances for Next and
no-flash scripts. Dockerfile comments list env vars that can drift from
`src/lib/config.ts` / `.env.example`. Playwright defines its own local runtime
env defaults.

Best strategy: create a runtime policy/config package and lightweight tests that
keep route protection, headers, deployment env docs, and smoke-test env aligned.

Detailed requirements:

- Define protected route prefixes and middleware matchers from one source, or
  add a test that verifies they are consistent.
- Align protected route definitions with app shell navigation and route groups;
  intentional protected routes not in nav should be documented.
- Extract security header/CSP definitions into a tested module or add header
  contract tests for required directives.
- Track inline script requirements explicitly; if CSP nonces are introduced,
  plan migration for theme and reader no-flash scripts.
- Keep Dockerfile runtime env documentation aligned with runtime config docs and
  `.env.example`.
- Keep Playwright smoke env defaults aligned with local optional-provider
  graceful degradation.
- Preserve production standalone output and Prisma migration entrypoint behavior.

Acceptance checks:

- Tests catch drift between protected prefixes and middleware matcher entries.
- Header tests verify CSP, HSTS production gating, image remote patterns, and
  server external packages where feasible.
- Docker/Playwright docs/config remain consistent with runtime config validation.

Suggested issue split:

1. Extract/test protected route and matcher policy.
2. Extract/test security header policy.
3. Audit Docker/Playwright/runtime env docs for drift.
4. Plan CSP nonce migration separately if needed.

### REF-061 — Reduce static/generated data and client bundle risk for word-frequency data

Priority: P3. Area: performance/data packaging.

Problem: `src/data/word-frequency-data.ts` is a 1,326-line static dataset and
was repeatedly the largest TypeScript source file in scans. Static data is not
automatically bad, but large hand-maintained TS data can increase bundle/build
costs and makes accidental edits hard to review.

Best strategy: treat word-frequency data as generated/reference data with a
clear loading boundary and tests around consumers.

Detailed requirements:

- Identify every import path for word-frequency data and whether it reaches
  client bundles.
- If client-bundled, consider a compressed/generated JSON artifact, lazy import,
  server-only lookup, or smaller tier map depending on UX needs.
- Mark the data file as generated or move it under a data artifact directory
  with a generation/update script.
- Add tests for frequency tier lookup behavior rather than snapshotting the
  whole data file.
- Avoid adding runtime network dependency for frequency lookup.

Acceptance checks:

- Bundle impact is understood before and after any change.
- Frequency badges/tiers behave identically for representative common, mid, and
  rare words.
- Future data updates are reviewable as generated artifact changes.

Suggested issue split:

1. Audit imports and bundle impact.
2. Decide generated artifact vs lazy/server-only strategy.
3. Add/update generation script and consumer tests.

### REF-062 — Split reader study panels into data hooks, interaction state, and presentational components

Priority: P1. Area: reader study tools.

Problem: Reader study panels still have dense client components outside the
larger WordLookup/Tutor/Pronunciation refactors. `ArticleVocabulary` owns lazy
vocabulary fetch, fallback/error/loading states, save/unsave mutation, frequency
badges, and list rendering. `ArticleQuiz` owns lazy quiz/history fetch, answer
state, client-side score display, idempotent attempt POST, offline queueing,
history rendering, best/new-best UI, and relative date formatting. `ArticleDictation`
owns narration warming, sentence segmentation, playback controls, typed input,
grading, sentence navigation, and result display.

Best strategy: create a reader study-tools package with shared lazy panel data
hooks, tool-state primitives, and presentational components per tool.

Detailed requirements:

- Extract `useArticleVocabularyPanel` for fetch, fallback/error/loading, and
  save/unsave state; keep list rendering separate.
- Extract `useArticleQuizPanel` or reducer for quiz load, history load, answers,
  submit, idempotency key, offline queued attempt, saved note, and retry/reset.
- Extract `useDictationPanel` for narration warm/load, sentence segments,
  play/stop, typed text, grading, and navigation.
- Share common reader-tool states: loading, unavailable/fallback, empty, error,
  AI badge, retry copy, and aria-live announcements.
- Preserve offline queue semantics for quiz attempt replay and idempotency.
- Preserve server-side grading as authoritative; client score remains only an
  immediate display.
- Coordinate CSS with REF-001 and reader tools surface from earlier rounds.

Acceptance checks:

- Existing vocabulary, quiz, quiz mastery, dictation, offline sync, and reader
  route tests pass.
- Each panel can be tested with mocked API hooks without mounting the whole
  reader tools surface.
- Manual smoke covers vocabulary save/unsave, quiz submit/offline queue/history,
  and dictation play/check/reset.

Suggested issue split:

1. Extract vocabulary panel hook/components.
2. Extract quiz reducer/hook/components.
3. Extract dictation hook/components.
4. Consolidate common reader-tool fallback/loading UI.

### REF-063 — Create shared route segment loading, error, and not-found states

Priority: P2. Area: Next.js route UX/error states.

Problem: Route segment state files repeat similar layouts and behavior. Many
`error.tsx` files POST client errors, show a friendly heading, optional digest,
Try again button, and Back to dashboard link. Many `loading.tsx` files repeat
skeleton card/page shell structures. `not-found.tsx` files repeat small empty
states. Error reporting is covered elsewhere, but segment-state UI and skeleton
contracts are still duplicated.

Best strategy: create shared route-state components and segment-specific copy
configuration while preserving Next.js route file requirements.

Detailed requirements:

- Add reusable components for route error screens, compact reader error screens,
  loading page shells, listing skeletons, reader skeletons, and not-found states.
- Keep each route's `error.tsx`, `loading.tsx`, and `not-found.tsx` as thin
  wrappers because Next.js requires file-based exports.
- Integrate with the shared client error reporter from REF-015; no segment file
  should hand-roll `/api/client-errors` POST payloads after migration.
- Preserve page-specific titles, descriptions, icons, primary/secondary actions,
  and digest display.
- Keep loading skeletons visually consistent with their real page layout.
- Avoid importing server-only code into client `error.tsx` files.

Acceptance checks:

- Existing route error/loading smoke tests pass.
- Grep shows repeated client-error POST snippets removed from segment errors.
- Loading states render without hydration warnings and match page shells.

Suggested issue split:

1. Extract shared error/not-found/loading components.
2. Migrate app route-group errors and loading states.
3. Migrate admin and reader-specific segment states.
4. Add route-state render tests or Playwright smoke coverage.

### REF-064 — Consolidate authentication provider setup, sign-in UX, and profile bootstrap

Priority: P2. Area: auth/onboarding/profile.

Problem: Authentication and first-profile setup are split across `auth.ts`, the
NextAuth route, sign-in page/buttons, middleware session cookie checks, profile
route, settings/onboarding forms, and profile helpers. Provider setup is env
driven and graceful, first created user becomes Admin, sign-in error mapping
lives in the page, and profile parsing/upsert behavior lives in `profile.ts` and
route glue.

Best strategy: create an auth/profile onboarding package with provider config,
sign-in view model, profile schema, and bootstrap policies.

Detailed requirements:

- Move OAuth provider construction behind an auth provider registry that reads
  runtime config and exposes provider metadata for the sign-in UI.
- Keep CJS/ESM provider interop encapsulated in one module.
- Centralize session cookie names so middleware and NextAuth config cannot
  drift.
- Extract sign-in error code mapping and callbackUrl sanitization into testable
  helpers.
- Move profile input schema/parsing into a profile schema module shared by
  onboarding, settings, and `/api/profile`.
- Keep first-user Admin bootstrap explicit and tested.
- Preserve optional-provider behavior: missing OAuth config shows no provider
  button and does not break local/test environments.

Acceptance checks:

- Existing auth provider, profile route, onboarding, settings, middleware, and
  sign-in tests pass.
- Middleware session cookie list and NextAuth cookie names are verified by a
  shared constant or drift test.
- Sign-in UI only renders configured providers.

Suggested issue split:

1. Extract auth provider registry and session cookie constants.
2. Extract sign-in view model/error helpers.
3. Extract shared profile schema and migrate onboarding/settings/profile route.
4. Add first-user bootstrap tests.

### REF-065 — Unify seed, E2E fixtures, and safe database reset helpers

Priority: P2. Area: seed/test data/developer workflows.

Problem: Seed and fixture creation is split across `src/lib/seed.ts`,
`scripts/seed.ts`, `e2e/support/seed.ts`, and many tests. The production seed
path discovers/scrapes/enriches provider content; E2E seed resets a database and
creates fixed article/user/session rows; scripts parse their own flags. These
flows share article fixture shape, user/profile/session setup, safe database
guards, and provider/enrichment assumptions but do not share a fixture factory.

Best strategy: create seed/fixture modules with clear separation between
production-like scraping seed, deterministic local fixtures, and safe database
reset guards.

Detailed requirements:

- Extract article/user/profile/session fixture builders that tests and E2E seed
  can reuse.
- Keep production-like scraper seed separate from deterministic fixture seed.
- Centralize safe database reset guards so destructive cleanup cannot run
  against production-like URLs.
- Keep provider/enrichment seed idempotent and dependency-injected for tests.
- Keep E2E session cookie setup aligned with NextAuth cookie constants from
  REF-064.
- Avoid putting secrets or real user data in seed fixtures.

Acceptance checks:

- Existing seed, e2e smoke, account/admin tests, and fixture-dependent tests
  pass.
- E2E reset refuses unsafe database URLs.
- Fixture builders make it easy to create public/private/org/classroom article
  scenarios without copy-pasted Prisma setup.

Suggested issue split:

1. Extract deterministic fixture builders.
2. Extract safe reset guards and migrate E2E seed.
3. Keep scraper/enrichment seed as a separate production-like path.
4. Migrate high-duplication tests to fixture builders.

### REF-066 — Split worker runtime loop from job handlers and dispatch registry

Priority: P1. Area: worker/runtime/jobs.

Problem: `src/lib/worker.ts` sits above the durable job queue and mixes worker
identity generation, abortable sleep, polling loop, job claim/start/complete/fail
calls, default job-type handlers, article processing handler construction,
push-reminder no-op behavior, stats, tracing, metrics, error capture, logging,
and dependency injection. The job queue refactor covers persistence, but worker
runtime and job handler dispatch are distinct concerns.

Best strategy: split worker runtime, handler registry, and per-job handlers,
while preserving `runJobWorker` as the public entry point during migration.

Detailed requirements:

- Extract worker loop/runtime concerns: polling, abort handling, sleep, stats,
  stop conditions, and logging lifecycle.
- Extract a `JobHandlerRegistry` keyed by `JobType` with explicit default
  handlers and testable registration/override behavior.
- Move article processing handler into a processing job adapter that validates
  payloads and maps processor results to retry/permanent `JobError`s.
- Decide whether `PUSH_REMINDER` should remain a no-op handler or dispatch to
  the reminder pipeline; document current behavior clearly.
- Keep metrics/tracing/error capture emitted at the same lifecycle points.
- Keep dependency injection for tests.

Acceptance checks:

- Existing worker/job-worker/jobs/admin-job tests pass.
- Worker once mode, polling mode, abort during sleep, abort during handler,
  missing handler, validation failure, transient processor failure, dead-letter,
  and success paths remain covered.

Suggested issue split:

1. Extract worker runtime loop and stats.
2. Extract handler registry and article processing handler.
3. Revisit push reminder handler behavior with tests/docs.
4. Keep `runJobWorker` facade stable until scripts migrate.

### REF-067 — Package AI output validation, moderation, and provider error classification

Priority: P2. Area: AI safety/output contracts.

Problem: AI output safety rules are split across `ai/validation.ts`,
`ai/moderation.ts`, provider error classification in `ai/provider.ts`, and
feature-specific parsers. Structured validators recover JSON arrays and validate
vocabulary/quiz/tags; moderation screens free-text outputs; provider errors
normalize retry/fallback behavior. These are all AI safety/output contracts but
are not packaged together.

Best strategy: create an AI safety/output package that owns structured-output
validators, text moderation, provider error classification, and test fixtures.

Detailed requirements:

- Keep structured validators strict and fence-tolerant: recover JSON arrays but
  drop malformed/duplicate/invalid entries and never coerce unsafe data.
- Move validators into feature-specific modules under an AI output package while
  keeping public exports stable.
- Keep moderation provider-agnostic and heuristic by default; optional remote
  moderation should be an adapter behind the same interface.
- Keep provider error classification low-cardinality and content-free.
- Ensure no prompt/response content is logged by validators, moderation, or
  provider error classifiers.
- Align validator fixtures with AI eval datasets where useful.

Acceptance checks:

- Existing AI validation, AI safety, AI provider, AI eval, vocabulary, quiz,
  tags, grammar, and tutor tests pass.
- Malformed JSON/prose/fenced output/empty output/duplicates are covered for
  every structured validator.
- Moderation fallback paths do not persist unsafe generated text.

Suggested issue split:

1. Extract structured validators into an AI output package.
2. Extract moderation interface and heuristic adapter.
3. Move provider error classification helpers into safety/output contracts or a
   provider runtime module.
4. Add shared fixtures used by validators and evals.

### REF-068 — Split user profile preferences from onboarding and settings UI

Priority: P2. Area: profile/preferences UX.

Problem: User profile data (age range, gender, English level, topics, daily
goal, timezone/onboarding state) is parsed in `profile.ts`, edited in onboarding
and settings forms, consumed by dashboard/feed/leveling/streaks, and partly
overlaps with reminder and reader preferences. Onboarding and settings UI use
similar topic/level/daily-goal behavior but do not share a profile preference
view model.

Best strategy: create a profile/preferences subsystem with shared schema,
domain commands, and UI field components for onboarding/settings.

Detailed requirements:

- Extract profile value definitions and labels: age ranges, genders, CEFR
  levels, level hints, daily-goal bounds, topic validation.
- Share a normalized profile input schema across onboarding, settings, and
  `/api/profile`.
- Extract reusable topic selector and daily-goal stepper components where UI
  behavior matches.
- Keep level-history recording explicit when English level changes.
- Keep reminder preferences and reader display preferences separate but document
  how they relate to profile timezone/learning preferences.
- Coordinate legacy `Profile.topics` JSON-string cleanup with REF-009.

Acceptance checks:

- Existing profile, onboarding, settings, level history, feed, and recommendation
  tests pass.
- Profile schema tests cover invalid topics, invalid level, invalid demographic
  values, daily-goal bounds, and optional fields.
- Onboarding/settings forms remain accessible and preserve current copy.

Suggested issue split:

1. Extract profile schema/value definitions.
2. Extract shared topic selector/daily-goal UI components.
3. Migrate onboarding/settings/profile route.
4. Document boundaries with reminder and reader preferences.

### REF-069 — Govern Prisma schema parity, migrations, and generated database artifacts

Priority: P1. Area: database/schema governance.

Problem: `prisma/schema.prisma` and `prisma/postgresql/schema.prisma` are both
large and intended to express the same production/domain model across SQLite and
PostgreSQL. The schemas contain many durable domain decisions in comments
around visibility, audit retention, jobs, AI ledger, analytics, mastery,
content governance, media storage, and tenancy. Keeping schema intent, indexes,
enum mappings, migrations, docs, and tests aligned is currently a manual
process.

Best strategy: create a database schema governance workflow with parity checks,
schema-intent documentation, and migration test utilities.

Detailed requirements:

- Add automated checks that compare SQLite and PostgreSQL schemas for model,
  enum, field, relation, index, uniqueness, cascade, and comment-intent parity
  where feasible.
- Keep provider-specific differences explicit and documented rather than
  accidental.
- Ensure migrations are committed with schema changes and include both local and
  PostgreSQL intent when production parity is affected.
- Move long domain comments that are better maintained in docs into docs while
  keeping concise schema comments for easy local context.
- Add a schema-change checklist covering cascades, private/org visibility,
  audit retention, analytics retention, generated media, and seed/test data.
- Avoid committing/generated local database artifacts as source-of-truth; keep
  backups/dev DB files out of future schema reasoning.

Acceptance checks:

- A schema parity test or script fails on unintentional model/index/enum drift.
- Existing database, PostgreSQL integration, visibility, cascade, audit,
  analytics, and storage migration tests pass.
- Docs/database and schema comments stay aligned after model changes.

Suggested issue split:

1. Add schema parity inspection script/test.
2. Add migration/schema-change checklist docs.
3. Move oversized schema commentary into durable docs where appropriate.
4. Audit generated/local DB artifacts and ignore/delete non-source files.

### REF-070 — Generate and maintain an API contract/catalog for route handlers

Priority: P2. Area: API contracts/developer experience.

Problem: The app has many API route handlers under `src/app/api/**/route.ts`.
They mostly use `createHandler` with validation schemas, but request/response
shapes, pagination conventions, error status contracts, capability requirements,
public/session/admin auth modes, and idempotency headers are spread across route
files and tests. There is no API catalog to guide clients, tests, or future
refactors.

Best strategy: build a lightweight internal API catalog derived from route
metadata and feature-owned schemas. Do not introduce a heavy public API surface
unless product requirements call for it.

Detailed requirements:

- Define a route metadata convention: auth mode, capability, method, params
  schema, query schema, body schema, response summary, idempotency headers, and
  notable status codes.
- Keep the shared `api-handler` wrappers as the execution layer; the catalog is
  documentation/contract metadata, not a second router.
- Generate docs or a JSON artifact that test helpers can consume for smoke
  coverage and route inventory.
- Capture pagination conventions consistently (`offset`, `limit`, `page`,
  `hasMore`, `totalPages`) and identify intentional differences.
- Mark non-JSON routes explicitly: speech audio, account export download,
  metrics Prometheus, auth NextAuth route, etc.
- Keep sensitive routes documented by capability, not by hiding them.

Acceptance checks:

- Route inventory tests catch orphan route files without metadata once the
  convention is adopted.
- Existing route tests continue to call handlers directly with `Request` and
  promised `params`.
- Generated catalog excludes secrets, credentials, prompts, article text, and
  user-private content.

Suggested issue split:

1. Define API route metadata convention and pilot on a small route group.
2. Generate internal route catalog artifact/docs.
3. Migrate high-value route groups: reader, admin, bookmarks/lists, imports.
4. Add route inventory drift tests.

### REF-071 — Organize the refactoring backlog into epics, themes, and issue-generation workflow

Status: resolved in #508 (2026-06-25). Theme index, dependency map, overlap
cross-links, issue-generation workflow, closing/superseding process, and export
script (`scripts/export-backlog.ts`) added above.

Priority: P1. Area: planning/developer workflow.

Problem: `docs/refactoring.md` has grown into a large planning backlog with many
issue-shaped candidates. It is valuable, but as a single flat list it will
become harder to prioritize, de-duplicate, assign ownership, and convert into
GitHub epics/issues. Several items overlap by design because they were found in
different analysis passes.

Best strategy: turn the backlog into a structured refactoring program document
with themes, dependencies, priority tiers, and an issue-generation checklist.

Detailed requirements:

- Add a taxonomy by subsystem/theme: platform, API, AI, reader, learning,
  content ingestion, data/schema, observability, frontend/design system, tests,
  operations.
- Add dependency links between candidates (for example, client fetch before UI
  form migrations; processing feature registry before backfill split).
- Add a deduplication pass that merges or cross-links overlapping candidates
  while preserving detailed requirements.
- Add fields useful for issue creation: owner area, risk, expected PR sequence,
  validation scope, docs impact, migration impact, and compatibility-removal
  gate.
- Keep detailed candidate text source-controlled; avoid moving all planning into
  external tools without a generated/source-of-truth path.
- Add a process for closing or superseding candidates after refactors land.

Acceptance checks:

- The refactoring document can generate or manually seed epic/issues without
  re-analysis.
- Every candidate has a theme, priority, validation plan, and dependency notes.
- Duplicate/overlapping candidates are either merged or explicitly cross-linked.

Suggested issue split:

1. Add theme/dependency index to `docs/refactoring.md`.
2. Run a deduplication/cross-link pass over all REF items.
3. Add issue-generation checklist/template.
4. Optionally add a small script to export candidates to CSV/JSON for planning.

### REF-072 — Create a content transformation and HTML safety pipeline

Priority: P1. Area: content safety/rendering pipeline.

Problem: Scraped/stored article HTML is transformed in several places:
provider cleanup before extraction, optional scraper HTML normalization,
strict sanitization, article HTML-to-reader-text conversion, bilingual paragraph
splitting/alignment, offline reader rendering, highlight anchoring, TTS/dictation
plain-text alignment, and metadata descriptions. Each step has its own safety
assumptions and tests, but there is no single documented transformation
pipeline.

Best strategy: define a content transformation subsystem that owns the sequence
from raw provider HTML to sanitized stored HTML to reader text/paragraphs and
offline rendering.

Detailed requirements:

- Document and codify each stage: raw HTML, optional normalization, provider
  cleanup, extraction, strict sanitization, stored article HTML, reader text,
  paragraphs, offline payload.
- Keep `sanitizeArticleHtml` as the only authoritative stored/rendered HTML
  sanitizer.
- Move HTML entity decoding and reader-text conversion into the content pipeline
  rather than translation-specific naming.
- Ensure offline reader rendering only uses sanitized stored HTML.
- Ensure highlight anchors, TTS alignment, dictation segments, metadata
  descriptions, and bilingual paragraph alignment use the same canonical reader
  text basis where intended.
- Add fixture tests that start from raw HTML and assert final sanitized HTML,
  reader text, paragraph splits, and anchor stability.

Acceptance checks:

- Existing sanitize, scraper cleanup/normalize, bilingual, highlights,
  speech-timing, offline reader, and reader security tests pass.
- No feature renders stored/scraped HTML without passing through the pipeline.
- Content pipeline docs explain which transformations are security boundaries.

Suggested issue split:

1. Document pipeline stages and move reader text converter into content module.
2. Add end-to-end HTML fixture tests.
3. Migrate consumers to canonical content transformation imports.
4. Remove legacy content conversion aliases through REF-009.

### REF-073 — Standardize external HTTP clients, timeouts, retries, and network safety policy

Priority: P2. Area: network/platform safety.

Problem: External network access appears in multiple subsystems: scraper fetch
with SSRF pinning and byte limits, robots.txt fetch, dictionary API lookup,
Azure OpenAI provider, Azure Speech token/synthesis, web push delivery, OAuth
providers, and media storage. Each has its own timeout, retry, logging, and
safety policy. Some requests require SSRF protection; others must not use it
because they target trusted provider endpoints.

Best strategy: define a network policy layer with explicit client categories
rather than one generic fetch wrapper for everything.

Detailed requirements:

- Define external client categories: untrusted user-supplied URLs, trusted
  provider APIs, public dictionary API, object storage, OAuth/auth providers,
  push gateways.
- Keep SSRF/DNS pinning mandatory for untrusted user/provider scrape URLs and
  unnecessary for fixed trusted API origins.
- Standardize timeout defaults and error normalization per category.
- Keep response size limits for scraper/content fetches.
- Ensure logs include only low-cardinality endpoint/provider metadata, never
  credentials, full URLs with sensitive query strings, article text, prompts, or
  responses.
- Add tests for SSRF private ranges, DNS failures, redirects/pinning where
  applicable, timeout behavior, and provider retry hints.

Acceptance checks:

- Existing scraper limits/SSRF/robots/dictionary/AI provider/push/storage tests
  pass.
- New external clients must choose a network policy category.
- User-supplied URLs cannot bypass SSRF protection.

Suggested issue split:

1. Document network policy categories and map existing clients.
2. Extract shared timeout/error helpers where safe.
3. Add policy tests for untrusted URL fetches and trusted provider clients.
4. Migrate external clients incrementally.

### REF-074 — Centralize product copy, metadata, notification text, and localization readiness

Priority: P3. Area: product copy/localization.

Problem: User-facing copy is hard-coded across pages, components, route errors,
metadata, push notifications, offline static pages, marketing sections, empty
states, settings/onboarding forms, admin pages, and tests. Supported translation
target languages are separate from UI localization. This is fine for an
English-only MVP, but it makes copy review, localization readiness, and
consistent terminology harder as the product grows.

Best strategy: create a copy/content registry by domain, not a full i18n system
unless product requirements demand it. Keep learner-facing English copy easy to
review and reuse.

Detailed requirements:

- Inventory repeated product terms and copy: ReadWise, AI tutor, practice tools,
  For You, Picks, saved words, offline, CEFR labels, import, admin actions.
- Move high-change marketing and onboarding copy into content modules.
- Move route error/empty-state copy into route-state configs once REF-063 lands.
- Move push notification text and offline static page copy into a PWA copy
  module or generated static asset inputs.
- Keep AI prompts separate from UI copy; prompt text has its own versioning.
- Keep supported translation target languages separate from UI localization
  until a real localization project starts.
- Add terminology guidelines so future copy uses consistent names.

Acceptance checks:

- Landing, onboarding, settings, dashboard, reader tools, push reminders, and
  offline pages keep current copy after extraction.
- Copy changes can be reviewed in domain content modules rather than scattered
  through large UI components.
- No secrets or private user content are placed in copy registries.

Suggested issue split:

1. Inventory repeated product terms and define terminology guidelines.
2. Extract marketing/onboarding/settings copy modules.
3. Extract route-state/offline/push copy after related refactors.
4. Decide whether full i18n is in scope later.

### REF-075 — Consolidate legal/static pages, metadata, and manifest content governance

Priority: P3. Area: static content/compliance.

Problem: Static product and legal content lives across `privacy`, `terms`,
`manifest`, root metadata, landing metadata, offline pages, OpenGraph/Twitter
metadata, icon references, and deployment docs. These files are small, but they
carry compliance and product-positioning content that can drift from feature
docs and actual behavior.

Best strategy: treat static/legal/product metadata as governed content with
owners, review checklist, and shared metadata helpers.

Detailed requirements:

- Add a static content inventory for legal pages, app manifest, metadata, offline
  pages, and marketing claims.
- Extract shared site metadata constants: product name, default title template,
  description, icon paths, social copy, and app URLs.
- Keep legal copy versioned and reviewed when data collection, analytics,
  storage, AI providers, push notifications, or offline behavior changes.
- Keep manifest/offline page descriptions aligned with actual feature set.
- Avoid duplicating claims like supported sources/providers if provider lists
  are code-governed elsewhere.

Acceptance checks:

- Metadata/manifest/offline/legal pages stay consistent with docs and runtime
  behavior after feature changes.
- A checklist identifies when legal/static content must be reviewed.
- Existing page metadata and manifest tests/smoke checks continue to pass.

Suggested issue split:

1. Inventory static/legal/metadata content and owners.
2. Extract shared site metadata constants.
3. Add static content review checklist tied to feature/docs changes.

### REF-076 — Enforce client/server import boundaries and package layering

Priority: P1. Area: architecture/tooling/client-server safety.

Problem: The codebase relies on convention to keep client components from
importing server-only modules and to keep feature modules from reaching across
layers. Many files are marked `"use client"`, while server routes/pages import
low-level modules such as Prisma, auth, metrics, audit, and runtime config
directly where needed. Today there is no automated rule that prevents a future
client component from importing a server-only module or a feature UI from
depending on implementation details.

Best strategy: introduce explicit module boundary conventions and lightweight
lint/static checks for client-safe, server-only, feature, and platform modules.

Detailed requirements:

- Classify modules into boundaries: client-safe utilities, client components,
  server-only services, API route glue, Prisma repositories, platform/runtime,
  and feature packages.
- Add server-only/client-safe marker conventions where useful, such as
  `server-only` imports in modules that must never enter client bundles.
- Add lint or custom static checks for forbidden imports:
  - client files cannot import Prisma, auth/session guards, Node APIs, logger,
    metrics, tracing, audit, runtime config, or server storage adapters;
  - domain UI should prefer feature APIs/read models instead of low-level Prisma
    modules;
  - scripts should not accidentally import client components.
- Keep `@/*` imports as the project convention, but make package boundaries
  visible through folders/barrels.
- Document legitimate exceptions, especially Next.js route/page files that are
  server components by default.

Acceptance checks:

- A boundary check fails on a fixture client component importing `@/lib/prisma`.
- Existing build/typecheck/lint pass after current intentional imports are
  classified or exempted.
- New feature packages have clear client/server entry points.

Suggested issue split:

1. Define boundary taxonomy and server/client-safe markers.
2. Add static import-boundary checks with initial allowlist.
3. Migrate obvious direct imports to feature barrels/read models.
4. Tighten allowlist as refactors land.

### REF-077 — Centralize browser storage keys and client persistence contracts

Priority: P2. Area: client state/browser storage.

Problem: Browser storage keys and message names are scattered across many
modules: global theme, reader preferences, sidebar collapsed state, reader tools
last tab, bilingual settings, translation language, visited article IDs, reader
referrer, bookmark changes, welcome/hint dismissal, level recommendation
dismissal, offline mutation sync messages, and service-worker purge messages.
Each helper handles unavailable storage slightly differently.

Best strategy: create a client storage contract module that registers keys,
scopes, payload schemas, privacy level, expiry, and purge behavior.

Detailed requirements:

- Define a registry for localStorage/sessionStorage keys and service-worker
  message names, including owner subsystem and payload shape.
- Provide typed safe read/write helpers for common JSON payloads and string
  flags, with consistent try/catch behavior for private mode/quota errors.
- Mark privacy-sensitive keys and ensure sign-out/account deletion purges the
  right local/session/offline data.
- Keep reader/offline storage versioning aligned with the PWA constants work.
- Avoid a one-size-fits-all abstraction for IndexedDB; this issue covers
  Web Storage and message contracts, not full offline DB storage.
- Document which keys are durable across sessions and which are tab/session
  scoped.

Acceptance checks:

- Grep finds browser storage keys declared in the registry or documented
  exceptions.
- Existing theme, reader prefs, sidebar, bilingual, translation language,
  bookmark/progress sync, welcome hints, and level banner behavior remains
  unchanged.
- Account deletion/sign-out tests cover storage/cache purge expectations.

Suggested issue split:

1. Add browser storage/message registry and safe helpers.
2. Migrate simple string/flag keys.
3. Migrate JSON payload keys and sessionStorage sync helpers.
4. Tie privacy-sensitive keys into sign-out/account deletion purge flow.

### REF-078 — Unify keyboard shortcut registration, display, and focus interaction patterns

Priority: P2. Area: accessibility/keyboard UX.

Problem: `keyboard-shortcuts.ts` is a display-only list, while runtime keyboard
behavior is implemented in command palette, flashcard review, reader tools tab
bar, WordLookup selection shortcut, overlays, color swatches, inline note
editor, tutor composer, dictation form, and route/modal focus traps. Shortcut
display and actual handlers can drift, and focus-trap logic is partly shared but
still reimplemented in several overlays.

Best strategy: create a keyboard/focus interaction subsystem with a shortcut
registry, runtime binding helpers, focus-trap primitives, and tests.

Detailed requirements:

- Extend shortcut definitions to include optional runtime binding metadata,
  scope, disabled-when rules, and owning component.
- Keep global shortcuts centralized (`/`, `?`, Command/Ctrl+K, navigation chords)
  and avoid firing in text inputs unless explicitly intended.
- Keep feature-local shortcuts close to features but registered/documented in a
  way the shortcut modal can display accurately.
- Extract reusable roving tabindex helpers for tab bars, swatches, segmented
  controls, and listbox-like options where patterns match.
- Consolidate focus-trap behavior for nested overlays so Escape/Tab handling is
  predictable.
- Preserve accessibility semantics and avoid breaking screen-reader workflows.

Acceptance checks:

- Shortcut modal entries correspond to runtime behavior or are explicitly marked
  reference-only.
- Tests cover global shortcut suppression in inputs, command palette open,
  keyboard shortcuts modal, reader tools tab arrows, flashcard grading keys,
  and nested overlay Escape behavior.

Suggested issue split:

1. Add shortcut registry metadata and audit runtime handlers.
2. Extract scoped shortcut binding helper.
3. Extract roving/focus helpers and migrate repeated patterns.
4. Update shortcut modal from registry data.

### REF-079 — Consolidate TypeScript/Node tooling, script loaders, and lint coverage

Priority: P2. Area: tooling/build/test scripts.

Problem: `package.json` scripts repeat long Node invocations with
`--env-file-if-exists`, `--experimental-strip-types`, custom `register-ts.mjs`,
and sometimes `--no-warnings` or test module mocks. `scripts/ts-resolve-hook.mjs`
implements path alias and extension resolution. ESLint currently ignores the
`scripts/` directory, even though operational scripts share app modules and can
break at runtime.

Best strategy: create a small tooling/runtime layer for Node TypeScript scripts
and bring scripts under lint/typecheck coverage safely.

Detailed requirements:

- Centralize the repeated Node runtime flags behind one documented npm script or
  helper command where practical.
- Keep custom resolver behavior tested: `@/*` alias, extensionless relative
  imports, package subpath retry behavior.
- Evaluate whether Node's native TypeScript support can replace any custom
  resolver logic over time; do not remove compatibility until scripts work.
- Bring `scripts/**/*.ts` and `scripts/**/*.mjs` under lint coverage with any
  necessary script-specific rules.
- Ensure operational scripts keep loading `.env` consistently and never print
  secrets on errors.
- Keep CI/docs aligned with package scripts.

Acceptance checks:

- All npm scripts still run with the same behavior.
- Resolver tests cover aliases and extensionless imports.
- ESLint includes scripts or has documented, narrow ignores.
- Typecheck covers scripts without forcing browser-only typings into Node-only
  scripts incorrectly.

Suggested issue split:

1. Add tests for the TS resolve hook and script runtime assumptions.
2. Centralize repeated Node flags or document why they remain per script.
3. Bring scripts into lint/typecheck coverage.
4. Simplify/remove resolver compatibility when safe.

### REF-080 — Govern public fonts, icons, and static asset usage

Priority: P3. Area: assets/performance/design system.

Problem: Public assets include OpenDyslexic fonts, icons, app icon SVG, offline
HTML pages, and service-worker assets. Font/icon usage is referenced from CSS,
metadata, manifest, offline pages, and UI components, but there is no asset
manifest, ownership policy, or bundle/performance check. Large or unused assets
can linger unnoticed.

Best strategy: create a static asset manifest and lightweight checks for usage,
size, caching, and metadata references.

Detailed requirements:

- Inventory public assets with owner, purpose, expected references, size, and
  cache behavior.
- Verify OpenDyslexic font usage is loaded only when needed or acceptable for
  the reading-font feature.
- Keep icon paths aligned across metadata, manifest, service worker,
  notifications, and offline pages.
- Add checks for missing referenced assets and unexpectedly large additions.
- Document how to update icons/fonts and when to regenerate platform assets.

Acceptance checks:

- Asset manifest matches files under `public/`.
- Tests or scripts detect missing icon/font references.
- Bundle/static size impact of fonts/icons is understood before changes.

Suggested issue split:

1. Add public asset inventory/manifest.
2. Add asset reference/size checks.
3. Audit OpenDyslexic loading strategy and icon references.

### REF-081 — Move page-level direct data access behind feature read models

Priority: P2. Area: server component data architecture.

Problem: Several server pages and API routes import low-level Prisma or domain
modules directly to fetch one-off fields, counts, feedback, or status rows.
This is sometimes pragmatic, but over time page components accumulate data
composition logic and bypass feature read models. Examples from scans include
reader page fetching difficulty feedback directly, study words page importing
Prisma, admin article pages fetching status/tag rows, and many pages combining
several domain reads inline.

Best strategy: create feature-owned page read models and reserve direct Prisma
access for repositories/services rather than page composition files.

Detailed requirements:

- Identify server pages with direct Prisma imports and classify whether each is
  a true repository use or a missing read model.
- Extract small read-model functions for page-specific data bundles where a page
  combines multiple related domain queries.
- Keep server component parallelism and avoid introducing N+1 queries.
- Preserve authorization by passing already-validated session/access contexts to
  read models.
- Keep page files focused on route params, auth/session, metadata, and component
  composition.
- Document exceptions for admin/debug pages where direct Prisma is acceptable.

Acceptance checks:

- Grep for `@/lib/prisma` in `src/app/**/page.tsx` trends downward or every
  remaining import is documented.
- Existing page tests/smoke paths pass.
- Extracted read models have focused tests for authorization and edge cases.

Suggested issue split:

1. Audit direct Prisma imports in pages/routes and classify exceptions.
2. Extract reader/study/admin read models where value is clear.
3. Add boundary lint/check to discourage new page-level Prisma imports.

### REF-082 — Normalize domain command result and error contracts

Priority: P1. Area: domain services/API error mapping.

Problem: Domain services expose several different failure contracts. Some return
structured results like `{ ok:false, error, status }` (`bookmarks`, `org`,
`content-review`, `admin-members`, `account`), some return `null` for not found
or unavailable (`article-access`, AI feature helpers, storage adapters), some
throw plain `Error` for validation (`quiz-mastery`, `progress`), and routes
often wrap these manually with `ApiError`. This inconsistency increases route
boilerplate and makes service contracts harder to compose.

Best strategy: define a small domain result/error contract library and migrate
commands/read models gradually, without forcing every function into the same
shape when `null` is semantically clearer.

Detailed requirements:

- Define standard result types for commands: success payload, not found,
  validation error, conflict, forbidden, unavailable, and unexpected exception.
- Provide route mapping helpers that convert domain failures to `ApiError` or
  `NextResponse` consistently.
- Keep read-model helpers free to return `null` for absence when absence is a
  normal value, but document that choice.
- Preserve existing public route status codes and error messages unless an issue
  explicitly changes API behavior.
- Keep best-effort side effects (audit, analytics, metrics) from becoming
  user-visible command failures unless the current behavior already does so.
- Add tests for representative command modules before migrating many callers.

Acceptance checks:

- New command services use a shared result contract or a documented exception.
- Route handlers shrink because status/error mapping is shared.
- Existing route/domain tests pass with unchanged status codes.

Suggested issue split:

1. Define domain result/error types and route mapping helper.
2. Migrate low-risk command modules such as bookmarks and org membership.
3. Migrate admin/account/content-review commands.
4. Document when `null` remains the preferred absence signal.

### REF-083 — Centralize display formatting for dates, durations, percentages, currency, and scores

Priority: P2. Area: UI formatting/readability.

Problem: Formatting logic is repeated across pages and components: relative
dates in tutor and quiz, admin job `fmtTime`/`fmtAge`, USD formatting in AI ops,
date formatting in member/detail/progress/notes/vocabulary pages, percentage
rounding in leveling/study-plan/admin analytics, reading-speed labels, and week
bucket labels. `aggregation.ts` contains some numeric helpers, but UI display
formatting remains scattered.

Best strategy: create a display formatting subsystem with pure, locale-aware
helpers and tests. Keep domain math separate from presentation formatting.

Detailed requirements:

- Add helpers for relative time, short/medium dates, UTC day labels, durations,
  lock ages, percentages, currency, WPM, and score labels.
- Keep locale defaults explicit (`en`/`en-US`) until full localization is in
  scope.
- Preserve current user-visible strings where tests/UI depend on them.
- Ensure helpers are client-safe and server-safe where possible.
- Avoid mixing formatting with domain computation; functions should consume
  already-computed numbers/dates.

Acceptance checks:

- Existing dashboard, progress, admin jobs, admin AI ops, tutor, quiz,
  vocabulary, notes, member detail, and analytics pages render equivalent copy.
- Formatting helpers have fixtures for null/invalid dates, recent/older dates,
  duration boundaries, currency rounding, and percentages.

Suggested issue split:

1. Add `src/lib/display-format.ts` or a small formatting package with tests.
2. Migrate admin/date/currency formatting first.
3. Migrate tutor/quiz relative date and progress/analytics labels.
4. Document locale assumptions.

### REF-084 — Consolidate client-safe option registries and label metadata

Priority: P2. Area: shared registries/client-safe constants.

Problem: Option registries and labels are spread across modules: categories and
category colors in `categories.ts`, supported translation languages in
`supported-languages.ts`, frequency tiers and badge variants in `frequency.ts`,
CEFR/profile options in `profile.ts` and `ui/Badge.tsx`, and admin/analytics UI
imports of those constants. Some registries are explicitly client-safe while
others live beside server-only helpers, which increases bundle-boundary risk.

Best strategy: create a client-safe registry package for product option values,
labels, colors, and UI metadata, with server modules importing from it rather
than duplicating constants.

Detailed requirements:

- Define client-safe registries for categories, supported target languages,
  frequency tiers, CEFR levels/labels, demographic profile options, and badge
  metadata where appropriate.
- Keep server-only behavior out of registry modules: no Prisma, AI, logger,
  runtime config, or Node APIs.
- Provide typed validators and label helpers for each registry.
- Keep UI-specific mapping (badge variants/colors) either in registry metadata
  or clearly in UI adapters; avoid duplicating mappings across components.
- Coordinate with existing taxonomy/leveling/profile refactors so registries do
  not split domain ownership again.

Acceptance checks:

- Client components can import registry values without pulling server-only
  dependencies.
- Existing category, language, frequency, CEFR, onboarding/settings, admin
  analytics, and card rendering tests pass.
- Grep shows no duplicate CEFR/category/frequency label maps after migration.

Suggested issue split:

1. Extract client-safe registry package and migrate categories/languages.
2. Migrate CEFR/profile option values after leveling/profile refactors align.
3. Migrate frequency tier labels/variants and UI adapters.
4. Add boundary tests for client-safe registry imports.

### REF-085 — Govern small shared utility modules as platform primitives

Priority: P3. Area: shared utilities/platform hygiene.

Problem: Small utilities such as `aggregation.ts`, `backoff.ts`, `safe-json.ts`,
`cn.ts`, `focus-trap.ts`, storage key helpers, browser storage helpers, and
various normalize/escape helpers are valuable but scattered. Some are pure and
universal, some are client-only, and some are security-sensitive. Without an
ownership model, new utilities may be duplicated or imported across unsafe
boundaries.

Best strategy: classify shared utilities into platform packages: pure shared,
client-only, server-only, security-sensitive, and feature-local. Add tests and
barrels only where they improve discoverability.

Detailed requirements:

- Inventory utility modules and classify boundary: pure/client/server/security.
- Keep security-sensitive helpers (`safeJsonStringify`, escaping, redaction,
  focus traps) well-tested and documented.
- Avoid a dumping-ground `utils.ts`; group utilities by purpose.
- Provide a contribution guideline for adding new shared utilities vs keeping
  them feature-local.
- Ensure client-safe utilities do not import server-only modules.

Acceptance checks:

- Utility classification is documented.
- Pure utility tests cover aggregation, backoff, safe JSON escaping, focusable
  collection, class merging assumptions, and key/path helpers where applicable.
- New shared utilities have an owner and boundary classification.

Suggested issue split:

1. Inventory and classify utility modules.
2. Add missing tests for security-sensitive utilities.
3. Create purpose-based barrels where helpful.
4. Add contribution guidance to docs/AGENTS if durable.

### REF-086 — Standardize dependency-injection and test seam patterns

Priority: P2. Area: testing/service design.

Problem: Some services expose explicit dependency seams (`BackfillDeps`,
`SeedDeps`, worker deps, analytics clients), while many tests rely on
`mock.module` to replace entire modules. Both are useful, but the codebase lacks
a convention for when to inject dependencies, when to mock modules, and how to
name small client interfaces. This can make tests brittle or encourage broad
mocking where a narrow seam would be clearer.

Best strategy: document and standardize dependency seam patterns for domain
services, route handlers, workers, and scripts. Prefer narrow injected clients
for pure orchestration and module mocks for framework boundaries.

Detailed requirements:

- Define when a service should accept a `deps` object, a narrow Prisma client
  interface, a provider interface, or no injection.
- Standardize naming (`Deps`, `Client`, `Repository`, `Provider`) and default
  dependency resolution.
- Keep public API ergonomics simple: production callers should not need to pass
  deps.
- Ensure dependency seams do not leak test-only concepts into domain logic.
- Align with route test harness and fixture builder refactors so tests use the
  narrowest useful seam.

Acceptance checks:

- New services follow a documented seam convention.
- Existing backfill, seed, worker, analytics, storage, scraper, and route tests
  still pass.
- Refactored tests reduce broad module mocks where narrow injected deps are more
  readable.

Suggested issue split:

1. Document dependency seam guidelines with examples from current code.
2. Apply guidelines to one or two orchestration services.
3. Update test support helpers to encourage narrow seams.

## Not in scope for these analysis passes

- Runtime behavior changes without tests.
- Schema removals without a migration and rollback story.
- UI redesigns. The first refactor pass should preserve behavior and visuals;
  redesigns can follow after boundaries are cleaner.
- Adding new compatibility wrappers as a substitute for deleting old ones.