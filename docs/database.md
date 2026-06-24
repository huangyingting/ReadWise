# Database setup

ReadWise uses the SQLite Prisma schema as the default local development
database. The package exposes only two database commands for day-to-day work:

```bash
npm run db:migrate
npm run db:reset
```

- `db:migrate` applies the current baseline migration and regenerates the Prisma
  client.
- `db:reset` drops and recreates the local SQLite database from the current
  baseline. It is destructive; back up `prisma/dev.db` first if you need to keep
  local data.

The current local fixture is intentionally small: 10 articles with flat
`.media/speech/<file>.mp3` audio files.

## Migration and integration checks

The PostgreSQL baseline lives in `prisma/postgresql/migrations/`. Run checks
against a disposable PostgreSQL database:

```bash
export DATABASE_URL="postgresql://readwise:readwise-dev-password@localhost:55432/readwise?schema=public"
export PRISMA_SCHEMA_PATH="prisma/postgresql/schema.prisma"
npx prisma generate --schema prisma/postgresql/schema.prisma
npx prisma migrate deploy --schema prisma/postgresql/schema.prisma
npm run test:db
npx prisma migrate status --schema prisma/postgresql/schema.prisma
```

The normal `npm test` suite remains mocked and DB-free; `npm run test:db` is the
real-engine coverage for migrations and representative constraints.

Current PostgreSQL integration coverage applies the single PostgreSQL baseline
from scratch in CI against an isolated schema and verifies ownership/privacy
constraints, scoped uniqueness/null behavior, cascades, audit-log retention,
JSONB columns, article search indexes/FTS, and the current article-state worker
selection.

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
3. Create an empty PostgreSQL database and apply `npx prisma migrate deploy --schema prisma/postgresql/schema.prisma`.
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
the SQLite baseline, and require the PostgreSQL path in all deployment
pipelines after a dry-run data migration succeeds.
