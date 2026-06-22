# ADR-0007: Object storage for generated and imported media

- **Status:** Proposed
- **Date:** 2026-06-22
- **Related:** #307 (RW-049), #324 (RW-066)

## Context

Article speech currently stores generated audio inline in the database. Future imported media, larger narration files, and offline assets will make database blobs expensive to back up and serve.

## Decision

Store generated and imported media in object storage, with database rows keeping ownership, content type, size, checksum, storage key, lifecycle state, and derivation metadata. Access should go through server-issued URLs or proxied responses that enforce article visibility.

## Alternatives considered

- **Keep media in database:** Simple, but bloats backups and slows data operations.
- **Write media to local disk:** Not durable or portable across deployments.
- **Expose public bucket paths:** Easy to serve, but unsafe for private articles and tenant boundaries.

## Consequences

- Media delivery can scale independently of relational data.
- Cleanup jobs are needed for orphaned objects and regenerated derivatives.
- Private media access must reuse centralized article authorization rules.

## Follow-up work

- [ ] #307: add object storage support for media.
- [ ] Revisit generated speech caching after object storage is available.
