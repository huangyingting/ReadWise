# ReadWise

ReadWise is an AI-assisted English learning reader for long-form news and
educational articles. It combines a modern reader, adaptive study tools,
AI-powered enrichment, a content ingestion pipeline, classroom workflows, and
admin/operations tooling in one Next.js app.

The app is designed to run with minimal local setup: SQLite is the default,
PostgreSQL parity is available through Docker Compose, and every optional
external provider (Azure OpenAI, Azure Speech, Web Push, object storage,
OpenTelemetry) degrades gracefully when it is not configured.

## What is implemented

### Reader and learning experience

- Authenticated dashboard, onboarding profile, level/topic preferences, and
  personalized article recommendations.
- Category browsing, tag pages, search/feed APIs, bookmarks, custom reading
  lists, and private/user-owned imported articles.
- Article reader with sanitized HTML, reader display controls, progress
  tracking, reading-time analytics, related-article recommendations, saved
  state sync, keyboard-accessible chrome, and structured article metadata.
- In-reader learning tools: full-article translation, sentence translation,
  dictionary lookup, AI vocabulary extraction, grammar explanations, tutor
  chat, comprehension quizzes, dictation, pronunciation practice, CEFR
  difficulty feedback, text-to-speech narration, and word-level audio
  highlighting.
- Highlights and notes with W3C-style quote/offset anchors, inline note edits,
  and a dedicated notes page.
- Offline/PWA support: service worker registration, offline library page,
  per-article downloads, queued offline mutations, and conflict-aware sync.

### Study, progress, and mastery

- Saved vocabulary list, flashcard review, SM-2 style spaced repetition,
  cloze practice, vocabulary journal, CSV/export helpers, and push reminders
  for due reviews.
- Quiz attempt history, quiz mastery summaries, weekly study-plan generation,
  learner analytics, streaks, activity heatmap, CEFR level timeline, reading
  speed stats, and mastery models for words, articles, and skills.

### Content and AI pipeline

- Provider-based scraper with HTML extraction, RSS/WordPress/GraphQL discovery
  hooks, SSRF protections, article dedupe, content source health tracking, and
  admin-triggered ingestion.
- Current provider registry includes: NBC News, National Geographic, Time,
  HuffPost, BBC News, Smithsonian Magazine, Knowable Magazine, Nautilus, Aeon,
  MIT Technology Review, Noema Magazine, Undark, BBC Learning English, and VOA
  Learning English.
- Idempotent processor for difficulty, tags, vocabulary, quiz, optional
  translations, and optional speech. Drafts publish only after processing
  completes or degrades safely.
- Durable `Job` table for background work, multi-worker locking on PostgreSQL,
  stale-lock recovery, retry/backoff policies, and dead-letter inspection.
- AI governance: prompt/eval datasets, invocation ledger, cost estimation,
  feature quotas, request budgeting, cache-first helpers, and graceful fallback.

### Admin, security, and tenant features

- Admin area for overview stats, article moderation, source governance, tag
  management, member/RBAC management, job operations, analytics, AI usage, and
  security-event review.
- Content policy and moderation state for rights/takedown workflows, quality
  review, and audit history.
- Capability-based RBAC, organization/membership models, teacher dashboard,
  classroom rosters, assignments, and assignment completion tracking.
- Request wrapper for API routes with auth, schema validation, request IDs,
  structured logging, CSRF/same-origin checks, rate limiting, audit hooks,
  security-event monitoring, metrics, tracing spans, and production-safe error
  responses.

## Tech stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js 15 App Router, TypeScript |
| UI | React 19, Tailwind CSS 4, custom design tokens/components |
| Database | Prisma 6 + SQLite by default; PostgreSQL parity schema and migrations available |
| Auth | NextAuth v4 + `@auth/prisma-adapter`, database session strategy |
| AI | Azure OpenAI chat completions over `fetch` |
| Speech | Azure Cognitive Services Speech SDK |
| Media storage | Database base64 fallback, local filesystem, or Azure Blob Storage |
| Background work | DB-backed jobs + worker CLI, Redis available in local parity stack |
| Observability | Structured JSON logs, AsyncLocalStorage request context, metrics, OpenTelemetry tracing |
| Tests | Node built-in test runner with module mocks; Playwright smoke tests |

