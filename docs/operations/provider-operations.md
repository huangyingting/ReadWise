---
type: "runbook"
status: "current"
last_updated: "2026-07-01"
description: "Documents common lifecycle and health model for optional external providers. Captures current provider states, credential rotation, outage response, degradation, drift handling, and operator actions."
---

# External provider lifecycle and health operations

This document defines the common lifecycle model for every external provider
ReadWise integrates with, and specifies how each provider reports configured,
degraded, disabled, and healthy states. It is the canonical reference for
operators rotating credentials, responding to outages, and verifying provider
health at runtime.

Cross-references:
[incident-response.md](./incident-response.md) ·
[capacity-planning.md](./capacity-planning.md) ·
[admin-operations.md](./admin-operations.md) ·
[docs/platform/health-readiness.md](../platform/health-readiness.md) ·
Issue #723 (kill-switch flags, planned)

---

## Table of contents

1. [Unified lifecycle model](#1-unified-lifecycle-model)
2. [Readiness / health signal convention](#2-readiness--health-signal-convention)
3. [AI provider (Azure OpenAI)](#3-ai-provider-azure-openai)
4. [Speech / TTS provider (Azure Speech)](#4-speech--tts-provider-azure-speech)
5. [Push provider (VAPID / Web Push)](#5-push-provider-vapid--web-push)
6. [Media storage provider](#6-media-storage-provider)
7. [Scraper content sources](#7-scraper-content-sources)
8. [OAuth providers (Google, Azure AD)](#8-oauth-providers-google-azure-ad)
9. [Observability exporter (OpenTelemetry)](#9-observability-exporter-opentelemetry)
10. [Operational tasks — common patterns](#10-operational-tasks--common-patterns)
11. [Convergence checklist](#11-convergence-checklist)

---

## 1. Unified lifecycle model

All optional providers follow the same lifecycle. States are named consistently
across readiness responses, structured log lines, and this document.

```
            env vars absent
           ┌───────────────────┐
           ▼                   │
  ┌──────────────────┐         │  clear env vars
  │   UNCONFIGURED   │◄────────┘
  │ (feature no-ops) │
  └────────┬─────────┘
           │ all required vars present
           ▼
  ┌──────────────────┐
  │    CONFIGURED    │  credentials accepted; feature enabled
  └────────┬─────────┘
           │ provider call fails / partial config
           ▼
  ┌──────────────────┐
  │    DEGRADED      │  fallback active; feature partially works
  └────────┬─────────┘
           │ sustained failure or operator kill-switch (#723)
           ▼
  ┌──────────────────┐
  │    DISABLED      │  explicit operator action; no fallback attempted
  └──────────────────┘
           │ credentials restored / kill-switch removed
           ▼
       CONFIGURED
```

| State | Readiness effect | Feature behavior |
| --- | --- | --- |
| `unconfigured` | Non-blocking warning | Feature silently no-ops; no error surfaced to users |
| `configured` | Non-blocking (ok) | Feature runs normally |
| `degraded` | Non-blocking warning | Fallback path active; non-critical errors logged |
| `disabled` | Non-blocking (see #723) | Feature blocked at kill-switch; graceful fallback or skip |

`degraded` and `unconfigured` **never** make `GET /api/ready` return 503; only
`required` sections (database, auth) block readiness.

---

## 2. Readiness / health signal convention

### Central probe

```
GET /api/ready
```

Checks only local/config-layer dependencies. The `checks.providers` object in
the response reflects the `ConfigCheckStatus` for each provider, evaluated at
boot by `validateRuntimeConfig()` in `src/lib/runtime-config/runtime.ts`.

Provider health signals from `GET /api/ready`:

```json
"checks": {
  "providers": {
    "ai":          "configured | unconfigured | degraded",
    "speech":      "configured | unconfigured | degraded",
    "push":        "configured | unconfigured | degraded",
    "googleOAuth": "configured | unconfigured",
    "azureAdOAuth":"configured | unconfigured",
    "storage":     "configured | unconfigured | degraded"
  }
}
```

`scraper` is evaluated in the tuning section (not the providers block) because
content sources are code-registered and individually managed in the `ContentSource`
table; see [§7](#7-scraper-content-sources).

### Status values (from `ConfigCheckStatus`)

| Value | Meaning |
| --- | --- |
| `ok` | Required section; all checks pass |
| `missing` | Required vars absent |
| `malformed` | Var present but invalid |
| `configured` | Optional; all required vars present and valid |
| `unconfigured` | Optional; no vars present |
| `degraded` | Optional; partial or invalid config; fallback active |

### Scraper per-source health (runtime)

Scraper source health is a runtime signal derived from recent crawl outcomes and
stored in the `ContentSource` table (`healthStatus` column). See
[§7](#7-scraper-content-sources) for thresholds and admin queries.

---

## 3. AI provider (Azure OpenAI)

### Configuration

| Env var | Required | Notes |
| --- | --- | --- |
| `AZURE_OPENAI_ENDPOINT` | yes | HTTPS URL, trailing slashes stripped |
| `AZURE_OPENAI_API_KEY` | yes | Never logged or emitted to clients |
| `AZURE_OPENAI_DEPLOYMENT` | yes | Model deployment name in your Azure resource |
| `AZURE_OPENAI_API_VERSION` | yes | `YYYY-MM-DD` or `YYYY-MM-DD-preview` |
| `AI_PROVIDER` | no | Default `azure`; registry key for the active provider |
| `AI_MODERATION_ENABLED` | no | Enables remote content moderation (off by default) |

Sources: `src/lib/runtime-config/ai.ts`, `src/lib/ai/registry.ts`.

### Health signals

- **`GET /api/ready`**: `checks.providers.ai` — `configured`, `unconfigured`, or `degraded`.
- **`GET /api/admin/ai/usage`**: request volume, error rate, latency, and fallback counts derived from the AI invocation ledger (`AiInvocation` table).
- **`GET /api/admin/slo`**: `ai.availability` SLI — tracks completion success rate.
- **Structured logs**: `ai.*` log messages; `ai.chat_completion` span in traces.

`isAiConfigured()` (from `src/lib/ai/facade.ts`) is the feature gate used by
all AI helpers internally. It returns `false` when any required var is absent.

### Lifecycle

| Phase | What happens |
| --- | --- |
| Configure | Set all four env vars; `/api/ready` → `configured` |
| Health-check | Poll `GET /api/admin/slo` for `ai.availability`; inspect `GET /api/admin/ai/usage` for error counts |
| Degrade/fallback | Credential issues → `degraded`; AI helpers return `null`; features use static fallbacks (no AI result, no quiz, no summary) |
| Recover | Restore valid credentials; restart not required (config read at request time) |

### Common operational tasks

**Rotate API key**

1. Create the new key in the Azure portal.
2. Update `AZURE_OPENAI_API_KEY` in your platform secrets.
3. Redeploy or trigger a rolling restart.
4. Poll `GET /api/ready` and confirm `checks.providers.ai = "configured"`.
5. Revoke the old key once the new one is confirmed stable.

**Handle outage / API quota exhaustion**

- Check `GET /api/admin/slo` for `ai.availability` breach.
- See [incident-response.md §AI](./incident-response.md) for playbook.
- Set `AI_QUOTA_GLOBAL_DAILY=0` to suspend all AI calls during incident without removing credentials.
  - Note: kill-switch env vars are being standardized in issue #723.

**Verify AI health**

```bash
curl -s http://localhost:3000/api/ready | jq .checks.providers.ai
curl -s http://localhost:3000/api/admin/ai/usage | jq .summary
```

**Budget / quota configuration**: see [capacity-planning.md §1](./capacity-planning.md#1-ai-calls-and-budgets).

---

## 4. Speech / TTS provider (Azure Speech)

### Configuration

| Env var | Required | Notes |
| --- | --- | --- |
| `AZURE_SPEECH_KEY` | yes | Never logged or emitted to clients |
| `AZURE_SPEECH_REGION` | yes | Azure region slug, e.g. `eastus` |
| `AZURE_SPEECH_VOICE` | no | Default `en-US-AndrewMultilingualNeural` |
| `AZURE_SPEECH_OUTPUT_FORMAT` | no | Default `audio-24khz-96kbitrate-mono-mp3`; see `runtime.ts` for supported formats |
| `SPEECH_TIMEOUT_MS` | no | Per-synthesis timeout in ms (default 30 000) |

Sources: `src/lib/runtime-config/speech.ts`, `src/lib/speech/provider-azure.ts`.

### Health signals

- **`GET /api/ready`**: `checks.providers.speech` — `configured`, `unconfigured`, or `degraded`.
- **Structured logs**: `speech.*` log messages; synthesis errors include status codes from the Azure Speech SDK.
- **`ArticleSpeech` records**: absence of records for articles that should have narration is an indirect health signal.

`speechConfig.isConfigured()` is the feature gate. When unconfigured, synthesis
calls silently return null and narration is unavailable in the reader.

### Lifecycle

| Phase | What happens |
| --- | --- |
| Configure | Set `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION`; `/api/ready` → `configured` |
| Health-check | Attempt synthesis on a short test string; inspect `speech.*` log lines |
| Degrade/fallback | Synthesis errors → narration unavailable for new articles; existing `ArticleSpeech` records still served |
| Recover | Restore valid credentials; config read at request time |

### Common operational tasks

**Rotate speech key**

1. Generate a new key in the Azure Cognitive Services portal.
2. Update `AZURE_SPEECH_KEY` in platform secrets.
3. Deploy and poll `GET /api/ready` for `checks.providers.speech = "configured"`.
4. Revoke the old key.

**Switch voice or output format**

- Update `AZURE_SPEECH_VOICE` and/or `AZURE_SPEECH_OUTPUT_FORMAT` without restarting.
- Format must be one of the values in `SUPPORTED_SPEECH_OUTPUT_FORMATS` in `src/lib/runtime-config/runtime.ts`; unrecognised values produce a `warning` in readiness.

**Run a batch TTS migration** (after switching storage backends):
See [docs/operations/tts-jobs.md](./tts-jobs.md).

---

## 5. Push provider (VAPID / Web Push)

### Configuration

| Env var | Required | Notes |
| --- | --- | --- |
| `VAPID_PUBLIC_KEY` | yes | Returned to browsers; safe to expose |
| `VAPID_PRIVATE_KEY` | yes | Server-side signing key; never logged |
| `VAPID_SUBJECT` | yes | `mailto:` address or HTTPS URL |

Sources: `src/lib/runtime-config/push.ts`, `src/lib/push/provider.ts`.

VAPID keys are generated once (e.g. `npx web-push generate-vapid-keys`) and must
remain stable. Rotating them invalidates all existing browser subscriptions.

### Health signals

- **`GET /api/ready`**: `checks.providers.push` — `configured`, `unconfigured`, or `degraded`.
- **`isPushConfigured()`** (`src/lib/push/provider.ts`): runtime check that also validates web-push accepts the keys.
- **`PushSubscription` table**: `failureCount`, `lastSuccessAt`, `lastFailureAt` per endpoint.
- **Structured logs**: `push.*` — `sendToSubs called but VAPID is unconfigured`, delivery errors, dead-subscription pruning.

### Lifecycle

| Phase | What happens |
| --- | --- |
| Configure | Set all three VAPID vars; `/api/ready` → `configured` |
| Health-check | Verify `isPushConfigured()` returns true; inspect subscription failure counts in the DB |
| Degrade/fallback | Missing or rejected VAPID config → all `sendToSubs` calls return 0; reminder scheduler logs no-op |
| Recover | Restore valid VAPID config; all future sends use the new config |

**Dead subscription pruning**: `sendToSubs` prunes endpoints that return HTTP
404/410 from the push service, or that exceed `MAX_CONSECUTIVE_FAILURES`
consecutive transient failures. This is automatic during every delivery run.

### Common operational tasks

**Verify push is configured**

```bash
curl -s http://localhost:3000/api/ready | jq .checks.providers.push
```

**Inspect subscription health**

```sql
SELECT failureCount, COUNT(*) FROM PushSubscription GROUP BY failureCount ORDER BY failureCount;
SELECT COUNT(*) FROM PushSubscription WHERE failureCount >= 3;
```

**Handle push service outage**: push failures are transient and auto-recover. If a
push service is persistently unavailable for a region, the subscription endpoints
will be pruned after `MAX_CONSECUTIVE_FAILURES` transient failures. See
[capacity-planning.md §5](./capacity-planning.md#5-push-fan-out) for volume limits.

---

## 6. Media storage provider

### Configuration

| Env var | Required | Notes |
| --- | --- | --- |
| `MEDIA_STORAGE` | no | `local` (default), legacy alias `filesystem`, or `azure` |
| `MEDIA_STORAGE_DIR` | when `local`/`filesystem` | Absolute or relative path; default `./.media` |
| `AZURE_STORAGE_CONNECTION_STRING` | when `azure` | Full connection string (alternative to account+key) |
| `AZURE_STORAGE_ACCOUNT` | when `azure` | Account name (alternative to connection string) |
| `AZURE_STORAGE_KEY` | when `azure` | Account key (alternative to connection string) |
| `AZURE_STORAGE_CONTAINER` | when `azure` | Blob container name; default `media` |

Sources: `src/lib/runtime-config/storage.ts`, `src/lib/storage/runtime.ts`.

### Health signals

- **`GET /api/ready`**: `checks.providers.storage` — see status table below.
- **`isObjectStorageConfigured()`** (`src/lib/storage/runtime.ts`): true when a media storage backend is active.
- **Structured logs**: `storage.*` — `azure_unconfigured`, `unknown_kind` warnings on startup.

| `MEDIA_STORAGE` | Credentials | `checks.providers.storage` |
| --- | --- | --- |
| unset / `local` / `filesystem` | n/a | `configured` — local filesystem storage |
| `azure` | present | `configured` |
| `azure` | missing | `degraded` — audio is not persisted until credentials are configured |
| `database` / unknown value | n/a | `degraded` — unsupported value; local filesystem fallback is used |

No storage credentials are emitted in the readiness JSON response.

### Lifecycle

| Phase | What happens |
| --- | --- |
| Configure | Set `MEDIA_STORAGE` and backend-specific vars; `/api/ready` reflects chosen mode |
| Health-check | Attempt a small upload/download via the admin UI or a test article with TTS; inspect `storage.*` logs |
| Degrade/fallback | Azure creds missing → speech audio is not cached; article reading still works |
| Recover | Add Azure credentials or switch to `MEDIA_STORAGE=local`; regenerate affected narration |

### Common operational tasks

**Switch local storage to Azure Blob Storage**

1. Set `MEDIA_STORAGE=azure` and the required credential vars.
2. Deploy.
3. Confirm `checks.providers.storage = "configured"`.
4. Regenerate narration for any articles whose audio should be present in Azure.
  New speech generation writes directly to the selected backend.

**Rotate Azure storage credentials**

1. Rotate the key in the Azure portal.
2. Update `AZURE_STORAGE_KEY` (or generate a new connection string).
3. Deploy and confirm readiness.
4. Revoke the old key.

---

## 7. Scraper content sources

### Configuration

Scraper tuning env vars (all optional):

| Env var | Default | Notes |
| --- | --- | --- |
| `SCRAPER_MAX_BYTES` | 5 MiB | Maximum body bytes before abort |
| `SCRAPER_TIMEOUT_MS` | 15 000 ms | Hard request timeout (connect + body) |
| `SCRAPER_HTML_NORMALIZE` | `false` | Enable optional HTML normalization pass |

Source: `src/lib/runtime-config/scraper.ts`.

Content source providers are code-registered in `src/lib/scraper/providers/` and
have a corresponding `ContentSource` row in the database, seeded/refreshed by
`syncContentSources()`.

### Health signals

Content source health is a **runtime** signal (not a boot-time config signal).
It is derived from recent crawl outcomes and stored in the `ContentSource` table.

| `healthStatus` | Meaning |
| --- | --- |
| `healthy` | Recent crawls succeeding; discovery count non-zero |
| `degraded` | Some failures or zero-discovery runs, below threshold |
| `failing` | `consecutiveFailures >= 3` OR `consecutiveZeroDiscovery >= 3` |
| `unknown` | No crawl data yet; newly seeded source |

Thresholds: `HEALTH_THRESHOLDS` in `src/lib/scraper/sources.ts`.

Source: `src/lib/scraper/sources.ts` — `computeHealthStatus()`, `recordCrawlRun()`.

### Querying source health

```sql
-- Overview of all content sources with their health:
SELECT providerKey, displayName, enabled, healthStatus,
       consecutiveFailures, consecutiveZeroDiscovery, lastCrawledAt, lastError
FROM ContentSource
ORDER BY healthStatus DESC, consecutiveFailures DESC;

-- Sources currently failing:
SELECT providerKey, consecutiveFailures, consecutiveZeroDiscovery, lastError
FROM ContentSource
WHERE healthStatus = 'failing';
```

### Lifecycle

| Phase | What happens |
| --- | --- |
| Configure | Providers registered at startup; `syncContentSources()` seeds `ContentSource` rows |
| Health-check | Query `ContentSource.healthStatus`; inspect `consecutiveFailures` and `lastError` |
| Degrade/fallback | `isProviderEnabled()` gate prevents crawls on disabled sources; individual source failures do not block other sources |
| Recover | Fix upstream or re-enable source; `recordCrawlRun` resets counters on successful runs |

### Common operational tasks

**Disable a failing source**

```sql
UPDATE ContentSource SET enabled = false WHERE providerKey = 'bbc';
```

**Re-enable a source**

```sql
UPDATE ContentSource SET enabled = true WHERE providerKey = 'bbc';
```

**Reset health counters after upstream fix**

```sql
UPDATE ContentSource
SET consecutiveFailures = 0, consecutiveZeroDiscovery = 0,
    healthStatus = 'unknown', lastError = NULL
WHERE providerKey = 'bbc';
```

The next successful `recordCrawlRun` will compute a fresh health status.

**Handle SSRF / robots.txt policy changes**: see `src/lib/scraper/ssrf.ts` and
`src/lib/scraper/robots.ts`. The scraper validates all resolved IPs before the
first byte is sent and respects `robots.txt` directives. No operator config is
required; policy is enforced in code.

---

## 8. OAuth providers (Google, Azure AD)

### Configuration

**Google OAuth**

| Env var | Required | Notes |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | yes | |
| `GOOGLE_CLIENT_SECRET` | yes | Never logged or emitted to clients |

**Azure AD OAuth**

| Env var | Required | Notes |
| --- | --- | --- |
| `AZURE_AD_CLIENT_ID` | yes | |
| `AZURE_AD_CLIENT_SECRET` | yes | Never logged or emitted to clients |
| `AZURE_AD_TENANT_ID` | yes | |

Sources: `src/lib/runtime-config/oauth.ts`.

### Health signals

- **`GET /api/ready`**: `checks.providers.googleOAuth` and `checks.providers.azureAdOAuth`.
- Status is `configured` or `unconfigured` only — no partial/degraded state because credentials are required as a unit.
- Sign-in errors surface in application logs as `auth.*` log lines.

### Lifecycle

| Phase | What happens |
| --- | --- |
| Configure | Set all required vars; provider appears in NextAuth config; `/api/ready` → `configured` |
| Health-check | Attempt a sign-in flow; inspect `auth.*` logs |
| Degrade/fallback | Missing credentials → provider omitted from NextAuth; email/password auth still works |
| Recover | Restore credentials; restart for NextAuth to reload config |

### Common operational tasks

**Rotate OAuth client secret**

1. Create a new secret in Google Cloud Console / Azure App Registrations.
2. Update the env var in platform secrets.
3. Deploy (NextAuth re-reads config on startup).
4. Revoke the old secret once confirmed stable.

---

## 9. Observability exporter (OpenTelemetry)

### Configuration

| Env var | Required | Notes |
| --- | --- | --- |
| `TRACING_ENABLED` | no | `true/1/yes/on` to enable tracing without an endpoint (console exporter) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | OTLP endpoint URL; enables tracing automatically |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | no | Takes precedence over `OTEL_EXPORTER_OTLP_ENDPOINT` for traces |
| `OTEL_SERVICE_NAME` | no | Default `readwise` |
| `APP_VERSION` | no | Attached to all spans as `service.version` |
| `ERROR_REPORTING_PROVIDER` | no | Default `log`; set to an aggregator key for external error reporting |
| `ERROR_ALERT_THRESHOLD` | no | Occurrences before `error.alert` fires (default 10) |

Source: `src/lib/runtime-config/observability.ts`.

### Health signals

- Tracing is **off** unless explicitly enabled (`isTracingConfigured()` returns `false` by default).
- When enabled, `ai.chat_completion`, `scraper.fetch`, and `worker.*` spans appear in your collector.
- No readiness entry for the observability exporter — it is a non-critical side channel.

### Lifecycle

| Phase | What happens |
| --- | --- |
| Configure | Set `OTEL_EXPORTER_OTLP_ENDPOINT` or `TRACING_ENABLED=true`; spans exported on next request |
| Health-check | Verify spans appear in Jaeger or your collector UI |
| Degrade/fallback | Missing endpoint → console exporter (if `TRACING_ENABLED=true`) or tracing disabled; app unaffected |
| Recover | Restore endpoint; no restart required |

---

## 10. Operational tasks — common patterns

### Verify all providers in one call

```bash
curl -s http://localhost:3000/api/ready | jq .checks
```

### Rotate any provider credential (general steps)

1. Create the new credential in the upstream service.
2. Update the env var in your platform secrets store.
3. Deploy or rolling-restart the application.
4. Poll `GET /api/ready` to confirm the provider moves to `configured`.
5. Revoke the old credential.

### Respond to a provider outage

1. Identify the affected provider from `GET /api/ready` or `GET /api/admin/slo`.
2. Apply the subsystem-specific playbook in
   [incident-response.md](./incident-response.md).
3. Use provider-level env vars to reduce load or disable the feature during the
   outage (explicit kill-switches are being standardized in issue #723).
4. Restore credentials or upstream connectivity to recover.

### Confirm degraded vs. unconfigured

| You see | Meaning |
| --- | --- |
| `"unconfigured"` | No env vars for this provider are set. Expected in local dev. |
| `"degraded"` | Some vars set, but provider is partially configured or credentials were rejected at validation time. Investigate `config.optional.<provider>.issues` in the readiness body. |

`GET /api/ready` returns the full `config.optional` object with `issues`,
`missing`, and `env` fields for each provider — inspect this for remediation
guidance.

---

## 11. Convergence checklist

This checklist identifies where provider health reporting deviates from the
unified model and tracks planned remediation (issue #723).

| Provider | Boot-time config status | Runtime health signal | Kill-switch (issue #723) | Notes |
| --- | --- | --- | --- | --- |
| AI | ✅ `GET /api/ready` | ✅ SLO + admin usage | Planned (`AI_ENABLED`) | Budget env vars can suppress calls at quota level today |
| Speech | ✅ `GET /api/ready` | ⚠️ Logs only | Planned (`SPEECH_ENABLED`) | No admin health endpoint for synthesis success rate |
| Push | ✅ `GET /api/ready` | ⚠️ DB subscription counters | Planned (`PUSH_ENABLED`) | No aggregated admin delivery rate view |
| Storage | ✅ `GET /api/ready` | ⚠️ Logs only | Planned (`STORAGE_ENABLED`) | No runtime probe that confirms blob write/read round-trip |
| Scraper sources | ⚠️ Tuning section only | ✅ `ContentSource.healthStatus` | ✅ `ContentSource.enabled` per-source | Per-source disable is already available; no global kill-switch |
| Google OAuth | ✅ `GET /api/ready` | ⚠️ Logs only | Planned | No impact on readiness; sign-in failure observable in auth logs |
| Azure AD OAuth | ✅ `GET /api/ready` | ⚠️ Logs only | Planned | Same as Google |
| OTel exporter | ❌ Not in readiness | ⚠️ Spans/logs only | n/a | Non-critical; omitting from readiness is intentional |

**Desired target state** (see issue #723):

- Every optional provider has an explicit `<PROVIDER>_ENABLED` kill-switch env
  var that operators can set to `false` to disable the provider independently of
  credential presence.
- `GET /api/ready` reflects a `disabled` status for kill-switched providers.
- Observability exporters remain outside the readiness check (non-critical path).
- All kill-switch flags are documented in `docs/platform/health-readiness.md`.
