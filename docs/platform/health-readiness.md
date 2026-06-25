# Health, readiness and runtime configuration

ReadWise exposes cheap liveness and richer readiness probes for deploys,
containers, local parity testing, and operators. The readiness path validates
only local dependencies and configuration; it does not make slow calls to Azure,
OAuth providers, push services, or object storage endpoints.

## Endpoints

| Endpoint | Handler | Runtime | Purpose |
| --- | --- | --- | --- |
| `GET /api/health` | `src/app/api/health/route.ts` | default | Liveness: process is up. Cheap and does not touch DB/providers. |
| `GET /api/ready` | `src/app/api/ready/route.ts` | `nodejs` | Readiness: runtime config, database connectivity, Prisma migration state, and optional-provider status. |

## `/api/health`

Use this for load balancer liveness checks. It is intentionally minimal and
should keep returning 200 as long as the Next.js process can route requests.

## `/api/ready`

Readiness returns HTTP 200 when the app is ready and HTTP 503 when required
checks fail. Response shape:

```json
{
  "status": "ready",
  "timestamp": "2026-06-23T00:00:00.000Z",
  "checks": {
    "db": "ok",
    "migrations": "ok",
    "config": "ok",
    "providers": {
      "ai": "configured",
      "speech": "unconfigured",
      "push": "unconfigured",
      "googleOAuth": "configured",
      "azureAdOAuth": "unconfigured",
      "storage": "unconfigured"
    }
  },
  "migrations": {
    "pending": 0,
    "unfinished": 0,
    "unapplied": 0,
    "unappliedNames": []
  },
  "config": {
    "required": {},
    "optional": {},
    "tuning": {},
    "errors": [],
    "warnings": []
  }
}
```

Actual `config.required` / `config.optional` entries include checked env names,
missing vars, issues, and configured/required flags.

### Blocking checks

The probe is unavailable when any of these fail:

| Check | Failure condition |
| --- | --- |
| `db` | `prisma.$queryRaw\`SELECT 1\`` throws. |
| `migrations` | `_prisma_migrations` cannot be read, any non-rolled-back migration has no `finished_at`, or any migration directory under the configured schema path has not been applied. |
| `config` | Required runtime config is missing or malformed. |

### Migration directory selection

`PRISMA_SCHEMA_PATH` controls which migration directory is checked:

- SQLite/default: `prisma/schema.prisma` → `prisma/migrations`.
- PostgreSQL parity/prod: `prisma/postgresql/schema.prisma` →
  `prisma/postgresql/migrations`.

Keep `DATABASE_URL` and `PRISMA_SCHEMA_PATH` in sync. A PostgreSQL URL with the
SQLite schema path (or vice versa) gives misleading readiness/migration results.

## Runtime config validation

`src/lib/runtime-config/` is the server-only source of truth. Required sections:

| Section | Env | Notes |
| --- | --- | --- |
| Database | `DATABASE_URL` | Must be a SQLite `file:` URL or PostgreSQL URL. |
| Auth | `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | Secret must be non-placeholder and at least 32 chars; URL must be HTTP(S). |

Optional providers are evaluated independently:

| Provider | Required env for configured status | Degradation behavior |
| --- | --- | --- |
| AI | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION` | Missing/partial config disables AI helpers or returns feature fallbacks. |
| Speech | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` (`VOICE`/`OUTPUT_FORMAT` optional) | Narration degrades gracefully. |
| Push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Reminder sends become no-ops. |
| Google OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Provider is omitted. |
| Azure AD OAuth | `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, `AZURE_AD_TENANT_ID` | Provider is omitted. |
| Storage | `MEDIA_STORAGE` plus backend-specific values | DB base64 fallback remains available. |

Optional providers report:

- `unconfigured` when no env vars for the provider are present,
- `configured` when all required values are present and valid,
- `degraded` when partially configured or malformed but fallback behavior exists.

Optional `degraded` / `unconfigured` does **not** make readiness return 503.

## Tuning validation

The tuning check validates shape only and falls back to defaults on malformed
values. It covers:

- `AI_REQUEST_TIMEOUT_MS`, `AI_MAX_RETRIES`, `SPEECH_TIMEOUT_MS`,
- `RATE_LIMIT_AI_REQUESTS`, `RATE_LIMIT_LOOKUP_REQUESTS`,
  `RATE_LIMIT_PUBLIC_REQUESTS`, `RATE_LIMIT_IMPORT_REQUESTS`,
  `RATE_LIMIT_ADMIN_JOB_REQUESTS`, `RATE_LIMIT_AUTH_REQUESTS`,
  `RATE_LIMIT_WINDOW_MS`,
- `LOG_LEVEL`.

Warnings are surfaced in readiness but do not block startup.

## Object-storage readiness

Storage modes:

| Mode | Readiness status |
| --- | --- |
| unset / `database` / `db` / `none` | `unconfigured` — expected DB base64 fallback. |
| `filesystem` / `local` / `fs` | `configured`. |
| `azure` with `AZURE_STORAGE_CONNECTION_STRING` or `AZURE_STORAGE_ACCOUNT` + `AZURE_STORAGE_KEY` | `configured`. |
| `azure` without credentials | `degraded` — falls back to DB base64. |
| unknown mode | `degraded` — falls back to database. |

No storage secrets are emitted in readiness JSON.

## Deployment guidance

- Use `/api/health` for process liveness.
- Use `/api/ready` for readiness/startup gates and Kubernetes readiness probes.
- Treat optional provider degradation as an operator warning, not an outage, unless
  your deployment explicitly requires that feature.
- For local development, use `npm run db:migrate` after pulling schema changes
  and `npm run db:reset` when you intentionally want a clean SQLite database.
- For Docker production, set both `DATABASE_URL` and `PRISMA_SCHEMA_PATH` through
  the platform secret/config mechanism.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `status: unavailable`, `checks.config = error` | Missing/placeholder `NEXTAUTH_SECRET`, bad `NEXTAUTH_URL`, or bad `DATABASE_URL`. | Compare `.env` with `.env.example`; generate a real secret. |
| `checks.db = error` | Database unreachable or wrong URL. | Check `DATABASE_URL`, local compose status, or managed DB networking. |
| `checks.migrations = error`, `unapplied > 0` | Repo has migration directories not present in `_prisma_migrations`. | Run the correct migration command for the configured schema. |
| `checks.providers.ai = degraded` | Some but not all Azure OpenAI env vars are set. | Fill all four vars or clear unused placeholders. |
| `checks.providers.storage = degraded` | `MEDIA_STORAGE=azure` without credentials. | Configure Azure Storage or set `MEDIA_STORAGE=database`. |
