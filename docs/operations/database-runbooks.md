# Database backup, restore, migration, and rollback runbooks

These runbooks cover the current SQLite deployment and the planned
PostgreSQL production target from [ADR-0001](../adr/0001-postgresql-primary-database.md).
They are intentionally secret-safe: examples use placeholders only.

## Ownership, frequency, and retention

| Environment | Owner | Backup frequency | Retention | Restore drill |
| --- | --- | --- | --- | --- |
| Local/dev SQLite | Developer running the instance | Before risky migrations or imports | Until work is merged or discarded | Optional local smoke restore |
| Staging | On-call/operator | Daily and before every migration | 7 daily + 4 weekly | Monthly, and before first production launch |
| Production PostgreSQL target | On-call/operator | Managed snapshots daily + logical dump before migrations | 14 daily + 8 weekly + 12 monthly | Quarterly and after major schema changes |

Backups must be encrypted at rest, access-controlled, and stored outside the
application host. Record each backup or restore drill in the team operations log
with date, operator, source environment, destination environment, artifact name,
migration version, validation result, and cleanup confirmation.
The local `./backups/` path used in examples is gitignored, but production
artifacts should live in approved backup storage rather than the repository.

## Data and secret boundaries

Database backups are sensitive. They include users, profiles, reading progress,
saved vocabulary, private article content, NextAuth sessions, provider account
rows, AI-derived content, and currently inline speech audio. ADR-0007 proposes
moving generated/imported media to object storage; until then, SQLite/PostgreSQL
database backups also carry generated speech payloads.

- Never include `.env*`, OAuth client secrets, Azure keys, VAPID private keys, or
  shell history in database backup archives.
- Do not create ad-hoc CSV exports of `Account`, `Session`, user profile,
  private article, or audit-log tables.
- When restoring production data into staging, invalidate active sessions and
  OAuth account tokens before enabling app access.
- Use placeholder credentials in tickets, PRs, and docs. Store real connection
  strings only in the approved secrets manager.

## Current state: SQLite backup

Use SQLite's online backup command where possible. Replace paths with the actual
database file and backup destination.

```bash
export DATABASE_URL='file:./dev.db'
mkdir -p ./backups
sqlite3 ./prisma/dev.db ".backup './backups/readwise-YYYYMMDD-HHMMSS.db'"
sqlite3 './backups/readwise-YYYYMMDD-HHMMSS.db' 'PRAGMA integrity_check;'
sha256sum './backups/readwise-YYYYMMDD-HHMMSS.db' > './backups/readwise-YYYYMMDD-HHMMSS.db.sha256'
```

If `sqlite3` is unavailable, stop the app and worker first, then copy the file:

```bash
npm run worker -- --once
# stop web/worker processes before copying a live SQLite file
cp ./prisma/dev.db './backups/readwise-YYYYMMDD-HHMMSS.db'
```

## Current state: SQLite restore and verification

Restore into an isolated path first; never overwrite the only known-good copy.

```bash
sha256sum --check './backups/readwise-YYYYMMDD-HHMMSS.db.sha256'
cp './backups/readwise-YYYYMMDD-HHMMSS.db' ./prisma/dev.db.restore
export DATABASE_URL='file:./dev.db.restore'
npx prisma migrate status --schema prisma/schema.prisma
npx prisma db execute --schema prisma/schema.prisma --stdin <<'SQL'
PRAGMA integrity_check;
SQL
sqlite3 ./prisma/dev.db.restore <<'SQL'
.headers on
.mode column
PRAGMA integrity_check;
SELECT COUNT(*) AS users FROM User;
SELECT COUNT(*) AS articles FROM Article;
SQL
npm run typecheck
```

For a real restore, stop all app and worker processes, replace the database file,
start the app, and check `/api/ready`:

```bash
cp './backups/readwise-YYYYMMDD-HHMMSS.db' ./prisma/dev.db
npm run start
curl --fail 'https://<app-host>/api/ready'
```

## PostgreSQL target: backup

These PostgreSQL steps are target-state runbooks for after the Prisma datasource
provider has been migrated from `sqlite` to `postgresql` in
`prisma/schema.prisma`, or when an equivalent PostgreSQL schema file is supplied
with `--schema`. With the current SQLite Prisma schema, Prisma commands that use
a PostgreSQL `DATABASE_URL` are expected to fail; use the SQLite sections above
until the PostgreSQL migration lands. Native PostgreSQL tools (`pg_dump`,
`pg_restore`, `psql`) are still appropriate for databases that already exist on
PostgreSQL.

Prefer managed point-in-time recovery snapshots for production. Also take a
logical dump before Prisma migrations so a rollback artifact is tied to the
release.

```bash
export DATABASE_URL='postgresql://<user>:<password>@<host>:5432/<db>?schema=public'
mkdir -p ./backups
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file './backups/readwise-YYYYMMDD-HHMMSS.dump'
sha256sum './backups/readwise-YYYYMMDD-HHMMSS.dump' > './backups/readwise-YYYYMMDD-HHMMSS.dump.sha256'
pg_restore --list './backups/readwise-YYYYMMDD-HHMMSS.dump' | head
```

Use a dedicated backup role with read-only privileges. For multi-tenant or
private-content work from ADR-0002/ADR-0008, keep production dumps encrypted and
restore only to environments with equivalent access controls.