## Prerequisites

- Node.js **22.9+** and npm **10+** (`--env-file-if-exists` is used by CLI scripts).
- No database server is required for the default SQLite workflow.
- Docker Compose is optional, but recommended when testing PostgreSQL/Redis
  parity locally.
- Azure/OpenTelemetry/Web Push/storage credentials are optional. Missing
  optional providers are reported as degraded/unconfigured, not fatal.

## Local setup

```bash
git clone https://github.com/huangyingting/ReadWise.git
cd ReadWise
npm install
cp .env.example .env
```

Edit `.env` and replace at least:

- `DATABASE_URL` — keep `file:./dev.db` for SQLite.
- `PRISMA_SCHEMA_PATH` — keep `prisma/schema.prisma` for SQLite.
- `NEXTAUTH_SECRET` — use a real random string of at least 32 characters.
- `NEXTAUTH_URL` — usually `http://localhost:3000` locally.
- At least one OAuth provider if you want normal browser sign-in.
- Clear optional provider placeholders that you are not using; fake Azure/OAuth
  values are still non-empty values and may make the app try those providers.

Then initialize and run:

```bash
npm run db:migrate
npm run seed -- --limit 3 --no-tts
npm run dev
```

Open <http://localhost:3000>. The content seeder scrapes and enriches sample
articles; it does not create local login sessions, so configure an OAuth
provider for browser sign-in or create test sessions through your local tooling.

> AI, Speech, Push, storage, and tracing are optional. The app remains usable
> without those credentials: AI panels show friendly fallbacks, difficulty uses
> a heuristic, and audio stays in the database unless object storage is enabled.

## PostgreSQL + Redis parity workflow

The default local database is SQLite. To exercise the PostgreSQL schema,
migrations, DB-backed rate limiter, and multi-worker job locking, use the local
compose stack:

```bash
docker compose up -d postgres redis
DATABASE_URL="postgresql://readwise:readwise-dev-password@localhost:55432/readwise?schema=public" \
  npx prisma migrate deploy --schema prisma/postgresql/schema.prisma
npm run dev
```

This starts loopback-only PostgreSQL on `127.0.0.1:55432` and Redis on
`127.0.0.1:6379` and deploys PostgreSQL migrations.

Useful parity commands:

```bash
docker compose ps
DATABASE_URL="postgresql://readwise:readwise-dev-password@localhost:55432/readwise?schema=public" \
  npx prisma migrate status --schema prisma/postgresql/schema.prisma
docker compose down
docker compose down -v  # destructive reset of local PostgreSQL/Redis volumes
```

See `docs/platform/database.md` and `docs/platform/database-runbooks.md` for migration,
backup, restore, reset, and SQLite-to-PostgreSQL notes.

## Environment variables

`.env.example` is the canonical template. The main groups are summarized below.

### Required runtime configuration

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Prisma datasource. SQLite example: `file:./dev.db`; PostgreSQL example: `postgresql://readwise:readwise-dev-password@localhost:55432/readwise?schema=public`. |
| `PRISMA_SCHEMA_PATH` | Schema used by readiness/migration checks. Use `prisma/schema.prisma` for SQLite or `prisma/postgresql/schema.prisma` for PostgreSQL parity. |
| `NEXTAUTH_SECRET` | Session secret; must be a non-placeholder value of at least 32 characters. |
| `NEXTAUTH_URL` | Canonical app URL, e.g. `http://localhost:3000`. |

### Sign-in providers

At least one provider is needed for normal sign-in. Missing providers do not
crash startup.

