# Release management runbook & deployment preflight checklist

This runbook covers the end-to-end release process for ReadWise: preflight
quality gates, migration steps for both database targets, deployment, smoke
verification, rollback decision tree, and post-release monitoring. Use it as a
checklist for every production change.

## Related runbooks and docs

- [`docs/platform/database-runbooks.md`](../platform/database-runbooks.md) —
  backup, restore, rollback, and disaster-recovery procedures (migration SQL
  review, restore drills, PostgreSQL target steps).
- [`docs/platform/health-readiness.md`](../platform/health-readiness.md) —
  `/api/health`, `/api/ready`, runtime config validation, migration checks, and
  provider degradation reference.
- [`docs/platform/ci.md`](../platform/ci.md) — CI quality gates, required PR
  checks, E2E tier policy, local reproduction steps, and the `.next` dev/build
  race warning.
- [`docs/observability/overview.md`](../observability/overview.md) — tracing,
  error aggregation, metrics, SLOs, and the investigation workflow
  (request id → logs → trace).
- [`docs/operations/admin-operations.md`](./admin-operations.md) — persistent
  job queue, worker lifecycle, audit logs, and operator checklists.

---

## 1. Pre-release preflight checklist

Run all checks against the release commit on a clean checkout (no dev server
running). The CI pipeline (`ci.yml`) executes the same checks; passing CI on
the branch is the minimum bar.

### 1.1 Quality gates (mirrors CI tiers)

```bash
# Tier 1 – fast checks (typecheck + lint)
npm run typecheck
npm run lint

# Tier 2 – unit tests (DB-free, mock-based)
npm test

# Tier 3 – production build
# Stop the dev server first; build and dev share .next/ (see docs/platform/ci.md §⚠️)
rm -rf .next
npm run build
```

All four required CI jobs must be green before proceeding:

| Gate | CI job name | Required |
| --- | --- | :-: |
| Typecheck + lint | `fast-checks` | ✅ |
| Unit tests | `unit-tests` | ✅ |
| Production build | `build` | ✅ |
| PostgreSQL migrate + integration | `db-integration` | ✅ |
| E2E smoke (Playwright) | `e2e-smoke` | post-merge |

E2E smoke runs automatically after merge to `main` and nightly; it is not a PR
gate. Verify the most recent nightly or post-merge E2E run is green before
promoting to production.

### 1.2 Schema parity check

Verifies that the SQLite schema and the PostgreSQL schema are in sync. Run
before any migration-bearing release:

```bash
npm run schema:check-parity
```

A non-zero exit or any reported drift means the two schemas have diverged.
Resolve before deploying migrations to either target.

### 1.3 API-catalog drift check

Detects unintentional API surface changes (added, removed, or renamed
endpoints):

```bash
npm run api-catalog
```

Compare the regenerated `docs/platform/api-catalog.json` against the
previously-committed version. Unexpected changes require review and a committed
catalog update before release.

### 1.4 Migration status review

Check that no unapplied migrations are waiting:

```bash
# SQLite target (default)
npx prisma migrate status

# PostgreSQL target (when PRISMA_SCHEMA_PATH is set to the pg schema)
npx prisma migrate status --schema prisma/postgresql/schema.prisma
```

Any `unapplied` output means the database is behind the codebase. Apply
migrations as described in §2 before starting the app.

### 1.5 Environment and readiness verification

Verify required runtime config and database connectivity before cutover:

```bash
curl --fail 'https://<staging-host>/api/ready'
```

Expected response (HTTP 200):

```json
{
  "status": "ready",
  "checks": {
    "db": "ok",
    "migrations": "ok",
    "config": "ok",
    "providers": { "...": "configured | unconfigured | degraded" }
  },
  "migrations": { "pending": 0, "unfinished": 0, "unapplied": 0 }
}
```

If `status` is not `"ready"`:

