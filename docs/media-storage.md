# Media object storage

Audio narration (text-to-speech) is the largest media payload ReadWise produces.
Historically it was stored inline as base64 in `ArticleSpeech.audioBase64`. This
document describes the optional object-storage abstraction that moves those
payloads out of the database, and how it degrades gracefully (Epic RW-E009 —
RW-049).

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
| `s3` / `azure` / `r2`     | Cloud seam (documented)          | No SDK bundled → returns `null`, logs a warning, falls back to DB |

`MEDIA_STORAGE_DIR` sets the filesystem base directory (resolved against the
working directory).

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

The filesystem implementation is:

- **content-addressed** — the object key embeds the sha-256 of the bytes
  (`<keyHint>/<sha256><ext>`), so identical audio de-duplicates and writes are
  idempotent.
- **traversal-safe** — every key is resolved and confined to the base directory;
  keys that escape (e.g. `../../etc/passwd`) are rejected.

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

## Migrating existing base64 audio

`migrateArticleSpeechToStorage()` moves existing inline audio into object storage:

- **Idempotent** — only rows WITH `audioBase64` and WITHOUT a `storageKey` are
  eligible, so a re-run migrates nothing new.
- **Safe** — base64 is cleared ONLY after the storage write AND the `MediaAsset`
  record both succeed (inside a transaction). The payload is never lost.
- **Graceful** — when object storage is unconfigured it is a no-op
  (`skippedNoStorage: true`).

It returns `{ storageKind, skippedNoStorage, scanned, migrated, alreadyMigrated,
failed }` and accepts an optional `limit` for batched runs. Run it on demand after
configuring `MEDIA_STORAGE` (e.g. from an admin/CLI task); it can be re-run safely
at any time.
