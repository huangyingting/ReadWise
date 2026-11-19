---
type: "index"
status: "current"
last_updated: "2026-11-19"
description: "Media asset ownership and lifecycle, and local or Azure object storage."
---

# Media

Media assets, storage keys, and storage backends (ADR [0007](../architecture/0007-object-storage-for-media.md)). Speech generation and Reader playback are documented in their own subsystems.

Add a document here when the change affects how binary assets are created, keyed, stored, served, or deleted.

## Code ownership

- `src/lib/media/`, `src/lib/storage/`, `src/lib/storage.ts`

## Documents

<!-- BEGIN GENERATED: docs-index (npm run docs:index) -->

| Document | Type | Status | Description |
| --- | --- | --- | --- |
| [Media asset lifecycle](./assets.md) | reference | current | Documents MediaAsset ownership, canonical speech asset pointers, content-addressed keys, two-phase asset retirement, and rebuild replacement flow. |
| [Media storage](./storage.md) | reference | current | Documents local/Azure media storage, readiness behavior, storage interface, speech audio persistence, streaming endpoint, and troubleshooting rules. |

<!-- END GENERATED: docs-index -->