| Check | Failure | Fix |
| --- | --- | --- |
| `config = error` | Missing `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, or `DATABASE_URL` | Compare env with `.env.example`; fill all required vars. |
| `db = error` | Database unreachable | Verify `DATABASE_URL`, network access, or managed DB status. |
| `migrations = error` (unapplied > 0) | Migrations pending | Run the correct migrate command for the configured schema (§2). |

Optional provider `degraded` / `unconfigured` does **not** block readiness.
Treat it as an operator warning about feature availability, not an outage.
See [`docs/platform/health-readiness.md`](../platform/health-readiness.md) for
the full provider table.

### 1.6 Backup presence

Confirm a current backup exists before running migrations or swapping code. See
[`docs/platform/database-runbooks.md`](../platform/database-runbooks.md) for
backup commands. Record the backup artifact name, checksum, and operator in the
team operations log.

### 1.7 Worker status

Check the admin job queue dashboard at `/admin/jobs` or `GET /api/admin/jobs`.
Active or running jobs should be allowed to finish before a deployment that
includes schema changes. For large migrations that may hold locks, pause
scheduled workers first.

---

## 2. Migration deployment steps

> **Important:** Always take a backup before running migrations. Review generated
> SQL under `prisma/migrations/<timestamp>/migration.sql` for destructive
> operations, long-hold locks, or index creations that may need concurrent
> creation on PostgreSQL. See
> [`docs/platform/database-runbooks.md §Migration release steps`](../platform/database-runbooks.md#migration-release-steps).

### 2.1 SQLite target (current default)

```bash
export DATABASE_URL='file:./<target>.db'
npm run db:migrate
```

`npm run db:migrate` runs `prisma migrate deploy && prisma generate`. Verify
readiness after migration:

```bash
curl --fail 'https://<staging-host>/api/ready'
```

### 2.2 PostgreSQL target

Use when `prisma/postgresql/schema.prisma` is the deployed schema and
`DATABASE_URL` is a PostgreSQL URL:

```bash
export DATABASE_URL='postgresql://<user>:<password>@<host>:5432/<db>?schema=public'
export PRISMA_SCHEMA_PATH='prisma/postgresql/schema.prisma'
npm run prisma:migrate:pg
```

`npm run prisma:migrate:pg` runs
`prisma migrate deploy --schema prisma/postgresql/schema.prisma`. Generate the
client afterward:

```bash
npm run prisma:generate:pg
```

Verify:

```bash
curl --fail 'https://<host>/api/ready'
```

Keep `DATABASE_URL` and `PRISMA_SCHEMA_PATH` in sync. A PostgreSQL URL with the
SQLite schema path (or vice versa) produces misleading readiness and migration
results.

---

## 3. Application deployment steps

Order of operations for a standard release (no major schema change):

1. **Verify CI is green** on the release commit (`main` branch after merge).
2. **Complete preflight** — §1 checklist passes for the target environment.
3. **Take a backup** — record artifact name and checksum.
4. **Apply migrations** (§2) on the target database if the release carries
   migrations.
5. **Deploy application code** — use the platform's rolling-deploy or
   blue/green mechanism.
6. **Wait for the app to report ready** — poll `/api/ready` until `status:
   "ready"` or the platform's readiness probe clears.
7. **Start or restart workers** — after the web tier is healthy.
8. **Run smoke checks** (§4).
9. **Record the release** in the team operations log: date, operator, commit
   SHA, migration version, environment, and backup artifact.

For a migration-only release (schema change, no app code change), run steps
3–2–6 only (migrate, verify readiness, validate counts).

### Static assets and service worker

The Next.js build embeds asset hashes into HTML. After a build and deploy,
cached service workers may serve stale references until they check in. No
explicit cache-bust command is needed beyond a clean build (`rm -rf .next &&
npm run build`). Clients will refresh automatically as the service worker
updates.

### Optional providers

Optional providers (AI, Speech, Push, OAuth, Storage) degrade gracefully when
unconfigured. If a new release adds or changes required env vars for an optional
provider, update the target environment's secrets before deploying. Verify
provider status in `/api/ready` response under `checks.providers`.

---

## 4. Post-deployment smoke checks

Run these immediately after the app is up:

```bash
# Liveness
curl --fail 'https://<host>/api/health'

