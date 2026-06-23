# Database setup

ReadWise keeps the existing SQLite workflow as the default in this PR, and adds a
PostgreSQL parity lane that can run the same app code with a PostgreSQL-generated
Prisma client.

## Local PostgreSQL parity stack

```bash
docker compose up -d postgres redis
export DATABASE_URL="postgresql://readwise:readwise-dev-password@localhost:55432/readwise?schema=public"
export PRISMA_SCHEMA_PATH="prisma/postgresql/schema.prisma"
npm run prisma:generate:pg
npm run prisma:migrate:pg
npm run dev
```

The compose stack binds PostgreSQL to loopback only and uses a clearly dev-only
password. Production must set `DATABASE_URL` through the deployment secret
manager with real credentials and must not commit those values.

To switch back to SQLite after generating the PostgreSQL client, restore the
default client:

```bash
export DATABASE_URL="file:./dev.db"
export PRISMA_SCHEMA_PATH="prisma/schema.prisma"
npm run prisma:generate
```

## Reset local PostgreSQL state

This removes the local PostgreSQL volume and all local data:

```bash
docker compose down -v
docker compose up -d postgres redis
export DATABASE_URL="postgresql://readwise:readwise-dev-password@localhost:55432/readwise?schema=public"
export PRISMA_SCHEMA_PATH="prisma/postgresql/schema.prisma"
npm run prisma:migrate:pg
```

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
