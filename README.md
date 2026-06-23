# ReadWise

AI-assisted English learning reader. Surfaces news articles from major providers,
enriches them with AI-powered features (translation, vocabulary extraction,
comprehension quiz, difficulty assessment, auto-tags, text-to-speech narration),
and tracks reading progress per user.

## Tech stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15 (App Router, TypeScript) |
| UI | React 19 |
| Database | Prisma ORM + SQLite |
| Auth | NextAuth v4 + `@auth/prisma-adapter` (database sessions) |
| AI features | Azure OpenAI (chat completions) |
| Narration | Azure Cognitive Services Speech SDK |
| Scraping | Custom provider registry (NBC, NatGeo, Time, HuffPost) |

## Prerequisites

- **Node.js 22** (or later)
- **npm 10+** (ships with Node 22)
- No database server needed — SQLite is embedded

## Local setup

```bash
# 1. Clone
git clone https://github.com/huangyingting/ReadWise.git
cd ReadWise

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env.local
#    → fill in NEXTAUTH_SECRET (any random string) and any provider keys you want

# 4. Create the database and run all migrations
npx prisma migrate dev --name init

# 5. Start the development server (http://localhost:3000)
npm run dev
```

> **AI features are optional.** The app runs fully without Azure credentials —
> translation, vocabulary, quiz, tags, TTS, and difficulty assessment all
> degrade gracefully (returning placeholder responses or heuristic fallbacks).

## Development notes

### Loading environment variables

The dev server and CLI scripts read from `.env.local`. When running scripts
directly in your shell (e.g. `npm run scrape`, `npm run worker`) you may need
to load the env file first:

```bash
set -a && . ./.env.local && set +a
```

### ⚠️ Do NOT run `npm run build` while `npm run dev` is active

