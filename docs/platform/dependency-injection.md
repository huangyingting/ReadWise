# Dependency injection and test seam patterns

This guide defines when and how to use dependency injection (DI) in ReadWise
services, route handlers, workers, and scripts. Follow it when writing new
orchestration services and when updating tests.

## Quick reference

| Situation | Pattern | Naming | Examples |
|---|---|---|---|
| Orchestration service with multiple external I/O calls | `Deps` object inside options | `XxxDeps`, `deps?:` inside opts | `BackfillDeps`, `SeedDeps`, `UrlImportDeps`, `TextImportDeps` |
| Long-running worker / runtime loop with many callables | `Deps` as separate parameter with default `{}` | `XxxDeps`, `deps:` last param | `WorkerLoopDeps` |
| Pluggable external service (dictionary, AI, storage) | Named `interface` | `XxxProvider`, `XxxClient`, `XxxRepository` | `DictionaryProvider`, `GroupClient` |
| Framework boundary (auth, middleware, Next.js routing) | `mock.module` in tests | n/a | `@/lib/api-auth`, `@/lib/prisma` |
| Pure computation (formatting, parsing, sanitization) | **No injection** — use directly | n/a | `heuristicDifficulty`, `sanitizeArticleHtml`, `countWords` |

---

## When to use each pattern

### `Deps` object inside options (orchestration services)

Use when a service function accepts an options object and calls several external
services (DB, network, audit, analytics, security events).

- Wrap injectable deps in a `Partial<XxxDeps>` field named `deps` inside the
  options type.
- Provide default values inline at the top of the function with `??`.
- Production callers **never pass `deps`** — defaults resolve to real
  implementations.

```ts
// src/lib/import/url-import.ts

export type UrlImportDeps = {
  assertSafeUrl: (url: string) => Promise<void>;
  findOwnedArticleBySourceUrl: (url: string, userId: string) => Promise<{ id: string } | null>;
  scrape: (url: string) => Promise<ScrapedArticle | null>;
  assertWithinDailyQuota: (userId: string) => Promise<void>;
  db: { $transaction<R>(fn: (tx: Prisma.TransactionClient) => Promise<R>): Promise<R> };
  recordAuditFromRequest: typeof recordAuditFromRequest;
  recordSecurityEvent: (evt: SecurityEventInput) => void;
  recordEvent: typeof recordEvent;
};

export type UrlImportInput = {
  rawUrl: string;
  userId: string;
  req: Request;
  session: Session;
  requestId: string;
  deps?: Partial<UrlImportDeps>; // optional; production callers omit this
};

export async function importArticleFromUrl(input: UrlImportInput): Promise<ImportResult> {
  const assertSafe   = input.deps?.assertSafeUrl               ?? assertSafeUrl;
  const findOwned    = input.deps?.findOwnedArticleBySourceUrl  ?? findOwnedArticleBySourceUrl;
  const scrape       = input.deps?.scrape                       ?? scrapeUrl;
  const checkQuota   = input.deps?.assertWithinDailyQuota       ?? assertWithinDailyQuota;
  const db           = input.deps?.db                           ?? prisma;
  const recordAudit  = input.deps?.recordAuditFromRequest       ?? recordAuditFromRequest;
  const recordSec    = input.deps?.recordSecurityEvent          ?? recordSecurityEvent;
  const recordEvt    = input.deps?.recordEvent                  ?? recordEvent;
  // …use resolved deps throughout…
}
```

### `Deps` as separate parameter (worker loops)

Use for long-running workers that receive their deps from a parent `options`
object and pass them to an inner loop. The inner loop accepts `deps` as its last
parameter with a default of `{}`.

```ts
// src/lib/worker/loop.ts

export type WorkerLoopDeps = {
  claimNextJob?: typeof claimNextJob;
  startJob?: typeof startJob;
  // …
};

export async function runWorkerLoop(
  workerId: string,
  handlers: …,
  options: WorkerLoopOptions,
  logger: WorkerLogger,
  deps: WorkerLoopDeps = {},       // ← last param, always defaults
): Promise<JobWorkerStats> {
  const claimFn = deps.claimNextJob ?? claimNextJob;
  // …
}
```

### Named `Provider` / `Client` / `Repository` interface (pluggable adapters)

Use when a service is designed to work with multiple concrete implementations
(e.g., multiple dictionary APIs, AI providers, storage backends). Define a
minimal interface and provide the default adapter separately.

```ts
// src/lib/lexical/provider.ts

export interface DictionaryProvider {
  fetchEntry(word: string): Promise<DictionaryEntry | null>;
}

// src/lib/analytics/queries/repository.ts
type GroupClient = Pick<typeof prisma, "analyticsEvent">;
```

- `Provider` — external-service adapter with a clear capability boundary.
- `Client` — narrowed Prisma client shape (use `Pick<typeof prisma, "model">`).
- `Repository` — data-access abstraction that may span multiple models.