| Provider | Variables |
| --- | --- |
| Google OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Azure Entra ID | `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, `AZURE_AD_TENANT_ID` |

### AI, speech, and media

| Area | Variables | Notes |
| --- | --- | --- |
| Azure OpenAI | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION` | Enables translation, vocab, quiz, tags, grammar, tutor, and AI difficulty. |
| AI tuning | `AI_REQUEST_TIMEOUT_MS`, `AI_MAX_RETRIES`, `AZURE_OPENAI_MAX_CONTEXT_TOKENS`, `AI_MAX_OUTPUT_TOKENS` | Malformed values fall back to defaults. |
| AI ledger/cost | `AI_LEDGER_ENABLED`, `AI_COST_PROMPT_PER_1K`, `AI_COST_COMPLETION_PER_1K`, `AI_COST_RATES` | Stores metadata only; prompts/responses are not persisted. |
| AI quotas | `AI_QUOTA_WINDOW_MS`, `AI_QUOTA_USER_DAILY`, `AI_QUOTA_GLOBAL_DAILY`, `AI_QUOTA_BACKGROUND_DAILY`, `AI_QUOTA_FEATURE_DEFAULT_DAILY`, `AI_QUOTA_FEATURE_<FEATURE>_DAILY` | Empty or non-positive limits mean unlimited. |
| Azure Speech | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, `AZURE_SPEECH_VOICE`, `AZURE_SPEECH_OUTPUT_FORMAT`, `SPEECH_TIMEOUT_MS` | Enables server-side narration generation. |
| Object storage | `MEDIA_STORAGE`, `MEDIA_STORAGE_DIR`, `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_KEY`, `AZURE_STORAGE_CONTAINER` | Default is database/base64. Use `filesystem` locally or `azure` for Azure Blob Storage. |

### Push, observability, security, and analytics

| Area | Variables |
| --- | --- |
| Web Push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| Logging/tracing | `LOG_LEVEL`, `TRACING_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_SERVICE_NAME`, `APP_VERSION` |
| Error reporting | `ERROR_REPORTING_PROVIDER`, `ERROR_ALERT_THRESHOLD` |
| Rate limiting | `RATE_LIMIT_AI_REQUESTS`, `RATE_LIMIT_LOOKUP_REQUESTS`, `RATE_LIMIT_PUBLIC_REQUESTS`, `RATE_LIMIT_IMPORT_REQUESTS`, `RATE_LIMIT_ADMIN_JOB_REQUESTS`, `RATE_LIMIT_AUTH_REQUESTS`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_STORE` |
| Proxy/IP trust | `TRUSTED_PROXY_HEADER`, `TRUSTED_PROXY_LIST`, `TRUSTED_PROXY_HOPS` |
| CSRF | `CSRF_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, `CSRF_ENFORCE` |
| Security events | `SECURITY_EVENT_ALERT_THRESHOLD`, `SECURITY_EVENT_WINDOW_MS`, `SECURITY_EVENT_BUFFER_SIZE` |
| Product analytics | `ANALYTICS_ENABLED`, `ANALYTICS_RETENTION_DAYS` |

## Scripts

### Development and quality

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js dev server on port 3000. |
| `npm run build` | Production build. Stop `npm run dev` first; both share `.next/`. |
| `npm run start` | Start the production server after a build. |
| `npm run lint` | Run ESLint over the workspace. |
| `npm run typecheck` | Run `tsc --noEmit`. |
| `npm test` | Run the unit test suite with Node's built-in test runner. |
| `npm run test:db` | Run PostgreSQL integration tests (`RUN_DB_INTEGRATION=1`). |
| `npm run test:e2e:smoke` | Run Playwright smoke tests. |
| `npm run eval` | Run the offline AI evaluation harness over `evals/*.json`. Use `-- --live` for a configured provider. |

### Content pipeline and background jobs

| Command | Purpose |
| --- | --- |
| `npm run scrape -- --list-providers` | List supported scraper providers. |
| `npm run scrape -- --provider bbc --limit 5` | Discover and save draft articles from one provider. |
| `npm run scrape -- --all --limit 3` | Scrape every enabled provider. |
| `npm run scrape -- <url>` | Scrape one or more explicit article URLs. |
| `npm run process -- --all` | Enrich draft articles and publish them. |
| `npm run process -- --all --enqueue` | Enqueue durable article-processing jobs for the worker. |
| `npm run process -- <articleId> --tts --translate es,fr` | Process specific articles with optional TTS/translations. |
| `npm run worker` | Drain the durable `Job` table with locking/retries/dead letters. |
| `npm run worker -- --once` | Drain the durable `Job` queue once and exit. |
| `npm run seed -- --provider nbc --limit 3` | Scrape + process + publish sample articles end-to-end. |
| `npm run push-reminders -- --dry-run` | Check SRS push-reminder configuration without sending. |