Both commands share the `.next/` output directory. Running a production build
concurrently with the dev server causes a **file-write race** that reproducibly
triggers `PageNotFoundError` for `(app)` route-group pages (issue #83). The
build output is scrambled and the error is non-deterministic.

**Rule:** before running `npm run build`, always stop the dev server first (or
open a separate checkout). If you suspect the `.next/` cache is stale, clean it
first:

```bash
rm -rf .next && npm run build
```

### `output: "standalone"` (Docker artefact)

`next.config.ts` sets `output: "standalone"` when `NODE_ENV=production`. This
produces a self-contained `.next/standalone/` directory that the Docker image
uses to run the app (`node server.js`). It is **only emitted during
`npm run build`** and has no effect on `npm run dev`. On a fresh clone you do
**not** need to run a production build before starting the dev server — just
`npm run dev` directly.

## Environment variables

Copy `.env.example` to `.env.local` and fill in real values.

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Prisma datasource URL, e.g. `file:./dev.db` |
| `NEXTAUTH_SECRET` | Random secret for signing sessions (generate with `openssl rand -hex 32`) |
| `NEXTAUTH_URL` | Canonical URL of the app, e.g. `http://localhost:3000` |

### OAuth providers (optional — at least one recommended for sign-in)

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 client secret |
| `AZURE_AD_CLIENT_ID` | Azure Entra ID (AAD) app client ID |
| `AZURE_AD_CLIENT_SECRET` | Azure Entra ID app client secret |
| `AZURE_AD_TENANT_ID` | Azure tenant ID (use `common` for multi-tenant) |

### Azure OpenAI (optional — enables AI enrichment features)

| Variable | Description |
|----------|-------------|
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI resource endpoint, e.g. `https://<resource>.openai.azure.com` |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key |
| `AZURE_OPENAI_DEPLOYMENT` | Model deployment name, e.g. `gpt-4o-mini` |
| `AZURE_OPENAI_API_VERSION` | API version, e.g. `2025-04-01-preview` |

### Azure Speech (optional — enables TTS narration)

| Variable | Description |
|----------|-------------|
| `AZURE_SPEECH_KEY` | Azure Speech resource key |
| `AZURE_SPEECH_REGION` | Azure region, e.g. `eastus` |
| `AZURE_SPEECH_VOICE` | TTS voice name, e.g. `en-US-AndrewMultilingualNeural` |
| `AZURE_SPEECH_OUTPUT_FORMAT` | Audio output format, e.g. `audio-24khz-96kbitrate-mono-mp3` |

### Tuning (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Server log verbosity: `debug`, `info`, `warn`, `error` |
| `RATE_LIMIT_AI_REQUESTS` | `20` | Max AI requests per user per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window length in milliseconds |

## Scripts

```bash
npm run dev           # Start development server (port 3000)
npm run build         # Production build (also runs typecheck + lint)
npm run start         # Start production server (after build)
npm run typecheck     # TypeScript type-check (tsc --noEmit)
npm run lint          # ESLint via Next.js lint
npm test              # Run all tests (Node built-in runner, no framework)
npm run test:e2e:smoke # Playwright smoke flows with direct DB session seeding

# Content pipeline
npm run scrape -- --provider nbcnews --limit 5   # Scrape articles from a provider
npm run scrape -- --all --limit 3                # Scrape all configured providers
npm run process -- --all                         # Enrich all draft articles with AI
npm run worker -- --once                         # Process queue then exit (cron-safe)
npm run worker                                   # Long-running background processor
npm run seed -- --provider nbcnews --limit 3     # Scrape + process in one command
```

### Content pipeline detail

| Command | Purpose |
|---------|---------|
| `scrape` | Discovers and saves article drafts from provider sites (de-duped by URL) |
| `process` | Runs AI enrichment (difficulty → tags → vocabulary → quiz → TTS) on drafts, then publishes them |
| `worker` | Long-running loop that continuously processes new drafts with retries and backoff |
| `seed` | End-to-end: scrape + process in one shot (idempotent, safe to re-run) |

## Architecture overview

```
src/
├── app/                  # Next.js App Router
│   ├── (auth)/           # Sign-in / sign-out pages
│   ├── admin/            # Admin area (layout-gated to Admin role)
│   ├── api/              # API route handlers
│   │   ├── health/       # GET /api/health  — liveness probe
│   │   ├── ready/        # GET /api/ready   — readiness probe (DB + providers)
│   │   ├── reader/[id]/  # Progress, translate, vocabulary, quiz, speech, tags
│   │   └── admin/        # Admin stats, article/member/tag management
│   ├── browse/           # Category browsing with infinite scroll
│   ├── dashboard/        # Personalised home feed
│   ├── onboarding/       # First-run profile setup
│   ├── reader/[id]/      # Article reader with all AI panels
│   ├── settings/         # Profile settings
│   └── study/            # Saved vocabulary study list
├── components/           # Shared React components
├── lib/                  # Server-side utilities
│   ├── api-handler.ts    # Route wrapper: auth, logging, validation, errors
│   ├── logger.ts         # Structured JSON logger with AsyncLocalStorage context
│   ├── auth.ts           # NextAuth config (providers, session callbacks)
│   ├── prisma.ts         # Prisma singleton
│   ├── ai.ts             # Azure OpenAI wrapper (graceful fallback)
│   ├── speech.ts         # Azure Speech SDK wrapper (graceful fallback)
│   └── cache.ts          # Next.js unstable_cache wrappers with tag invalidation
└── types/                # TypeScript augmentations (next-auth.d.ts)

prisma/
├── schema.prisma         # Prisma schema (SQLite, all models)
└── migrations/           # Auto-generated migration history

scripts/                  # CLI tools (scrape, process, worker, seed)
tests/                    # Unit tests (Node built-in runner, no framework)
```

### Key conventions

- **API routes** — all built with `createHandler` / `createAdminHandler` / `createPublicHandler`
  from `src/lib/api-handler.ts`. Centralises auth, logging, validation, and error formatting.
  Throw `ApiError(status, message)` for controlled client errors.
- **Auth** — database session strategy. `session.user.id` and `session.user.role` are attached
  in the `session` callback. Guard pages with `requireSession` / `requireOnboardedSession` /
  `requireAdmin` from `src/lib/session.ts`.
- **First user = Admin** — the `events.createUser` hook promotes the first account to `Admin`.
- **AI degrades gracefully** — all `getOrCreate*` helpers return `fallback:true` and cache
  nothing when Azure creds are absent or a call fails, so the app is fully functional without
  Azure credentials.
- **Logging** — use `createLogger(scope)` from `src/lib/logger.ts`. Request context
  (requestId, userId, method, path) is propagated automatically via `AsyncLocalStorage`.

## Deployment (Docker)

```bash
# Build image
docker build -t readwise .

# Run (mount a volume for the SQLite DB)
docker run -p 3000:3000 \
  -v readwise-data:/data \
  -e DATABASE_URL=file:/data/readwise.db \
  -e NEXTAUTH_SECRET=<secret> \
  -e NEXTAUTH_URL=https://readwise.example.com \
  readwise
```

The container entrypoint runs `prisma migrate deploy` before starting `node server.js`.
See `docker-entrypoint.sh` and the `Dockerfile` header for the full list of env vars.

## Health probes

| Endpoint | Purpose | Success |
|----------|---------|---------|
| `GET /api/health` | Liveness — process is alive | Always 200 |
| `GET /api/ready` | Readiness — DB reachable + provider status | 200 / 503 |
