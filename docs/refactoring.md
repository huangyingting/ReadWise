# Refactoring Notes — Redirect Index

> **This file is a redirect index.** The subsystem boundary and import-contract
> rules previously recorded here have been consolidated into the architecture
> decision record:
>
> **[ADR-0010: Subsystem boundaries and phased import contracts](architecture/0010-subsystem-boundaries-and-import-contracts.md)**

The sections below preserve the original reference anchors so that existing code
comments (`See docs/refactoring.md § REF-076` / `REF-082`) continue to resolve
without modification.

---

## REF-076 — Server-only boundary taxonomy

Server-only modules (e.g. `sanitize.ts`, `api-auth.ts`, `prisma.ts`,
`storage.ts`, `session.ts`, `auth-core.ts`, `runtime-config/`, `result.ts`,
`scraper/limits.ts`, `primitives/server.ts`) must never be imported from a
`"use client"` file or any file that can reach the client bundle.

The authoritative boundary taxonomy and enforcement strategy is now documented
in **ADR-0010 §§ "Agreed principles", "Subsystem taxonomy", and "Import
contracts"**:

→ [`docs/architecture/0010-subsystem-boundaries-and-import-contracts.md`](architecture/0010-subsystem-boundaries-and-import-contracts.md)

---

## REF-082 — Null-returning read-model helpers

Read-model helpers that return `null` for absent data should continue to do so.
Forcing null-returning functions into the `Result<T>` shape adds noise when
absence is a normal value rather than a command failure. The `Result<T>` type is
for domain commands only.

The authoritative contract is now documented in **ADR-0010 §§ "Agreed
principles"** and the `src/lib/result.ts` module header.

→ [`docs/architecture/0010-subsystem-boundaries-and-import-contracts.md`](architecture/0010-subsystem-boundaries-and-import-contracts.md)
