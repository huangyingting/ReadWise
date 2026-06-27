# Runtime configuration and process.env allowlist

`src/lib/runtime-config/` is the server-side owner of all business configuration
and environment-variable parsing. External callers must consume typed helpers from
this module rather than reading `process.env` directly.

## Direct `process.env` allowlist

Some narrow patterns are permitted to read `process.env` outside
`src/lib/runtime-config/`. Each exception below is explicit, justified, and
should not grow without review. New business config reads must go into a typed
helper in this module.

### 1. `NODE_ENV` — framework/runtime mode flag

Permitted everywhere. Next.js statically replaces these references at build time.
Covered by `process.env.NODE_ENV`.

| File | Purpose |
| --- | --- |
| `src/components/ServiceWorkerRegister.tsx` | Skip SW registration outside production. |
| `src/lib/api-handler.ts` | Suppress internal error details in production responses. |
| `src/lib/auth.ts` | Secure-cookie posture for NextAuth session cookies. |
| `src/lib/observability/errors.ts` | Tag Sentry events with the runtime environment name. |
| `src/lib/prisma.ts` | Prisma query logging verbosity (dev vs. prod). |
| `src/lib/security/headers.ts` | Security header defaults differ between dev and prod. |

### 2. `NEXT_RUNTIME` — Next.js edge / Node.js runtime discriminator

Permitted in framework boundary modules. Next.js statically replaces this at
build time; the `=== "nodejs"` guard is required to gate Node.js-only imports
behind an edge-safe export.

| File | Purpose |
| --- | --- |
| `src/instrumentation.ts` | Guard Node.js-only observability instrumentation. |

### 3. `NEXT_PUBLIC_*` — public client-side display and metadata

Public env vars are intentionally baked into the client bundle by Next.js; they
carry no secrets. Reading them outside `runtime-config` is correct because they
are not server-only config.

| Variable | Files | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `src/app/layout.tsx`, `src/app/robots.ts`, `src/app/sitemap.ts` | Canonical site URL for Next.js metadata, Open Graph, robots.txt, and sitemap. |

### 4. `NEXTAUTH_URL` — site URL fallback in Next.js metadata files

`NEXTAUTH_URL` is the NextAuth framework adapter URL. It is read in the same
`siteUrl` expression as `NEXT_PUBLIC_SITE_URL` purely as a fallback for the
Next.js metadata base URL when `NEXT_PUBLIC_SITE_URL` is absent. This is a
**framework-level adapter use**, not a business config read. Any actual
authentication config validation happens in `src/lib/runtime-config/runtime.ts`.

| File | Purpose |
| --- | --- |
| `src/app/layout.tsx` | `metadataBase` URL for Next.js metadata generation. |
| `src/app/robots.ts` | Sitemap URL in the robots.txt response. |
| `src/app/sitemap.ts` | Canonical base URL for static and article sitemap entries. |

### 5. `DATABASE_URL` — thin Prisma infrastructure adapter

`src/lib/db-utils.ts` reads `DATABASE_URL` solely to derive whether the active
database is PostgreSQL (for Prisma raw-query dialect selection). This is a
thin infrastructure check, not a business config read; the authoritative
validation of `DATABASE_URL` lives in `src/lib/runtime-config/runtime.ts`.

| File | Purpose |
| --- | --- |
| `src/lib/db-utils.ts` | `isPostgresDatabase()` — dialect selection for raw SQL queries. |

### 6. Testing and CI guards (`src/lib/testing/`)

Environment reads in modules under `src/lib/testing/` are permitted because they
are test/CI infrastructure that must never enter production bundles.

| Variable | File | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `src/lib/testing/db-guard.ts` | Confirm test DATABASE_URL is not a real production DB. |
| `PLAYWRIGHT_DATABASE_URL` | `src/lib/testing/db-guard.ts` | E2E test database URL. |

---

## Feature kill switches

`src/lib/runtime-config/feature-flags.ts` exposes env-driven kill switches for
optional features that may need to be intentionally disabled in production (cost
containment, incident mitigation, staged rollout) even when provider credentials
are fully configured.

### Convention

| Env var | Default | Feature gated |
| --- | --- | --- |
| `FEATURE_AI_ENABLED` | `true` | AI chat completions, translation, quiz, vocabulary, summarisation |
| `FEATURE_TTS_ENABLED` | `true` | Azure Speech text-to-speech narration and word timings |
| `FEATURE_PUSH_ENABLED` | `true` | Web Push (VAPID) notification delivery |
| `FEATURE_SCRAPER_ENABLED` | `true` | Web scraper — article import and background crawl |
| `FEATURE_TODAY_SESSION_ENABLED` | `true` | Today Session workflow — `/today` route, Dashboard Today card, default learner landing |

