---
type: "policy"
status: "current"
last_updated: "2026-07-01"
description: "Documents ownership and privacy boundaries for unit fixtures, seeds, e2e data, scraper corpora, and AI eval datasets. Captures current fixture rules, generated/test data lifecycle, privacy constraints, and maintenance workflow."
---

# Test data and fixture governance

This document defines how ReadWise test data is created, organised, and kept
safe.  It covers every fixture layer — pure unit factories, Prisma/DB
integration seeds, Playwright e2e seeds, scraper HTML/JSON corpora, and AI
evaluation datasets — and states the rules that all contributors must follow
when adding or changing fixtures.

**See also:**
- [CI tiers and local commands](./ci.md)
- [Database setup and integration tests](./database.md)
- [AI evaluation datasets](../ai/evaluations.md)
- [Data classification and retention matrix](../security/data-lifecycle-matrix.md)

---

## 1. Fixture categories

### 1.1 Pure unit factories (no real DB)

Location: `tests/support/`

Unit tests run against the Node built-in test runner with
`--experimental-test-module-mocks`.  All external dependencies (Prisma, API
auth, job queue) are replaced by lightweight in-memory fakes or mock modules.
No disk I/O, no network calls.

| Helper file | Exported builders | Use when |
|---|---|---|
| `tests/support/auth-mock.ts` | `sessionAuthExports`, `fullAuthExports`, `makeSession` | Mocking `@/lib/api-auth` in route tests |
| `tests/support/prisma-mock.ts` | `makeArticlePrisma`, `makePrisma`, `makeTransactionDb` | Mocking `@/lib/prisma` in route / service tests |
| `tests/support/route.ts` | `makeJsonRequest`, `jsonPost`, `jsonPut`, `jsonPatch`, `getReq`, `deleteReq`, `withParams`, `readJson`, `readerSession`, `adminSession` | Building `Request` objects and session fixtures for route handler tests |
| `tests/support/job-fake.ts` | `makeJobFake` | Testing job-queue enqueue / worker logic without a real DB |
| `tests/support/learning-fixtures.ts` | `makeLevelEvidence`, `makeSkillSummaries`, `makeStudyDiagnostics`, `makeRecommendationCandidate`, `makeRecommendationContext` | Learning-domain unit tests (leveling, study-plan, recommendations) |

**Rules for unit fixtures:**

- **Prefer shared helpers over inline duplicates.**  Before writing a new
  in-test stub, check whether an existing builder in `tests/support/` covers
  the shape.  If several tests need the same shape, extract it into the
  appropriate support file.
- Use `fullAuthExports` (exposes both `requireSessionApi` and
  `requireCapabilityApi`) when the route under test calls either auth guard.
  Use `sessionAuthExports` only when the route uses `requireSessionApi`
  exclusively.
- Compose `makePrisma({ ...makeArticlePrisma(…), myModel: { … } })` rather
  than building nested mock objects by hand; this keeps the mock shape
  consistent with how Prisma delegates are structured.
- Prefer `makeTransactionDb` for services that accept a `db` dependency
  injection instead of a global `mock.module("@/lib/prisma", …)` replacement.
- Keep stub values minimal and clearly fictional (`id: "a1"`, `userId: "user-1"`).

### 1.2 PostgreSQL integration fixtures

Location: `tests/db/support/`

| File | Purpose |
|---|---|
| `tests/db/support/db-config.ts` | Exports `enabled`, `isPostgres`, `PREFIX = "dbit_"`, `databaseUrl` |
| `tests/db/support/db-helpers.ts` | `id()`, `cleanIntegrationRows()`, `registerIntegrationCleanup()`, `applySql()`, `readPostgresMigrations()` |
| `tests/db/support/fixtures.ts` | `seedQueryPlanFixture()` — bulk seed for query-plan / index tests |

#### Activation gate

Integration tests **only run** when `RUN_DB_INTEGRATION=1` is set and
`DATABASE_URL` points to a PostgreSQL connection string.  Every integration test
file must check `enabled` from `db-config.ts` at the top and skip or exit early
when the gate is off:

```ts
import { enabled } from "../support/db-config";
if (!enabled) process.exit(0);
```

The local command is `npm run test:db` (see [CI tiers](./ci.md#tiers-at-a-glance)).

#### Row prefix (`dbit_`)

Every ID created in an integration test **must** go through the `id()` helper,
which prepends `dbit_` to a UUID:

```ts
import { id } from "../support/db-helpers";
const userId = id("my_user"); // "dbit_my_user_<uuid>"
```

The `cleanIntegrationRows()` sweep deletes all rows whose `id` (or equivalent
column) starts with `dbit_`, so isolation is guaranteed even if a test panics.

#### Cleanup registration

Call `registerIntegrationCleanup()` exactly once at the top of each
`postgres-*.test.ts` file.  It registers:

- `afterEach` — calls `cleanIntegrationRows()` to sweep `dbit_`-prefixed rows.
- `after` — calls `prisma.$disconnect()`.

```ts
import { registerIntegrationCleanup } from "../support/db-helpers";
registerIntegrationCleanup();
```

#### Concurrency

Integration tests **must** run serially (`--test-concurrency=1`) because they
share a single PostgreSQL schema.  The `npm run test:db` script already passes
this flag; do not run `npm test` against a live DB.

#### Bulk seed (`seedQueryPlanFixture`)

The `seedQueryPlanFixture()` builder in `tests/db/support/fixtures.ts` inserts
720 articles, 500 reading-progress rows, and 420 saved words under
`dbit_plan_*` IDs, then calls `ANALYZE` so the planner uses real statistics.
Use it when a test needs PostgreSQL to choose an indexed path rather than a
sequential scan.  All rows are swept automatically by the cleanup hook.

### 1.3 End-to-end (Playwright) seeds

Location: `e2e/support/seed.ts` and `src/lib/testing/e2e-fixtures.ts`

The Playwright smoke suite seeds its own isolated database via helpers
exported from `src/lib/testing/e2e-fixtures.ts`:

| Export | Purpose |
|---|---|
| `resetE2eDatabase()` | Full ordered teardown of the test database (guarded by `assertSafeE2eDatabaseUrl`) |
| `seedE2eArticles()` | Inserts the deterministic `E2E_ARTICLES` set |
| `createUserWithSession(role, opts?)` | Creates a user + NextAuth `Session` row; returns `{ userId, sessionToken, expires }` |
| `TEST_ARTICLE_ID` | Stable article ID `"e2e-critical-reader"` referenced by smoke checks |

`e2e/support/seed.ts` re-exports `TEST_ARTICLE_ID` and `createUserWithSession`
and exposes two entry-point helpers used in Playwright global setup:

```ts
await seedSmokeData();            // resetE2eDatabase() + seedE2eArticles()
await addSessionCookie(context, sessionToken, expires);
```

**E2E fixture rules:**

- Article IDs and content must be deterministic (static constants, not random
  UUIDs) so smoke checks can reference known IDs.
- `resetE2eDatabase()` contains a safety guard (`assertSafeE2eDatabaseUrl`)
  that refuses to run against a production connection string — never bypass it.
- The E2E database is separate from the development SQLite database
  (`PLAYWRIGHT_DATABASE_URL`); never seed against `prisma/dev.db`.

### 1.4 Scraper fixture corpora

Scraper unit and integration tests use **static HTML / XML / JSON files**
checked in under the test tree.  These must be sanitised copies of real pages,
not raw downloads:

- Strip author by-lines, profile images, and any personal-contact information.
- Remove third-party tracking scripts and pixels.
- Keep enough structural fidelity that the parser under test can exercise its
  real logic.

Do **not** commit full article bodies that are under copyright.  Use an excerpt
short enough to qualify as fair use, or replace the body text with
clearly-fictional placeholder prose.

### 1.5 AI evaluation datasets

Location: `evals/` (managed by the AI evaluation harness described in
[`../ai/evaluations.md`](../ai/evaluations.md))

- Datasets are JSON files containing representative **inputs and expected
  invariants**, not expected literal outputs.
- Inputs must be invented or anonymised.  Never paste real user quiz answers,
  prompt/response logs, saved words, or article bodies from production.
- When a prompt or schema changes, update the relevant `evals/*.json` dataset
  and re-run the harness locally before opening a PR.

---

## 2. Privacy rules for all fixture layers

These rules apply to every fixture type above.

| Rule | Detail |
|---|---|
| **No real user data** | Never use production user IDs, email addresses, names, session tokens, or any data sourced from a live database. |
| **No secrets** | API keys, OAuth tokens, session tokens, and database passwords must never appear in fixture files or test source.  Use clearly-fictional values (`"fake-token"`, `"test-secret"`). |
| **No raw proprietary article bodies** | Only use invented prose, clearly-fictional placeholders, or short fair-use excerpts.  Full licensed article text must not be committed. |
| **No prompt/response logs** | AI provider request and response payloads are never persisted in fixtures or version-controlled corpora. |
| **Fictional IDs** | Use short, obviously-test values (`"u1"`, `"a1"`, `"user-1"`) in unit fixtures, or the `dbit_` prefix (from `id()`) in integration fixtures. |

For the authoritative classification of each Prisma model field and which fields
are safe to reference in fixtures, see the
[data classification and retention matrix](../security/data-lifecycle-matrix.md).

---

## 3. Schema change obligations

When a Prisma schema migration changes a model that is referenced by test
fixtures, all of the following must be updated **in the same PR**:

1. **Unit factory builders** — update the relevant builder in `tests/support/`
   so it reflects the new field set.  Remove obsolete fields; add required ones
   with sensible fictional defaults.
2. **Integration seed** (`tests/db/support/fixtures.ts`) — ensure
   `seedQueryPlanFixture` (or any other integration seed) passes valid data for
   any new `NOT NULL` columns.
3. **E2E fixtures** (`src/lib/testing/e2e-fixtures.ts`) — update
   `E2E_ARTICLES`, `createUserWithSession`, or the article stub shape if the
   corresponding models changed.
4. **AI eval datasets** (`evals/`) — update the relevant dataset JSON if the
   prompt or schema change affects the shape expected by the harness.
5. **Scraper corpora** — update any checked-in HTML/JSON test files if the
   parser output shape changed.

Run `npm run typecheck` after updating to confirm no fixture builder has a
type error against the regenerated Prisma client.

---

## 4. Adding new fixtures

### 4.1 New unit factory builder

1. Check whether an existing file in `tests/support/` covers the domain.  If
   so, add the builder there.
2. If the domain is new (e.g. a new subsystem), create `tests/support/<domain>-fixtures.ts`.
3. Export only pure factory functions with an `Partial<T>` override parameter
   and a complete default value for every required field.
4. Add a JSDoc comment explaining what the builder is for and referencing the
   relevant domain module.

### 4.2 New Prisma delegate mock

Use `makePrisma` from `tests/support/prisma-mock.ts` to compose delegates:

```ts
const db = makePrisma({
  ...makeArticlePrisma(() => articleExists),
  savedWord: {
    findMany: async () => [],
    create: async (args) => ({ ...args.data, id: "sw1" }),
  },
});
mock.module("@/lib/prisma", { namedExports: { prisma: db } });
```

If the same delegate shape recurs across multiple test files, extract a helper
(e.g. `makeSavedWordPrisma`) into `tests/support/prisma-mock.ts`.

### 4.3 New integration test

1. Import `enabled` from `tests/db/support/db-config.ts` and guard the file.
2. Call `registerIntegrationCleanup()` once at the top level.
3. Generate every row ID with `id("descriptive_label")`.
4. Never hard-code a plain UUID or integer ID — the `dbit_` prefix is required
   for the cleanup sweep to find and delete the rows.

### 4.4 New e2e fixture

1. Add any new static article to the `E2E_ARTICLES` constant in
   `src/lib/testing/e2e-fixtures.ts` with a stable, descriptive ID.
2. Update `seedE2eArticles()` if the article requires additional associated
   rows (tags, reading progress, etc.).
3. Verify that `resetE2eDatabase()` correctly tears down the new rows by
   checking the deletion order respects foreign-key constraints.