# Readiness (migrations, config, providers)
curl --fail 'https://<host>/api/ready'
```

Manual spot checks:

- [ ] Admin can sign in and reach `/admin`.
- [ ] `/admin/jobs` shows no unexpected `DEAD_LETTER` or stuck `CLAIMED` jobs.
- [ ] Article list and a reader page load.
- [ ] Study list and settings page load.
- [ ] Worker can complete a single cycle without repeated errors:
  ```bash
  npm run worker -- --once
  ```

### SLO monitoring

After deployment, review SLO status at `GET /api/admin/slo`. Confirm that
interactive SLIs (sign-in availability, dashboard latency, reader latency) are
`ok` or `no_data` (no data is expected for fresh deployments). A `breaching`
status immediately post-deploy warrants investigation before declaring the
release healthy.

See [`docs/observability/overview.md §SLIs & SLOs`](../observability/overview.md#3-slis--slos-rw-034)
for the catalog and breach-review procedure.

---

## 5. Rollback decision tree

Prefer roll-forward fixes for additive schema changes. Prisma does not generate
safe down migrations automatically.

### 5.1 Code-only failure (no migration in this release)

Redeploy the previous application image or commit. The schema is unchanged so
the previous app is compatible.

```
Symptom: errors/latency spike after deploy, no migration changes
Action:  redeploy previous artifact → verify /api/ready → smoke checks
```

### 5.2 Config / environment change failure

Restore previous secret or environment variable values without a code redeploy.
Restart the app after config changes.

```
Symptom: config = error or providers degraded where previously configured
Action:  correct env vars in secrets manager → restart app → /api/ready check
```

### 5.3 Provider outage (AI, Speech, Push, Storage)

Optional providers degrade gracefully; a provider outage alone does not require
rollback. Confirm degradation is limited to the affected provider:

- AI: `checks.providers.ai = degraded` — AI features return fallbacks; core
  reading is unaffected.
- Speech: narration unavailable; article reading continues.
- Push: reminders become no-ops; no data loss.
- Storage: falls back to DB base64 when `MEDIA_STORAGE=database`.

If the provider outage causes business-critical data loss or data corruption,
treat it as a data-corruption rollback (§5.5).

### 5.4 Additive migration failure (new columns / tables)

The migration ran but the app is behaving incorrectly due to the new schema:

1. Fix the schema or data in a new forward migration.
2. Deploy the fix migration and application code together.
3. Verify `/api/ready` and smoke checks.

Do not restore from backup unless data was corrupted.

### 5.5 Destructive or corrupting migration

```
Symptom: data loss, integrity errors, rows missing or mangled after migration
Action:
  1. Stop the app and workers immediately.
  2. Point DATABASE_URL at the pre-migration backup (do not overwrite the
     failed database until investigation is complete).
  3. Start the previous application version against the restored database.
  4. Verify /api/ready (migrations ok, db ok).
  5. Run smoke checks — confirm data counts are plausible.
  6. Record the incident: date, operator, failed migration name, backup used,
     and timeline.
  7. Drop or archive the failed database only after the restore is confirmed
     good.
```

See [`docs/platform/database-runbooks.md §Rollback strategies`](../platform/database-runbooks.md#rollback-strategies)
for full restore commands.

### 5.6 Worker-related data issue

Stop workers first. Current processing is idempotent and cache-first; failed
jobs remain in the queue with `FAILED` or `DEAD_LETTER` status and can be
inspected at `/admin/jobs`. After the schema or data fix:

```bash
npm run worker -- --once
```

Preserve dead-letter rows for investigation. Do not archive without reviewing
`lastError` / `errorHistory`.

---

## 6. Post-release monitoring

For at least 30 minutes after a release (longer for migration-bearing releases):

- Monitor logs for `error.captured` and `error.alert` events (see
  [`docs/observability/overview.md §Error aggregation`](../observability/overview.md#2-error-aggregation-rw-033)).
- Check `GET /api/admin/slo` — interactive SLIs should be `ok`.
- Check `GET /api/admin/metrics` — review `readwise_api_requests_total`,
  `readwise_worker_jobs_total`, and `readwise_errors_captured_total` for
  unexpected spikes.
- Confirm `/admin/jobs` shows no growing backlog or repeated `FAILED` jobs.
- If tracing is enabled (`OTEL_EXPORTER_OTLP_ENDPOINT` or
  `TRACING_ENABLED=true`), check the trace collector for slow or erroring spans
  on critical routes.

A release is declared healthy when:

- `/api/ready` is `"ready"` with `migrations.unapplied = 0`.
- All required CI gates passed on the deployed commit.
- No unexpected error rate increase in logs or metrics.
- SLO status is `ok` or `no_data` (no data for brand-new flows).
- Smoke checks pass.
- The release has been recorded in the team operations log.

---

## Quick command reference

| Task | Command |
| --- | --- |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Unit tests | `npm test` |
| Integration tests (PostgreSQL) | `npm run test:db` |
| E2E smoke | `npm run test:e2e:smoke` |
| Production build (clean) | `rm -rf .next && npm run build` |
| SQLite migrate + generate | `npm run db:migrate` |
| PostgreSQL migrate | `npm run prisma:migrate:pg` |
| PostgreSQL client generate | `npm run prisma:generate:pg` |
| Migration status (SQLite) | `npx prisma migrate status` |
| Migration status (PostgreSQL) | `npx prisma migrate status --schema prisma/postgresql/schema.prisma` |
| Schema parity check | `npm run schema:check-parity` |
| API catalog (drift check) | `npm run api-catalog` |
| Liveness probe | `curl --fail 'https://<host>/api/health'` |
| Readiness probe | `curl --fail 'https://<host>/api/ready'` |
| SLO status | `curl --fail 'https://<host>/api/admin/slo'` |
| Worker single-cycle run | `npm run worker -- --once` |