### `mock.module` (framework boundaries)

Use module mocks only when the dep is a **framework-level boundary** that owns
the import graph at test time and cannot be injected through a `deps` object:

- `@/lib/api-auth` — auth middleware (namespace-imported by `api-handler.ts`).
- `@/lib/prisma` — Prisma singleton when a sub-module (e.g., `quota.ts`) has no
  DI seam of its own.
- Next.js server internals (`next/server`, `next/headers`).

Keep `mock.module` calls in `before()` and pair them with a dynamic `import()`
inside each test so the mock is resolved at call time.

### No injection (pure functions)

Pure computation functions (no I/O, no side effects, deterministic output) do
**not** need injection. Calling them directly in production **and** in tests is
correct.

Examples: `sanitizeArticleHtml`, `heuristicDifficulty`, `countWords`,
`privateImportedArticleCreateFields`, `assertSafeUrl` shape validators.

---

## Naming standards

| Concept | Suffix | Example |
|---|---|---|
| Collection of external callables for one service | `Deps` | `BackfillDeps`, `SeedDeps`, `UrlImportDeps` |
| Pluggable external-service adapter | `Provider` | `DictionaryProvider`, `StorageProvider` |
| Narrowed Prisma / DB client | `Client` | `GroupClient`, `AuditClient`, `StepClient` |
| Data-access abstraction across models | `Repository` | (reserved for future use) |

---

## Production ergonomics

Production callers **must not** be required to pass `deps`. Always provide
defaults:

```ts
// Good — production caller:
await importArticleFromUrl({ rawUrl, userId, req, session, requestId });

// Good — test caller with injected stubs:
await importArticleFromUrl({ rawUrl, userId, req, session, requestId, deps: { scrape: stubScraper } });
```

---

## Test strategy

| What to test | Recommended approach |
|---|---|
| Orchestration service behavior (happy path, error paths, side effects) | Inject narrow `deps` stubs; skip `mock.module` for all injected callables |
| Route handler behavior | `mock.module("@/lib/api-auth", …)` + `mock.module("@/lib/prisma", …)` via support helpers |
| Pure function logic | Direct call; no mocks needed |
| Worker loop behavior | Pass `deps` with stubs for `claimNextJob`, `sleep`, etc. |

Prefer the `tests/support/` helpers for common stubs:

- `makeArticlePrisma(getExists, stub)` — article delegate mock.
- `makePrisma(delegates)` — compose multiple Prisma delegates.
- `makeTransactionDb(delegates)` — create a `{ $transaction }` stub for services
  that inject a `db` dep; the injected transaction callback receives the given
  delegate map as its `tx`.
- `sessionAuthExports(getState, session)` — `@/lib/api-auth` named exports.
- `fullAuthExports(getState, session, adminSess)` — auth exports with admin support.

### Example: testing an orchestration service with narrow seams

```ts
import { importArticleFromUrl } from "@/lib/import/url-import";
import { makeTransactionDb } from "tests/support/prisma-mock";

test("successful URL import returns 201", async () => {
  let auditCalled = false;
  const result = await importArticleFromUrl({
    rawUrl: "https://example.com/article",
    userId: "u1",
    req: mockReq,
    session,
    requestId: "r1",
    deps: {
      assertSafeUrl:              async () => {},
      findOwnedArticleBySourceUrl: async () => null,
      scrape:                     async () => scrapedFixture,
      assertWithinDailyQuota:     async () => {},
      db: makeTransactionDb({
        article: {
          create: async () => ({ id: "new-id" }),
          update: async () => {},
        },
      }),
      recordAuditFromRequest: async () => { auditCalled = true; },
      recordSecurityEvent:    () => {},
      recordEvent:            async () => {},
    },
  });

  assert.equal(result.status, 201);
  assert.ok(auditCalled);
});
```

---

## What not to inject

- Pure functions (formatting, parsing, validation, sanitization).
- Constants and configuration objects that do not change per-call.
- Logging — use `createLogger(scope)` directly; tests can silence it with
  `process.env.LOG_LEVEL = "error"`.
- Anything marked `// test-only` in the seam — test concepts must not leak into
  domain logic.

---

## Related

- `AGENTS.md` — hard rules including Prisma singleton, `createLogger`, optional
  provider degradation.
- `tests/support/` — shared test helpers (REF-033).
- Backfill subsystem: `src/lib/processing/backfill.ts` (`BackfillDeps`).
- Seed script: `src/lib/seed.ts` (`SeedDeps`).
- Worker loop: `src/lib/worker/loop.ts` (`WorkerLoopDeps`).
- Import services: `src/lib/import/url-import.ts` (`UrlImportDeps`),
  `src/lib/import/text-import.ts` (`TextImportDeps`).
