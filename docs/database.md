# Database setup

ReadWise keeps the existing SQLite workflow as the default in this PR, and adds a
PostgreSQL parity lane that can run the same app code with a PostgreSQL-generated
Prisma client.

## Local PostgreSQL parity stack

Recommended one-command setup:

```bash
npm run local:pg:setup
npm run dev
```

`local:pg:setup` runs:

1. `docker compose up -d --wait postgres redis`
2. PostgreSQL Prisma client generation
3. PostgreSQL migrations
4. Deterministic local seed data

The helper injects the local-only environment values below so it does not need
to read `.env`:

```bash
DATABASE_URL="postgresql://readwise:readwise-dev-password@localhost:55432/readwise?schema=public"
PRISMA_SCHEMA_PATH="prisma/postgresql/schema.prisma"
REDIS_URL="redis://localhost:6379"
```

The compose stack binds PostgreSQL to loopback only and uses a clearly dev-only
password. Production must set `DATABASE_URL` through the deployment secret
manager with real credentials and must not commit those values.

Manual equivalent commands remain available when debugging:

```bash
npm run local:pg:up
export DATABASE_URL="postgresql://readwise:readwise-dev-password@localhost:55432/readwise?schema=public"
export PRISMA_SCHEMA_PATH="prisma/postgresql/schema.prisma"
npm run prisma:generate:pg
npm run prisma:migrate:pg
npm run local:seed
```

To switch back to SQLite after generating the PostgreSQL client, restore the
default client:

```bash
export DATABASE_URL="file:./dev.db"
export PRISMA_SCHEMA_PATH="prisma/schema.prisma"
npm run prisma:generate
```

## Deterministic local seed data

`npm run local:pg:seed` (or `npm run local:seed` with a safe local
`DATABASE_URL`) seeds a fixed, idempotent dataset without scraping, network
calls, AI provider calls, OAuth providers, or secrets.

Included fixtures:

| Area | Seeded data |
| --- | --- |
| Users | Admin, Reader, and a removable workflow Reader |
| Sessions | `readwise-local-admin-session`, `readwise-local-reader-session` |
| Articles | Published reader articles plus Draft, Failed, Archived, and Private samples |
| Reader state | Reading progress, saved words, reading list, highlight, quiz attempt |
| AI/admin detail | Vocabulary, quiz questions, translation, speech timing stub, difficulty feedback |
| Admin workflows | Tags for delete/merge testing and audit rows for article/member workflows |

To enter the app without OAuth in a browser, set a seeded cookie from DevTools on
`http://localhost:3000`:

```js
document.cookie = "next-auth.session-token=readwise-local-admin-session; path=/; max-age=2592000; SameSite=Lax";
location.href = "/admin";
```

Use `readwise-local-reader-session` and navigate to `/browse` for reader flows.
Re-run `npm run local:pg:seed` at any time to restore the deterministic seed
fixtures without resetting the whole database. The seeder refuses non-local
database URLs; validate its DB-free plan with:

```bash
npm run local:seed:dry-run
```

## Reset local PostgreSQL state

This removes only the compose resources for the `readwise-local` project,
including the local PostgreSQL volume, then recreates the stack, applies
migrations, and reseeds:

```bash
npm run local:pg:reset -- --yes
```

Guardrails:

- The reset command requires `-- --yes`; without it, it refuses to run.
- `docker-compose.yml` sets `name: readwise-local`, so reset targets a stable
  local project instead of whatever directory name the worktree happens to use.
- The seeder refuses production-looking `DATABASE_URL` values.
- If `127.0.0.1:55432` or `127.0.0.1:6379` is already owned by an older
  ReadWise compose project, stop that project before running setup/reset so the
  helper cannot accidentally target the wrong local database.
- Do not run reset against shared Docker contexts or with modified compose files
  that point at external volumes.

## Migration and integration checks

The PostgreSQL baseline lives in `prisma/postgresql/migrations/`. Run checks
against a disposable PostgreSQL database:

```bash
export DATABASE_URL="postgresql://readwise:readwise-dev-password@localhost:55432/readwise?schema=public"
export PRISMA_SCHEMA_PATH="prisma/postgresql/schema.prisma"
npm run prisma:generate:pg
npm run prisma:migrate:pg
npm run test:db
npx prisma migrate status --schema prisma/postgresql/schema.prisma
```

The normal `npm test` suite remains mocked and DB-free; `npm run test:db` is the
real-engine coverage for migrations and representative constraints.

Current PostgreSQL integration coverage applies the PostgreSQL migration history
from scratch in CI, replays the post-baseline migrations in an isolated schema
with representative legacy rows, and verifies ownership/privacy constraints,
scoped uniqueness/null behavior, cascades, audit-log retention, JSONB columns,
article search indexes/FTS, and the current article-state worker selection.

Job-locking assertions are intentionally scoped out until ADR-0005 is
implemented: there is no persistent job table or `locked_by`/`locked_until`
state in the schema yet, so the real database semantics available today are the
processor's deterministic `Article.status`/missing-enrichment selection.

## Docker image with PostgreSQL schema

Build images for PostgreSQL with the schema build arg so the generated Prisma
client and runtime migration command agree:

```bash
docker build --build-arg PRISMA_SCHEMA_PATH=prisma/postgresql/schema.prisma -t readwise:postgres .
docker run \
  -e PRISMA_SCHEMA_PATH=prisma/postgresql/schema.prisma \
  -e DATABASE_URL="postgresql://<user>:<password>@<host>:5432/<database>?schema=public" \
  -e NEXTAUTH_SECRET="<32-byte-random-secret>" \
  -e NEXTAUTH_URL="https://<app-host>" \
  readwise:postgres
```

## Migrating existing SQLite data

Recommended safe path for a one-time migration:

1. Stop app and worker processes so SQLite is read-only during export.
2. Back up the SQLite database file.
3. Create an empty PostgreSQL database and apply `npm run prisma:migrate:pg`.
4. Export SQLite tables in foreign-key order to CSV with the `sqlite3` CLI.
5. Import those CSVs with `psql \copy`, preserving IDs and timestamps.
6. Compare row counts table-by-table, then run `npm run test:db` against the
   migrated database.
7. Start the app with the PostgreSQL `DATABASE_URL`,
   `PRISMA_SCHEMA_PATH=prisma/postgresql/schema.prisma`, and
   PostgreSQL-generated Prisma client.

CSV exports can contain user emails, names, auth/session-related rows, saved
study data, highlights, and other private reading activity. Treat export files
as sensitive production data: write them only to an access-controlled location,
encrypt them at rest when retained, never commit or upload them to shared issue
trackers/logs, and delete the files once validation and import are complete.

Use placeholders in migration runbooks and CI fixtures. Keep real database URLs,
passwords, OAuth secrets, and API keys only in local env files or deployment
secret stores.

## Follow-up to fully flip the primary datasource

The default `prisma/schema.prisma` is still SQLite to avoid breaking current
local and CI workflows in the same PR that introduces PostgreSQL coverage. The
remaining flip is to make the PostgreSQL schema the default, archive or replace
the SQLite migration history, and require the PostgreSQL path in all deployment
pipelines after a dry-run data migration succeeds.