### Local data, Prisma, and storage

| Command | Purpose |
| --- | --- |
| `npm run seed -- --limit 3 --no-tts` | Scrape, process, and publish sample articles without TTS. |
| `npm run db:migrate` | Deploy default Prisma migrations and regenerate the Prisma client. |
| `npm run db:reset` | Destructively reset the default Prisma database and regenerate the client. |
| `npm run prisma:generate` | Generate the default Prisma client. |
| `npm run prisma:generate:pg` | Generate the PostgreSQL Prisma client. |
| `npm run prisma:migrate:pg` | Deploy PostgreSQL migrations. |
| `npm run migrate-storage -- --limit 100` | Move existing narration audio from DB base64 into configured media storage. |

All TypeScript CLIs use Node's type-stripping harness and auto-load `.env` when
it exists:
`node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs ...`.
The register hook also resolves the `@/*` alias for scripts.

## Architecture overview

```text
src/
├── app/
│   ├── (app)/                  # Authenticated app shell routes
│   │   ├── dashboard/          # Personalized feed
│   │   ├── browse/             # Category + picks browsing
│   │   ├── reader/[id]/        # Article reader
│   │   ├── study/              # Vocabulary, flashcards, cloze, study plan
│   │   ├── progress/           # Learner analytics and level timeline
│   │   ├── lists/ notes/       # Reading lists, bookmarks, highlights/notes
│   │   ├── offline/ import/    # Offline library and article import
│   │   └── teacher/ assignments/ # Classroom workflows
│   ├── admin/                  # Admin shell + dashboard/articles/sources/tags/members/jobs/analytics/security
│   ├── api/                    # Route handlers built with shared wrappers
│   ├── signin/ onboarding/     # Auth and profile setup
│   └── privacy/ terms/         # Public legal pages
├── components/                 # Reader, admin, shell, study, and UI components
├── lib/
│   ├── api-handler.ts          # Auth, validation, CSRF, logging, tracing, errors
│   ├── auth.ts session.ts      # NextAuth config and server page guards
│   ├── prisma.ts               # Prisma singleton
│   ├── articles.ts tags.ts     # Article/tag queries and cached listings
│   ├── ai.ts ai-ledger.ts      # Azure OpenAI wrapper and AI usage ledger
│   ├── processor.ts worker.ts  # Enrichment pipeline and workers
│   ├── jobs.ts                 # Durable DB job queue
│   ├── scraper/                # Provider registry, extraction, RSS/WP/GraphQL helpers
│   ├── translation.ts vocabulary.ts quiz.ts difficulty.ts grammar.ts tutor.ts speech.ts
│   ├── bookmarks.ts highlights.ts offline-* srs.ts mastery.ts
│   ├── admin-*.ts analytics*.ts audit.ts security-events.ts rbac.ts
│   └── config.ts storage.ts tracing*.ts metrics.ts logger.ts
└── types/                      # NextAuth and shared type augmentations

prisma/
├── schema.prisma               # SQLite/default schema
├── migrations/                 # SQLite migration history
└── postgresql/                 # PostgreSQL schema + migrations

scripts/                        # CLI entry points
tests/                          # Unit and integration tests
e2e/                            # Playwright smoke tests
docs/                           # Topic-specific architecture and runbooks
evals/                          # AI prompt/evaluation fixtures
```

## Project conventions

- Import project code with `@/*` (`@/lib/prisma`, `@/components/...`).
- Use the singleton `prisma` from `src/lib/prisma.ts`; do not instantiate a new
  `PrismaClient` in app code.
- Server pages must guard access explicitly with `requireSession`,
  `requireOnboardedSession`, or capability/RBAC helpers.
