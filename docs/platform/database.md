---
type: "reference"
status: "current"
last_updated: "2026-07-01"
description: "Documents SQLite/PostgreSQL database setup, schema generation, migration workflows, and local parity stack. Captures current Prisma schemas, DATABASE_URL/PRISMA_SCHEMA_PATH usage, migration tests, and data migration notes."
---

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

---

## Schema governance

This section records the parity contract, allowed differences, the schema-change
workflow, and the checklist to follow for every model change.

### Parity contract

`prisma/schema.prisma` (SQLite) and `prisma/postgresql/schema.prisma` must be
**byte-identical** except for a single line in the `datasource db` block:

| File | datasource provider line |
|------|--------------------------|
| `prisma/schema.prisma` | `provider = "sqlite"` |
| `prisma/postgresql/schema.prisma` | `provider = "postgresql"` |

Every other byte — models, enums, relations, indexes, comments, whitespace —
must match exactly. Drift is caught by `npm test` (via `tests/db-schema.test.ts`)
and by the standalone parity script (see below).

### Allowed differences

Only the following differences are permitted between the two schema files:

| What | SQLite value | PostgreSQL value |
|------|-------------|-----------------|
| `datasource db.provider` | `"sqlite"` | `"postgresql"` |

Differences in migration SQL (`prisma/migrations/*/migration.sql` vs
`prisma/postgresql/migrations/*/migration.sql`) are expected and allowed:
PostgreSQL emits `CREATE TYPE … AS ENUM` statements that SQLite omits, and uses
PostgreSQL-specific DDL for indexes and constraints. The migration SQL is
engine-generated; only the migration *directory names* (timestamps + slug) must
stay aligned between the two migration trees.

If a future schema change requires a provider-specific Prisma feature (e.g.
`@db.Text`, `@db.Uuid`, array types, or `directUrl`), record the divergence
explicitly in this section and update `scripts/check-schema-parity.ts` to
account for it.

### Parity check script

Run the parity check manually or in CI:

```bash
npm run schema:check-parity
```

The script (`scripts/check-schema-parity.ts`) is deterministic and requires no
database connection. It exits 0 when both schemas and both migration directory
listings are in parity, and exits 1 with a diff when drift is detected.

### Schema-change workflow

Follow this sequence every time you add, remove, or rename a model field,
relation, index, enum value, or unique constraint:

1. **Edit `prisma/schema.prisma`** — make the intended change.
2. **Mirror the edit to `prisma/postgresql/schema.prisma`** — apply the
   identical change (only the provider line should differ).
3. **Run the parity check** — `npm run schema:check-parity` must exit 0.
4. **Generate the SQLite migration**:
   ```bash
   npx prisma migrate dev --name <slug>
   ```
5. **Generate the PostgreSQL migration** (requires a running PostgreSQL
   instance; see §Migration and integration checks):
   ```bash
   npx prisma migrate dev --schema prisma/postgresql/schema.prisma --name <slug>
   ```
   The migration *directory name* (timestamp + slug) generated in step 4 and
   step 5 must match. If the timestamps differ, rename one directory so both
   trees share the same name.
6. **Commit all four artefacts together** — both schema files and both
   migration directories must land in the same commit:
   ```
   prisma/schema.prisma
   prisma/postgresql/schema.prisma
   prisma/migrations/<timestamp>_<slug>/migration.sql
   prisma/postgresql/migrations/<timestamp>_<slug>/migration.sql
   ```
7. **Run tests** — `npm test` (schema parity) and optionally `npm run test:db`
   (PostgreSQL integration) must pass.

### Schema-change checklist

Use this checklist for every schema change before opening a pull request.
For the full privacy, retention, and export guidance see
[`docs/platform/schema-change-checklist.md`](./schema-change-checklist.md)
and the [data-lifecycle matrix](../security/data-lifecycle-matrix.md).

- [ ] **Parity** — `npm run schema:check-parity` exits 0.
- [ ] **Migration committed** — new migration directories are present in both
  `prisma/migrations/` and `prisma/postgresql/migrations/` with matching names.
- [ ] **Cascades** — foreign-key `onDelete`/`onUpdate` behaviour is intentional.
  Hard-delete cascades that silently destroy audit or analytics rows are
  often wrong; prefer `Restrict` or `SetNull` with an explicit design decision.
- [ ] **Visibility / tenancy** — new content models include an `ArticleVisibility`
  or equivalent field. Rows without an owner or visibility scope should be
  impossible by constraint.
- [ ] **Audit retention** — rows that record user or operator actions (audit logs,
  AI calls, job history) must not be cascade-deleted when the parent user or
  article is removed unless a separate retention policy explicitly allows it.
- [ ] **Analytics retention** — analytics event rows must not vanish when the
  source article or user is deleted. Use `SetNull` with nullable FKs, or
  denormalize the relevant identifiers at write time.
- [ ] **Generated media** — if the new model references generated speech, images,
  or other binary media stored outside the database, document which storage
  abstraction owns the lifecycle and whether deletion cascades to the storage
  layer.
- [ ] **Seed / test data** — if new required fields or non-nullable relations are
  added, update `scripts/seed.ts` and any test factories accordingly.  See
  [test data and fixture governance](./test-data-governance.md#3-schema-change-obligations)
  for the full checklist.
- [ ] **Indexes** — every column used in `WHERE`, `ORDER BY`, or `@@unique`
  across API or worker queries has an explicit `@@index` (or `@unique`).
- [ ] **Comments** — add a brief schema comment explaining non-obvious design
  decisions (visibility rules, retention policies, the purpose of nullable
  fields). Long domain narratives belong in `docs/`; keep schema comments concise.

### Generated and local database artifacts

The following files must not be committed as source-of-truth:

| Path pattern | Reason |
|---|---|
| `prisma/dev.db`, `prisma/*.db` | Local development database; regenerated by `npm run db:reset` |
| `*.db.bak`, `*.db-journal` | SQLite temporary and backup files |
| `/backups/` | One-time data-export artefacts; treat as sensitive production data |

All patterns above are already covered by `.gitignore`. If a new tool produces
database-derived artefacts (e.g. schema dumps, ER diagrams, introspection
output), add them to `.gitignore` before committing.
