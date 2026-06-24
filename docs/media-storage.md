# Media object storage

Audio narration (text-to-speech) is the largest media payload ReadWise produces.
Historically it was stored inline as base64 in `ArticleSpeech.audioBase64`. This
document describes the optional object-storage abstraction that moves those
payloads out of the database, and how it degrades gracefully (Epic RW-E009 —
RW-049 / Epic #370).

## Goals

- Keep large audio out of the primary database when object storage is available.
- **Never** require a cloud SDK or break when storage is unconfigured — the DB
  base64 path remains the always-working default.
- Make reader playback work identically in both modes.
- Provide a safe, idempotent migration for existing base64 audio.

## Configuration

A single env var selects the backend (`src/lib/storage.ts`):

| `MEDIA_STORAGE`            | Backend                          | Notes                                              |
| ------------------------- | -------------------------------- | -------------------------------------------------- |
| unset / `database` / `db` / `none` | **Database base64** (default) | `getMediaStorage()` returns `null`; nothing changes |
| `filesystem` / `local` / `fs` | Local filesystem            | Files under `MEDIA_STORAGE_DIR` (default `./.media`) |
| `azure`                   | **Azure Blob Storage**           | Requires `AZURE_STORAGE_CONNECTION_STRING` or `AZURE_STORAGE_ACCOUNT`+`AZURE_STORAGE_KEY` |
| `s3` / `r2`               | Cloud seam (reserved)            | No SDK bundled → returns `null`, logs a warning, falls back to DB |

### Filesystem mode

| Variable          | Default      | Description                              |
| ----------------- | ------------ | ---------------------------------------- |
| `MEDIA_STORAGE`   | _(unset)_    | Set to `filesystem` or `fs`              |
| `MEDIA_STORAGE_DIR` | `./.media` | Absolute or relative path for file store |

### Azure Blob Storage mode

| Variable                           | Required                       | Description                                      |
| ---------------------------------- | ------------------------------ | ------------------------------------------------ |
| `MEDIA_STORAGE`                    | yes                            | Set to `azure`                                   |
| `AZURE_STORAGE_CONNECTION_STRING`  | one of these two options       | Full Azure Storage connection string             |
| `AZURE_STORAGE_ACCOUNT`            | (alternative to conn string)   | Azure Storage account name                       |
| `AZURE_STORAGE_KEY`                | with account name              | Azure Storage account key                        |
| `AZURE_STORAGE_CONTAINER`          | no (default: `media`)          | Blob container name                              |

When `MEDIA_STORAGE=azure` but credentials are missing the app falls back to DB
base64 with a warning — it does **not** crash. The readiness probe (`GET /api/ready`)
reports `checks.providers.storage = "degraded"` in this state.

`getMediaStorage()` is intentionally **not cached** so a runtime/env change (or a
test) is reflected immediately; construction is cheap.

## The storage abstraction

```ts
interface MediaStorage {
  readonly kind: MediaStorageKind;
  put(input: PutMediaInput): Promise<PutMediaResult>; // → { storageKey, sizeBytes, checksum }
  get(storageKey: string): Promise<Buffer | null>;
  delete(storageKey: string): Promise<void>;
}
```

Both the filesystem and Azure implementations are:

- **content-addressed** — the object key embeds the sha-256 of the bytes
  (`<keyHint>/<sha256><ext>`), so identical audio de-duplicates and writes are
  idempotent.
- **traversal-safe** — filesystem: every key is resolved and confined to the base
  directory. Azure: SDK handles container scoping; storageKey is sanitized before
  use.
- **private** — Azure blobs are uploaded without public access; audio is served only
  to authenticated readers via `GET /api/reader/[id]/speech/audio`.

To add a real cloud backend, implement `MediaStorage` for the chosen provider and
wire it into `getMediaStorage()` behind its `MEDIA_STORAGE` value. No other code
changes are required — synthesis, migration and playback all go through the
interface.

## How speech uses it

`src/lib/speech.ts` `getOrCreateArticleSpeech`:

- **Synthesis path** — when object storage is configured, new audio is written via
  the abstraction and a `MediaAsset` row is recorded (`storageKey`, `mimeType`,
  `sizeBytes`, `checksum`, `durationSec`, `voice`, `format`); `ArticleSpeech` keeps
  a `storageKey` + `mediaAssetId` link. When storage is unconfigured, audio is
  stored as base64 exactly as before.
- **Cached-read path** — `resolveStoredAudioUrl` prefers existing base64, else
  reads the bytes back from storage by key. If neither is available, the client
  treats the response as a graceful fallback (no audio) rather than erroring.

`ArticleSpeech.audioBase64` is **nullable** but retained as a fallback — it is
never required, and the schema supports both modes simultaneously (some rows on
base64, some on storage keys).

## Streaming audio endpoint (#372)

`GET /api/reader/[id]/speech/audio` serves narration audio bytes directly:

- **Auth-gated** — same article-access rules as the speech POST route. Unauthenticated
  or unauthorized requests receive 401/404 (private article audio is never exposed).
- **Source-agnostic** — serves from `storageKey` via `getMediaStorage().get()` when
  available, else falls back to `audioBase64`. Returns 404 when neither is present.
- **Cache headers** — `Cache-Control: private, max-age=3600` prevents shared caches
  from serving one user's audio to another.
- **Content-Length** — included when bytes are known, enabling progress bars.

This endpoint is the foundation for `<audio src="/api/reader/{id}/speech/audio">`
which avoids embedding large data-URIs in the initial page payload.

## Migrating existing base64 audio

`migrateArticleSpeechToStorage()` moves existing inline audio into object storage:

- **Idempotent** — only rows WITH `audioBase64` AND WITHOUT a `storageKey` are
  eligible, so a re-run migrates nothing new.
- **Safe** — base64 is cleared ONLY after the storage write AND the `MediaAsset`
  record both succeed (inside a transaction). The payload is never lost.
- **Graceful** — when object storage is unconfigured it is a no-op
  (`skippedNoStorage: true`).

It returns `{ storageKind, skippedNoStorage, scanned, migrated, alreadyMigrated,
failed }` and accepts an optional `limit` for batched runs.

### Running the migration

```bash
# Load env first (sets MEDIA_STORAGE, credentials, DATABASE_URL, etc.)
set -a && . ./.env && set +a

# Migrate all eligible rows
npm run migrate-storage

# Migrate in batches (useful for large datasets)
npm run migrate-storage -- --limit 100
```

The script is safe to re-run at any time.

### Rollback

Because `audioBase64` is only cleared **after** a successful storage write + DB
transaction, rollback is simple:

1. Remove `MEDIA_STORAGE` from your environment (or set it to `database`).
2. Rows that have already been migrated (`audioBase64 = null`, `storageKey` set)
   will have no base64 to fall back to — but the bytes are in storage and can be
   re-read by `GET /api/reader/[id]/speech/audio` as long as the storage backend
   is reachable.
3. To fully roll back: run a one-time script that reads each row's bytes from storage
   and re-populates `audioBase64`, then clears `storageKey`. The migrated base64 was
   never deleted from the original source — only cleared from the DB after a
   successful store write.

**Do not delete the storage container** until you are certain every row has either
been migrated (storageKey set) or has base64 as a fallback.

## Readiness probe

`GET /api/ready` exposes `checks.providers.storage`:

| Value          | Meaning                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| `unconfigured` | `MEDIA_STORAGE` unset or `database` — DB base64 mode, expected          |
| `configured`   | Backend credentials present and valid                                   |
| `degraded`     | `MEDIA_STORAGE=azure` but credentials missing — app falls back to DB    |

`degraded` does **not** cause the readiness probe to return HTTP 503, because DB
base64 fallback is still fully functional. No secret values (connection strings,
account keys) are included in the readiness JSON.

## Troubleshooting

| Symptom | Likely cause | Resolution |
| ------- | ------------ | ---------- |
| `checks.providers.storage = "degraded"` in `/api/ready` | `MEDIA_STORAGE=azure` but `AZURE_STORAGE_*` creds missing | Set `AZURE_STORAGE_CONNECTION_STRING` or `AZURE_STORAGE_ACCOUNT`+`AZURE_STORAGE_KEY` |
| `storage.cloud_seam_unconfigured` warn in logs | Same as above | Same as above |
| `storage.azure_container_unavailable` warn in logs | Azure SDK import failed or container creation threw | Check credentials, network, and that the account/container name is valid |
| Migration shows `failed > 0` | Storage write or DB transaction failed | Check logs for `storage.speech_migration_failed`; re-run after fixing credentials |
| Audio 404 after migration but `storageKey` is set | Storage backend unreachable or `MEDIA_STORAGE` not set | Confirm env vars are loaded; check `GET /api/ready` storage status |
| `npm run migrate-storage` shows `skippedNoStorage` | `MEDIA_STORAGE` is not set or set to `database` | Set `MEDIA_STORAGE` and configure credentials before running |