- `middleware.ts` performs the lightweight session-cookie redirect for protected
  prefixes; server/API guards remain the source of truth.
- API routes should use `createHandler`, `createAdminHandler`,
  `createCapabilityHandler`, or `createPublicHandler` from
  `src/lib/api-handler.ts`. Throw `ApiError` for controlled client errors.
- Stored article HTML must be passed through `sanitizeArticleHtml` before
  rendering. Never inject raw scraped/imported content.
- Listing queries use cache helpers from `src/lib/cache.ts`; mutations that
  affect feeds should revalidate the appropriate article/tag cache.
- AI helpers are cache-first and fallback-safe. Missing credentials should never
  make a user-facing feature crash.
- Use `createLogger(scope)` for server logging. Request context automatically
  carries request ID, user ID, method, and path.

## Development notes

### Loading environment variables

Use `.env` for local configuration. Next.js and Prisma load it automatically;
the package scripts that run TypeScript CLIs use Node's built-in
`--env-file-if-exists=.env` flag. If you run one-off Node commands outside
`package.json`, pass the same flag or export the variables in your shell.

### Do not run build and dev concurrently

`npm run dev` and `npm run build` both write to `.next/`. Running them at the
same time can corrupt build output and produce non-deterministic route errors.
Stop the dev server before building. If the cache looks stale, remove `.next/`
and build again.

### Production standalone output

`next.config.ts` emits `output: "standalone"` only when `NODE_ENV=production`.
That output is used by the Docker image and is not required for local
development.

## Deployment

### Docker

```bash
docker build -t readwise .

docker run -p 3000:3000 \
  -v readwise-data:/data \
  -e DATABASE_URL=file:/data/readwise.db \
  -e PRISMA_SCHEMA_PATH=prisma/schema.prisma \
  -e NEXTAUTH_SECRET=<secret> \
  -e NEXTAUTH_URL=https://readwise.example.com \
  readwise
```

The entrypoint runs Prisma migrations before starting the standalone Next.js
server. For production, prefer a managed PostgreSQL database and set the
matching `DATABASE_URL` + `PRISMA_SCHEMA_PATH` values through your secret
manager.

### Health probes

| Endpoint | Purpose | Notes |
| --- | --- | --- |
| `GET /api/health` | Liveness | Cheap process check; does not touch DB/providers. |
| `GET /api/ready` | Readiness | Validates required config, DB connectivity, migration-table health, and optional provider status. Returns `200` or `503`. |

## Documentation map

- `docs/platform/database.md` — SQLite/PostgreSQL workflows, migration tests, local DB helper.
- `docs/README.md` — full documentation index.
- `docs/platform/health-readiness.md` — health/readiness probes and runtime config validation.
- `docs/operations/admin-operations.md` — admin jobs, audit logs, processing steps, provider operations.
- `docs/learning/learning-and-mastery.md` — learner analytics, mastery models, adaptive leveling, SRS.
- `docs/reader/annotations.md` — highlights, notes, anchor revalidation, offline note merge.
- `docs/platform/database-runbooks.md` — backup, restore, rollback, and DR runbooks.
- `docs/platform/ci.md` — CI quality gates and failure triage.
- `docs/security/overview.md` — trusted proxy, CSRF, security events, audit logs.
- `docs/observability/overview.md` — logs, metrics, tracing, and error reporting.
- `docs/media/storage.md` — filesystem/Azure media storage and migration guide.
- `docs/analytics/product-analytics.md` — product analytics event schema and retention.
- `docs/ai/context-management.md`, `docs/ai/prompts.md`, `docs/ai/safety.md`, `docs/ai/evaluations.md` — AI prompt governance and evaluations.
- `docs/content/content-policy.md` — source governance, provider health, rights, and takedown policy.
- `docs/content/scrapers.md` — scraper provider architecture and drift handling.
- `docs/reader/offline-sync.md` — offline queue and conflict-resolution design.
- `docs/reader/search-and-indexing.md` — search/indexing strategy.
- `docs/access/rbac.md` and `docs/access/multi-tenancy.md` — capability model, organizations, classrooms, and assignments.
- `docs/adr/` — architecture decision records.