Set to `"false"`, `"0"`, or `"off"` to disable. Any other value (or absent) keeps
the feature enabled. Disabled state degrades identically to the unconfigured
provider path: callers receive `null` or a graceful fallback result; no exceptions
are thrown. Default behavior is unchanged when the variable is absent.

### Usage

```ts
import { isFeatureEnabled } from "@/lib/runtime-config/feature-flags";

if (!isFeatureEnabled("ai")) {
  // degrade like unconfigured
}
```

---

## Runtime-config module reference

| Module | Exported as | Env vars owned |
| --- | --- | --- |
| `src/lib/runtime-config/ai.ts` | `ai` | `AZURE_OPENAI_*`, `AI_PROVIDER`, `AI_MODERATION_ENABLED`, `AI_REQUEST_TIMEOUT_MS`, `AI_MAX_RETRIES` |
| `src/lib/runtime-config/analytics.ts` | `analytics` | Analytics provider config |
| `src/lib/runtime-config/database.ts` | `database` | `PRISMA_SCHEMA_PATH` |
| `src/lib/runtime-config/dictionary.ts` | `dictionary` | `DICTIONARY_PROVIDER`, `LOCAL_DICTIONARY_DIR`, `LOCAL_DICTIONARY_LANGUAGE` |
| `src/lib/runtime-config/feature-flags.ts` | `featureFlags` | `FEATURE_AI_ENABLED`, `FEATURE_TTS_ENABLED`, `FEATURE_PUSH_ENABLED`, `FEATURE_SCRAPER_ENABLED`, `FEATURE_TODAY_SESSION_ENABLED` |
| `src/lib/runtime-config/oauth.ts` | `oauth` | `GOOGLE_CLIENT_*`, `AZURE_AD_*` |
| `src/lib/runtime-config/observability.ts` | `observability` | `LOG_LEVEL`, Sentry/telemetry DSN |
| `src/lib/runtime-config/push.ts` | `push` | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| `src/lib/runtime-config/rate-limit.ts` | `rateLimit` | `RATE_LIMIT_*`, `RATE_LIMIT_WINDOW_MS` |
| `src/lib/runtime-config/runtime.ts` | — (readiness only) | Composes all sections for `/api/ready`. Validates `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`. |
| `src/lib/runtime-config/scraper.ts` | `scraper` | `SCRAPER_MAX_BYTES`, `SCRAPER_TIMEOUT_MS`, `SCRAPER_HTML_NORMALIZE` |
| `src/lib/runtime-config/security.ts` | `security` | Security posture config |
| `src/lib/runtime-config/speech.ts` | `speech` | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, `AZURE_SPEECH_OUTPUT_FORMAT`, `VOICE` |
| `src/lib/runtime-config/storage.ts` | `storage` | `MEDIA_STORAGE`, `MEDIA_STORAGE_DIR`, `AZURE_STORAGE_*` |

All modules are server-only. Never import them from a `"use client"` file or any
module that can enter a client bundle.

## Adding new business config

1. Add a typed helper in the appropriate `src/lib/runtime-config/<subsystem>.ts`
   module (or create a new one following the pattern in `env.ts`).
2. Export the helper from `src/lib/runtime-config/index.ts`.
3. Add the env var to `.env.example` with a comment.
4. If the var affects readiness, update `src/lib/runtime-config/runtime.ts` and
   the runtime config table in `docs/platform/health-readiness.md`.
5. Update the module reference table above.

## Import boundary enforcement

All `src/lib/runtime-config/*` modules are **server-only**. Importing them from
a `"use client"` file or any module that can enter a client bundle is blocked by
the ESLint rule `readwise/no-server-imports-in-client` (REF-076).

The rule is defined in `eslint-rules/no-server-imports-in-client.js` and
automatically covers `@/lib/runtime-config` and all its submodules. If you add
a new runtime-config module, verify the rule catches it:

```sh
# Verify the rule flags a client import of the new module
npx eslint --no-eslintrc --rule '{"readwise/no-server-imports-in-client": "error"}' \
  --rulesdir eslint-rules \
  --stdin --stdin-filename src/components/TestWidget.tsx \
  <<< '"use client"; import { myConfig } from "@/lib/runtime-config/my-new-module";'
```

If a file genuinely must import a runtime-config module from a client-adjacent
path, add a justified allowlist entry to
`eslint-rules/import-boundary-allowlist.json` following the instructions in
[`docs/architecture/0010-subsystem-boundaries-and-import-contracts.md §How to add an allowlist entry`](../architecture/0010-subsystem-boundaries-and-import-contracts.md).