## PostgreSQL target: staging restore drill

Run this drill monthly and before the first production launch. Use a disposable
staging database name so the current staging database remains available until the
drill passes.

```bash
createdb 'readwise_restore_drill_YYYYMMDD'
pg_restore \
  --dbname 'postgresql://<staging-user>:<password>@<host>:5432/readwise_restore_drill_YYYYMMDD?schema=public' \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  './backups/readwise-YYYYMMDD-HHMMSS.dump'

export DATABASE_URL='postgresql://<staging-user>:<password>@<host>:5432/readwise_restore_drill_YYYYMMDD?schema=public'
npx prisma migrate status --schema prisma/schema.prisma
psql "$DATABASE_URL" <<'SQL'
SELECT COUNT(*) AS users FROM "User";
SELECT COUNT(*) AS articles FROM "Article";
SELECT COUNT(*) AS sessions FROM "Session";
SQL
npm run typecheck
curl --fail 'https://<staging-host>/api/ready'
```

Before exposing the restored app to testers, invalidate copied sessions:

```bash
psql "$DATABASE_URL" <<'SQL'
DELETE FROM "Session";
-- If provider tokens are present in Account rows, clear token columns before tester access.
SELECT COUNT(*) AS remaining_sessions FROM "Session";
SQL
```

Pass criteria: migration status is clean, `/api/ready` succeeds, admin login works
with staging credentials, article listings load, a reader page opens, and the
worker can process `npm run worker -- --once` without corrupting data. Drop the
drill database after evidence is recorded.

## Migration release steps

Prisma migrations are forward-only release artifacts. Review SQL before it
reaches production.

1. Create migrations locally:
   ```bash
   npx prisma migrate dev --name <short_change_name>
   npm run typecheck
   npm test
   ```
2. Review generated SQL under `prisma/migrations/<timestamp>_<name>/migration.sql`.
   Check for destructive operations, long locks, data rewrites, and indexes that
   may need concurrent creation in PostgreSQL.
3. Deploy to staging:
   - **Current SQLite staging:** use this path while `prisma/schema.prisma`
     still has `provider = "sqlite"`. Replace the filename with the SQLite
     database file used by staging.
     ```bash
     export DATABASE_URL='file:./staging.db'
     mkdir -p ./backups
     sqlite3 ./prisma/staging.db ".backup './backups/staging-pre-migration-YYYYMMDD.db'"
     DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy --schema prisma/schema.prisma
     sqlite3 ./prisma/staging.db 'SELECT COUNT(*) AS users FROM User;'
     curl --fail 'https://<staging-host>/api/ready'
     npm run worker -- --once
     ```
   - **PostgreSQL target staging:** use this only after the deployed Prisma
     schema provider is `postgresql`, or when an equivalent PostgreSQL schema is
     supplied with `--schema`.
     ```bash
     pg_dump "$STAGING_DATABASE_URL" \
       --format=custom \
       --no-owner \
       --no-acl \
       --file './backups/staging-pre-migration-YYYYMMDD.dump'
     DATABASE_URL="$STAGING_DATABASE_URL" npx prisma migrate deploy --schema prisma/schema.prisma
     psql "$STAGING_DATABASE_URL" -c 'SELECT COUNT(*) AS users FROM "User";'
     curl --fail 'https://<staging-host>/api/ready'
     npm run worker -- --once
     ```
4. Deploy to production:
   - Announce maintenance risk and pause scheduled workers if the migration may
     rewrite data or hold locks.
   - Take a pre-migration backup.
   - Deploy code and run `DATABASE_URL="$PRODUCTION_DATABASE_URL" npx prisma migrate deploy --schema prisma/schema.prisma`
     only after the deployed Prisma schema provider is `postgresql`.
   - Start the web app, then workers.
   - Verify `/api/ready`, logs, admin overview, article listings, reader pages,
     sign-in, and worker completion.

After the PostgreSQL Prisma migration, ADR-0005's planned persistent job table
and PostgreSQL row locking make migration order important: deploy schema first,
then code that writes new job states, then enable multiple workers.

## Rollback strategies

Prefer roll-forward fixes for additive migrations. Prisma does not generate safe
down migrations automatically.

- **Code-only failure:** redeploy the previous application image/commit. Keep the
  migrated schema only if the previous application can read it safely.
- **Additive schema failure:** ship a new migration that fixes the schema or data.
- **Destructive or corrupting migration:** stop app and workers, restore the
  pre-migration backup into a new database, point the app at the restored
  database, run verification, and only then retire the failed database.
- **Worker-related data issue:** stop workers first. Because current processing is
  idempotent and cache-first, retry with `npm run worker -- --once` after the
  schema/data fix. Preserve failed rows for investigation when ADR-0005 job
  tables are introduced.

Rollback verification mirrors restore verification: migration status clean,
readiness green, login works, critical pages load, counts are plausible, and
workers complete without repeated errors.

## Quick verification checklist

- `npx prisma migrate status` reports database and migrations are in sync.
- `curl --fail https://<host>/api/ready` succeeds.
- Admin can sign in and view `/admin`.
- Article list, reader page, study list, and settings page load.
- `npm run worker -- --once` completes or reports only expected fallback AI/Speech
  degradation.
- Backup artifact checksum is recorded and restore-drill artifacts are deleted or
  access-restricted.
