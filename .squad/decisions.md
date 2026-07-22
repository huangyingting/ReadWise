# Squad Decisions

## Active Decisions

### 2026-07-20T15:35:35Z: Canonical-conflict KIND is single-sourced

**By:** Scribe (recording Admin IA gap audit decision)

**What:** Conflict KIND is single-sourced through `classifyConflictKind(incumbentCandidateId)` in `canonical-conflict-policy.ts`. The resolver and detail query both call the same helper so baseline Type A and runtime Type B behavior remains in agreement.

**Why:** Agreement by construction prevents the UI from presenting a resolution selector the resolver rejects. The invariant is pinned by a source-level test.

**References:** Issue #1158, PR #1161.

### 2026-07-20T15:35:35Z: Deferred #1159 tenant-admin and tag-chip items

**By:** Scribe (recording Admin IA gap audit decision)

**What:** Issue #1159 items 1 and 3 remain deferred. Item 1 (tenant Organization/Classroom admin surface) needs product scoping and RBAC wiring, so it is not a minimal gap fix. Item 3 (per-tag chip UI) is a UX nicety over the already-functional replace-all tag editing surface.

**Why:** The Admin IA audit fixed backend-supported relationships/attributes where a minimal UI could safely expose them. Tenant administration requires broader authorization/product decisions, while tag chips do not block existing tag configuration.

### 2026-07-20T15:35:35Z: Article moderation visibility is public-library-only

**By:** Scribe (recording Admin IA gap audit decision)

**What:** Article moderation visibility editing is intentionally restricted to the ownerless public-library subset `PUBLIC` ↔ `UNLISTED`. `PRIVATE` and `ORG` are owner/organization-scoped, tenant-integrity-coupled values. They are hard-blocked server-side with HTTP 409 and rendered read-only in the UI.

**Why:** Moderation can safely toggle discoverability for public-library articles, but reassignment into owner/org scope would require tenant/product ownership semantics outside a minimal admin fix. This mirrors the existing moderation `status` restriction to `DRAFT`/`PUBLISHED`.

**References:** Issue #1159 item 2, PR #1162.

# Switch: Baseline Unit Test Fix — Source Untouched

**Date:** 2026-07-19  
**Agent:** Switch (Tester)  
**PR:** https://github.com/huangyingting/ReadWise/pull/1107  
**Branch:** squad/fix-baseline-unit-tests
Corrected findings: CEFR B1 208 (95.9%), B2 7 (3.2%), A2 2 (0.9%); Lexile-like min 590, median 870, mean 861.66, max 1050; confidence high 165, medium 52, low 0. `prisma/e2e.db` should be treated only as a non-representative smoke observation. Provider DB evidence still shows B1 compression and reinforces the need for calibration before treating CEFR or Lexile-like labels as authoritative.


# Decision: Discovery ledger schema (#1081)

- **Author:** Tank (Backend Dev)
- **Date:** 2026-07-19
- **Issue:** #1081 (parent epic #1078, program #1077)

## Context
Phase 1 of stateful incremental provider ingestion needs durable relational
state for source scheduling and a permanent candidate/alias ledger that makes
the governing invariant (never auto-reingest a known Article) enforceable.

## Decisions

1. **`providerKey` is a plain string, NOT an FK to `ContentSource`.**
   Rationale: matches the existing `ContentSource` / `CrawlRun` convention
   (providerKey references the code registry key, not a row). Keeps the change
   additive and decouples ledger lifecycle from `ContentSource` rows. The new
   `DiscoverySource` lives ALONGSIDE `ContentSource`/`CrawlRun` (not a
   replacement): ContentSource holds provider health/policy; DiscoverySource
   holds per-source incremental scheduling/lease/watermark state.

2. **`CrawlCandidate.articleId` is nullable + `onDelete: SetNull`.**
   Core invariant enforcement: deleting an Article nulls the back-reference but
   never deletes/resets the candidate identity, so a known URL is never silently
   re-ingested. `articleDeletedAt`/`terminalReason` preserve history.

3. **Cascade split:** source-run observations expire with their DiscoverySource
   (Cascade); candidate identity, aliases, conflicts survive (SetNull to
   source/article; aliases Cascade to the permanent candidate).

4. **Orthogonal controlled fields:** role / lifecycleMode / automationPolicy /
   health are separate enums; candidate `status` vs `observedInBaseline` are
   independent — no overloaded state column.

5. **Versioned sanitized identity keys** (`identityVersion` + `*Key`), never raw
   secret-bearing URLs. Metadata only.

6. **Migration timestamp `20260719051551`** used for both engines (PG dir renamed
   to match SQLite to satisfy migration-name parity).

## Verification
- `npm run schema:generate` + `schema:check-parity` + `schema:validate`: OK.
- `npm run typecheck`: clean.
- SQLite focused test (`tests/db/discovery-ledger.test.ts`): 12/12 pass.
- PostgreSQL: same test 12/12 pass; full `test:db` suite 34/34 pass.

# Tank — Issue #1083 (Phase 1.3) baseline seed & conflict isolation

**By:** Tank (Backend Dev)
**Date:** 2026-07-19
**Branch:** squad/1083-baseline-seed
**PR:** #1109 (https://github.com/huangyingting/ReadWise/pull/1109)

## Decisions

### Identity mapping (#1082 string tag → #1081 numeric+string columns)
- `identityVersion` (Int) = numeric parse of `URL_IDENTITY_VERSION`: `"v1"` → `1`
  (strip leading `v`, parse int; guarded).
- `provisionalKey` / `aliasKey` / `canonicalKey` / `challengerKey` (String) =
  the FULL versioned key emitted by #1082 (`"v1:<sha256hex>"`), NOT the bare hash.
  Rationale: the full key is the module's public identity token, self-describing,
  and collision-safe even if a future version reused the numeric column. Applied
  EVERYWHERE consistently (candidate + alias + conflict).

### CrawlCandidateStatus for backfilled articles
- Chose `INGESTED` with `ingestedAt` + `terminalAt` set, `terminalReason =
  "baseline-existing-article"`, `observedInBaseline = true`.
  Rationale: these are EXISTING, fully-published public Articles whose body is
  already persisted — INGESTED is the truthful terminal outcome. `BASELINE`
  denotes "seen during baseline but not necessarily ingested"; that would
  understate reality. `observedInBaseline=true` is the governing-invariant flag
  that keeps normal incremental runs from ever re-ingesting.
- `firstObservedAt`/`lastObservedAt` = `article.publishedAt ?? article.createdAt`
  (preserves temporal ordering; NOT inferred from network). `canonicalKey` left
  NULL (we never infer a page canonical here).

### Conflict-reason vocabulary
- `CanonicalConflict.reason = "baseline-duplicate-provisional-identity"`,
  `status = OPEN`, `canonicalKey = challengerKey = <contested key>`,
  `incumbentCandidateId = null` (fail closed for that identity ONLY; no candidate
  created for any article in the group). Unrelated identities/providers proceed.

### Skip reasons (recorded in report, metadata-only)
- `missing-source-url`, `no-registered-provider`, `invalid-url`,
  `unsupported-scheme`. `deriveProvisionalIdentity` is permissive but returns
  `providerKey: null` for unregistered hosts → we SKIP (candidate.providerKey is
  NOT NULL; we never fabricate a provider). Throwing UrlIdentityError → skip.

### Idempotency / safety
- No schema change (relies on #1081 `@@unique([providerKey, identityVersion,
  provisionalKey])`). Existence-check + create with P2002-tolerant catch →
  accurate created/existing counts and rerun/interrupt-safe convergence.
- Dry-run/report mode: reads + classification only, ZERO writes, imports only the
  PURE url-identity module (no scraper fetch dependency).
- Report is metadata-only: article IDs + controlled conflict reason + counts;
  no content, titles, URLs, or user-private data.

### Placement
- Core logic: `src/lib/scraper/incremental/baseline-backfill.ts` (testable).
- CLI: `scripts/backfill-discovery-baseline.ts` (`--dry-run`), npm script
  `backfill:discovery-baseline`.

# Tank — Issue #1085 (Phase 1.5) atomic page commit & classification

**By:** Tank (Backend Dev)
**Date:** 2026-07-19
**Branch:** squad/1085-atomic-page-commit
**Base HEAD:** 546daa06

## Decisions

### Module layout (orchestration interface under src/lib/scraper/incremental/)
- `classify.ts` — PURE classifier (no DB/network). `page-commit.ts` —
  single-transaction commit + re-exports the pure surface so callers import ONE
  module. Routes/scripts/workers call `commitDiscoveryPage`; they never
  re-implement admission/classification.

### Page adapter result shape (`DiscoveryPageResult`)
- `items: DiscoveryPageItem[]` (url, optional `stableId`, controlled
  `publishedAt` + `dateProvenance`, optional `positionRank`/`httpStatus`),
  `continuation: {cursor?, page?} | null`, `boundaryReached`, and
  `validators: {etag?, lastModified?, validatorVersion?}`. Built on the #1084
  `DiscoveredUrl` shape via `pageItemFromDiscoveredUrl` (channel→provenance:
  rss/api→FEED, sitemap→PAGE_METADATA, else URL).

### Classification outcome vocabulary (exactly one per item)
`policy-rejected` | `existing-identity` | `baseline-shadow` | `outside-window` |
`review-required` | `eligible`.
- Identity mapping kept CONSISTENT with #1083: `identityVersionToInt`, full
  `"v1:<sha256hex>"` key as `provisionalKey`. Admission gate = provider
  `articleUrlPattern` + `articleUrlFilter` on the normalized (secret-free) URL.
- Precedence: normalize→provider→admission (reject) → existing-identity (wins in
  ALL modes) → non-ACTIVE ⇒ baseline-shadow → ACTIVE dated-window
  (review-required if undated, outside-window if ≤ windowStart, else eligible).
- **Candidate persistence policy (deliberate):** candidates are created only for
  `eligible` (DISCOVERED) and `baseline-shadow` (BASELINE, observedInBaseline).
  `existing-identity` bumps the existing candidate's `lastObservedAt` ONLY (never
  status/observedInBaseline/articleId — governing invariant). `policy-rejected` /
  `outside-window` / `review-required` are OBSERVATION-ONLY (no candidate), so
  rejections/frontier decisions stay re-evaluable and the permanent ledger is not
  polluted with nav-link/rejected identities.
- **Observation = universal per-item durable outcome.** Every item gets exactly
  one idempotent `DiscoveryObservation`. `observationKey` = versioned identity key
  when derivable, else a one-way digest (`id:<stableId>` / `url:<sha256>`) — never
  a raw URL.

### Atomicity (checkpoint-after-writes)
- All classification reads (source snapshot + known-identity set) happen BEFORE
  the tx. ONE `prisma.$transaction`: (1) re-read + revalidate lease
  (`leaseOwner` + `definitionVersion`), (2) upsert candidates, (3) upsert aliases,
  (4) upsert observations, (5) **guarded** checkpoint advance
  (`updateMany where {id, leaseOwner, definitionVersion}`); count===0 ⇒ throw ⇒
  full rollback. Checkpoint advances only after every write, so a fault at any
  boundary rolls the whole page back — the checkpoint never advances with a
  missing outcome. TEST-ONLY `debugHooks` (receive the tx client) inject faults /
  a mid-commit lease steal.

### Idempotent races (cross-engine)
- Used `upsert` (INSERT … ON CONFLICT) for candidate/alias/observation — NOT a
  catch-P2002-inside-tx (which poisons a PostgreSQL transaction, unlike the
  standalone-write races in #1083). Two concurrent commits of the same page
  converge on one row set + one checkpoint; replay adds zero rows. Mirrors the
  guarded-conditional-update spirit of `claim-generic.ts`/`claim-postgres.ts`.

### Lease/version revalidation
- Pre-tx cheap check (early `lease-lost`/`source-not-found` return, no writes) +
  in-tx re-read + guarded checkpoint-advance conditional. A lease lost before OR
  during the commit never advances the checkpoint.

## Scope / non-goals honored
- No schema change (relies on #1081 models + constraints; parity OK).
- No due-source claiming / scheduler (#1087). No article body fetch, no
  `ARTICLE_INGEST` job — proven by tests. Network reads stay outside the tx.

## Verification
- `npm test`: 4622 pass / 0 fail / 51 skipped (baseline 4601/0/40 + 21 new pure
  tests; +11 db tests skipped without RUN_DB_INTEGRATION). Zero new failures.
- `npm run test:db` (SQLite): 11 new page-commit integration tests pass; only the
  22 pre-existing PG-guard failures remain (no new test:db failures).
- `npm run typecheck`: 0 errors. `npm run lint`: clean on touched files.
  `npm run schema:check-parity`: OK.

## Files
- src/lib/scraper/incremental/classify.ts (new)
- src/lib/scraper/incremental/page-commit.ts (new)
- tests/scraper-page-classify.test.ts (new)
- tests/db/page-commit.test.ts (new)
- docs/content/incremental-provider-scraping-design.md, docs/README.md

**References:** #1085, parent epic #1078, program #1077. Deps #1081/#1082/#1084.

# Decision: leased DiscoverySource scheduling (#1087, Phase 1.7)

- **Sibling loop, not a second daemon.** `runDiscoveryLoop` runs under the same
  `runJobWorker` runtime, sharing poll cadence / stop signal / `once` mode. The
  pass is activated only when `options.discovery.fetchPage` is supplied.
- **No schema change.** All fields (#1081) sufficed. "Pause" is modelled via the
  existing `PAUSED`/`DISABLED` lifecycle modes and `MANUAL` policy (not claimed),
  plus future `nextRunAt` / active `backoffUntil` (not due).
- **"Fallback" without a FALLBACK enum.** Modelled in the pure scheduler as a
  designated source that stays dormant (returns null → not due) until an
  activation flag (primary-failing / zero-discovery) is set by the caller.
- **Bounded single-page claim** over heartbeat: keeps leases short and resumes
  from the durable checkpoint. Non-boundary pages set `nextRunAt = now` so
  pagination continues page-by-page across claims.
- **Deferred:** production provider->DiscoveryPageResult fetcher wiring into
  `scripts/worker.ts` (later phase); machinery is fully tested via the seam.

PR: #1113 · branch: squad/1087-leased-discovery-scheduling

# Tank — Issue #1091 (Phase 2.1) atomically enqueue candidate-based ARTICLE_INGEST work

**By:** Tank (via Copilot, requested by huangyingting)
**Date:** 2026-07-19T13:00:00Z
**Branch:** squad/1091-candidate-ingest-enqueue
**Base HEAD:** cc134dc0

## Decisions

### Transaction-aware enqueue (`enqueueJobInTx` / `enqueueCandidateIngestInTx`)
- Added `enqueueJobInTx(tx, type, payload, dedupeKey, opts)` in
  `src/lib/jobs/enqueue.ts` that participates in the caller's EXISTING interactive
  transaction. Idempotency uses `tx.job.upsert({ where: { dedupeKey }, create,
  update: {} })` — NOT catch-P2002. A caught P2002 poisons a PostgreSQL
  transaction; `upsert` (INSERT … ON CONFLICT) is race-safe and returns the DB
  winner directly, so concurrent/replayed enqueues converge on one Job.
- The `update: {}` no-op is deliberate: an existing Job (ACTIVE or TERMINAL) is
  REUSED, never reset. This is the opposite of the standalone `enqueueDeduped`
  (which resets terminal jobs) and is what makes AC3 hold — the dedupe key
  includes the processing version, so ordinary rediscovery reuses the winner.
- No queue metric is emitted inside the tx (the surrounding page commit may roll
  back; counting "enqueued" before commit would be wrong). The standalone
  `enqueueJob`/`enqueueDeduped` remain unchanged for non-incremental callers.

### Candidate-based payload + dedupe key (pure seam `candidate-ingest.ts`)
- Payload shape: `{ candidateId, processingVersion }` ONLY — never a URL,
  provider policy, credential, or article data (AC4). Type lives in
  `types.ts` (`CandidateIngestPayload`); builder/validator/dedupe-key/predicate
  live in the PURE, DB-free `src/lib/jobs/candidate-ingest.ts` so they are
  unit-testable + covered by the unit-only coverage gate.
- Dedupe key: `article-ingest:candidate:<candidateId>:v<processingVersion>`.
- Processing version: a code-defined constant
  `CANDIDATE_INGEST_PROCESSING_VERSION = 1` — NO schema change (the existing
  nullable `CrawlCandidate.processingVersion` column is not needed at
  enqueue-time; bumping the constant in code starts a fresh, independently-deduped
  attempt without disturbing prior terminal Job history).

### Page-commit wiring (eligible-only, ACTIVE-only, same transaction)
- In `commitClassifiedItem` (`page-commit.ts`), after the candidate upsert +
  provisional alias, an item classified `eligible` in `ACTIVE` lifecycle mode
  enqueues one candidate-based ARTICLE_INGEST job via
  `enqueueCandidateIngestInTx(tx, candidateId)` INSIDE the same `$transaction`
  that writes candidate/alias/observation and advances the guarded checkpoint.
  Any later rollback (fault or lost lease at the checkpoint advance) rolls the
  Job back too, so a committed checkpoint never points past a missing Job (AC1).
- Gate is `outcome === "eligible" && lifecycleMode === ACTIVE`. `eligible` is
  only ever emitted by the pure classifier in ACTIVE mode; the explicit mode
  check is belt-and-suspenders. Baseline / shadow / existing-identity /
  review-required / outside-window / policy-rejected candidates NEVER enqueue.
- `CommitDiscoveryPageResult` gained `ingestJobsEnqueued` for observability/tests.

### Worker dispatch + #1095 hand-off boundary
- `createDefaultRegistry` now dispatches ARTICLE_INGEST on payload shape: a
  candidate-based payload → `makeCandidateIngestHandler(loadCandidate)`; the
  legacy url/articleId ArticleIngest payload → the existing article processor
  (kept as-is for its existing callers; NO runtime compat layer added).
- The candidate handler RESOLVES the candidate by id at execution time
  (`loadCandidate`, injectable for unit tests; defaults to
  `prisma.crawlCandidate.findUnique`), then:
  - malformed payload → permanent `validation` JobError;
  - missing candidate → permanent `missing` JobError (dead-letter);
  - terminal (INGESTED/REJECTED/SKIPPED) / `observedInBaseline` / already
    `articleId`-linked candidate → safe no-op (a known identity is never
    re-ingested — governing invariant);
  - otherwise → a clear no-op hand-off point. Fetch / extract / Article creation
    is EXPLICITLY OUT OF SCOPE (#1095); nothing is fetched or created here, and
    no URL/article content is ever logged (AC4).

## Verification (SQLite locally; PG job in CI)
- `npm run typecheck` → 0 errors.
- `npm test` → 4935 tests, 4833 pass, 0 fail, 102 skipped (baseline 4819 pass /
  0 fail / 95 skipped; +14 new unit tests, +7 DB tests skipped in the unit run).
- `npm run test:db` → 22 failures, ALL pre-existing "requires a PostgreSQL
  DATABASE_URL"; new candidate-ingest DB suite (7) + updated page-commit (11) pass.
- `npm run lint` (touched files) → clean.
- No schema change → no parity run needed. No API route touched → no api-catalog.

## Test-behavior change (intentional)
- The existing `page-commit.test.ts` "eligible page commit …" test asserted NO
  ingest job (Phase-1 discovery-only). Updated to assert exactly ONE candidate-
  based ingest job + PII-free payload + still NO Article. Its `afterEach` now also
  deletes the candidate-keyed ingest jobs (they are not swept by the PREFIX sweep).

# Decision Log — #1093 (Phase 2.3) retries, quarantine, extractor-version reactivation

Datetime: 2026-07-19T16:00:00Z
By: Tank (via Copilot, requested by huangyingting)

## Failure taxonomy → disposition
- Pure `classifyIngestAttempt({outcome, now, attemptNumber, firstAttemptAt, config})` maps a #1095-supplied ingest-attempt outcome to `{disposition, reason, retryAfterMs?, nextAttemptAt?}`.
- Reason codes are machine-only (never bodies/URLs): fetch_timeout, network_error, http_404_pre_propagation, http_403_temporary, http_429, http_5xx, extraction_incomplete, quality_rejected, http_410_gone, access_restricted, http_client_error, http_404_after_grace.
- Permanent (immediate `terminal`): 410, access-restricted, other non-404/403/429 4xx.
- Transient (`retry` while attempts remain, else `quarantine-on-exhaustion`): timeout, network, 404 within grace, 403 temp, 429, 5xx, extraction-incomplete.
- Deterministic reprocessable (`quarantine-on-exhaustion` immediately, reactivatable by extractor upgrade): quality-rejected; and 404 after the propagation grace window elapses.

## Grace + backoff + Retry-After
- Newly-discovered candidate gets a CONFIGURABLE propagation grace window (SCRAPER_INGEST_PROPAGATION_GRACE_MS, default 6h) measured from firstIngestAttemptAt.
- A 404 within grace = pre-propagation transient (retry); after grace = quarantine (persistent not-found).
- Next attempt = now + Retry-After when the server supplied one (overrides backoff); otherwise now + jitteredExponentialBackoff(attemptNumber, base, max) reusing src/lib/backoff.ts. Fake-clock + injectable random for determinism.

## QUARANTINED semantics
- New CrawlCandidateStatus.QUARANTINED = ONE visible terminal-ish state for exhausted transient or deterministic reprocessable failures.
- NOT re-enqueued on rescan: page-commit only enqueues ingest for a NEW `eligible` classification; re-observing an existing candidate touches lastObservedAt only and never enqueues, and the ingest Job dedupe key already exists (terminal Job reused, never reset). QUARANTINED is thus stable across scans.
- Permanent (410/access) → status REJECTED (immediate terminal), distinct from QUARANTINED.

## Reactivation eligibility + budget + version-bump dedupe
- Pure `selectReactivationEligible(candidates, {newExtractorVersion, budget})`: eligible iff articleId==null AND !observedInBaseline AND status==QUARANTINED AND lastFailureReason ∈ {extraction_incomplete, quality_rejected} AND (extractorVersion==null || extractorVersion < newExtractorVersion). Budget caps the returned set (deterministic order).
- Prohibited (never reactivated): INGESTED/any-articleId (saved/deleted), NEEDS_REVIEW, CONFLICT, DUPLICATE_ALIAS, SKIPPED (policy), REJECTED (permanent), BASELINE/observedInBaseline.
- `reactivateCandidate` bumps candidate processing version to newExtractorVersion, sets extractorVersion, resets attempt metadata + status→DISCOVERED, and enqueues a NEW ARTICLE_INGEST Job via candidateIngestDedupeKey(id, newExtractorVersion). The prior terminal Job (dedupe v1) stays intact for audit.

## New CrawlCandidate columns (metadata only)
ingestAttemptCount Int @default(0); nextAttemptAt DateTime?; lastFailureReason String?; firstIngestAttemptAt DateTime?; extractorVersion Int?.

## Governing invariant enforcement
All recovery/reactivation persistence guards on articleId==null AND !observedInBaseline AND status in the in-progress/quarantine set via a guarded updateMany (count===0 ⇒ throw ⇒ rollback). A known Article (articleId set) or baseline identity is never retried, quarantined, or reactivated.

# Decision: #1094 rate-governor durability split & fairness design

- **Date:** 2026-07-19T17:30:00Z
- **Author:** Tank (Backend/DB/Jobs)
- **Issue:** #1094 (Incremental scraping P2.4)

## Context
Enforce a shared per-hostname budget across discovery + body, provider fairness,
incremental>backfill priority reservation, independent cost budgets, backoff/pause,
and backlog throttling — deterministic, no external broker.

## Decisions
1. **Pure/thin split.** All logic in pure `rate-governor.ts` (injected `now` +
   plain snapshots, no DB/net/clock). Persistence in thin `rate-governor-commit.ts`
   (reads before tx; single `$transaction` re-validates; guarded increment then
   rollback → defer). Config assembly in `rate-governor-config.ts`.
2. **In-flight concurrency = ephemeral, derived** from leased sources / locked jobs
   (self-heals across restart). NOT stored. Passed into the pure decision as input.
3. **Durable state = two tables.** `ScraperBudgetWindow` (per (scope,scopeKey,utcDay)
   counter — auto-resets by UTC day, no sweeper) for hostname ceiling / provider
   quota / cost budgets; `HostnameGovernorState` (per hostKey, cross-day) for
   lastRequestAt / pausedUntil / consecutiveErrors / lastFailureReason.
4. **`scope` is a plain String, not a Prisma enum** — adding a budget kind needs no
   PostgreSQL `ALTER TYPE`.
5. **Idempotent increment = upsert (INSERT..ON CONFLICT)**, never catch-P2002-in-tx.
6. **Fairness comparator:** incremental tier → fewest in-flight (anti-starvation)
   → oldest pending (FIFO) → providerKey. KEEP the PG FOR UPDATE SKIP LOCKED claim
   intact; fairness pre-filters the eligible provider set, not the atomic claim.
7. **AI budget is advisory** — never stops discovery/candidate persistence.

## Deferred to #1095
Body-fetch DISPATCH wiring and per-provider/hostname BODY in-flight derivation
(Job payload today is only {candidateId, processingVersion}; no hostname/provider,
no Job→CrawlCandidate relation). Governor + discovery-path gate + seams delivered.

# Tank — #1095 Atomic Article save (Phase 2.5) — as-built decisions

Date: 2026-07-19T19:00:00Z
Branch: squad/1095-atomic-article-save

## Composition approach
Composed the #1092 pure resolver + thin guarded persistence rather than
duplicating them. New `ingest-runner.ts` (`createIngestAttemptRunner`) does
fetch/extract (injected seam) OUTSIDE the tx → `applyFinalIdentity` (#1092) →
only on a `kept`/`transferred` genuinely-new public identity → new
`article-save-commit.ts` (`saveIncrementalArticle`) which owns the single
all-or-nothing `$transaction` (create Article → guarded candidate link →
in-tx `ARTICLE_PROCESS` enqueue).

## INGESTED vs SAVED
REUSED `CrawlCandidateStatus.INGESTED` (+ attach `articleId`). No new `SAVED`
enum. INGESTED already means "candidate → Article" and is already in every
terminal set; the governing-invariant guard keys on `articleId != null`. A
distinct SAVED added no semantics and would have forced a 3-file schema-parity
change + terminal-set edits. Deliberately avoided.

## Schema-or-not
NO schema change. The candidate-level #1092 body fingerprint (linked via
`articleId`) already supports the cross-provider body-match stop; no Article
fingerprint columns were added. Avoids the 3-file parity workflow entirely.

## Race / convergence handling
- Article created + candidate linked + job enqueued in ONE interactive tx.
- Guarded `updateMany({ id, articleId: null, observedInBaseline: false, status in SAVEABLE })`
  in the SAME tx as the Article insert is the serialization point: a losing
  concurrent worker matches 0 rows → throw → its Article insert rolls back too.
- P2002 is NEVER caught inside the tx. `SaveRaceError` / Article `@@unique`
  P2002 propagate out; a bounded standalone loop (MAX 5) re-reads the winner and
  converges (attach to existing Article, ensure its job). Never a duplicate
  Article, never a saved candidate without its required job.

## Revalidation guards (inside tx, before create)
governing invariant (articleId null + not baseline), saveable status,
provider ownership (`expectedProviderKey`), source activation generation
(lifecycleMode ACTIVE + definitionVersion + activatedAt marker unchanged).
Failure → deterministic `revalidation-failed` (stale-generation /
provider-mismatch), whole tx rolls back, NOT retried.

## Governor-body decision
DEFERRED (documented follow-up). Body-fetch dispatch + routing through the
#1094 rate governor land behind the ONE injected `prepareDraft` seam. The Job
payload + ledger persist only sanitized hashed identity keys
(`{candidateId, processingVersion}`), NOT a fetchable URL, so resolving a URL to
fetch needs a separate URL-availability change out of #1095's atomic-save scope.
`createDefaultRegistry` leaves `runIngestAttempt` unset by default (preserves the
existing hand-off no-op) unless `candidateIngest.runIngestAttempt` is supplied.

## Verification
- typecheck: 0 errors
- npm test: 4918 pass / 0 fail / 138 skipped (baseline 4907/0/127; +11 unit
  tests, +11 new DB tests skip without RUN_DB_INTEGRATION)
- npm run test:db (SQLite): 117 pass / 22 fail — all 22 are the expected
  "test:db requires a PostgreSQL DATABASE_URL" guards (== baseline), no other
  not-ok lines; the 11 new DB tests pass.
- eslint on every touched file: clean
- no schema change → no parity check needed

# Decision: publication-policy module lives in lib/processing, not lib/scraper

Date: 2026-07-19T20:30:00Z
Agent: Tank
Issue: #1096 (Phase 2.6 — gate trusted-provider auto-publication)

## Context

The #1096 seam map recommended placing the pure publication-policy module at
`src/lib/scraper/incremental/publication-policy.ts`. However the trusted-provider
publication GATE is enforced inside `src/lib/processing/processor.ts`
(`publishDraftIfReady`), so the processor must consume the policy.

## Constraint

`tests/scraper-content-boundaries.test.ts` enforces a one-way ownership boundary:
`src/lib/processing/*` MUST NOT import from `@/lib/scraper`, `@/lib/content-pipeline`,
or `@/lib/sanitize`. Importing the policy from `lib/scraper` (and `MIN_WORD_COUNT`
from `@/lib/scraper/quality`) violated this boundary.

## Decision

- The pure policy lives at `src/lib/processing/publication-policy.ts` (the publish
  gate's owner). No scraper code consumes it (ingest does not publish).
- The body-quality word floor is declared locally as `MIN_PUBLISH_WORD_COUNT = 50`
  in the processor (mirrors the scraper `MIN_WORD_COUNT` value) rather than
  importing across the boundary.

## Consequence

Respects the module boundary with zero behavior change. The DiscoverySource trust
fields are still read via the `crawlCandidates` relation in the processor; no
scraper import is required.

# Decision: explicit incremental trigger modes + active→shadow rollback

Date: 2026-07-19T22:00:00Z
Agent: Tank
Issue: #1097 (Phase 2.7 — move admin/CLI triggers to explicit incremental mode with rollback)

## Context

The admin provider trigger (`admin-trigger.ts`) and the provider CLI
(`scripts/scrape-provider.ts`) both synchronously looped `discoverProviderUrls` +
`scrapeAndSave`, which can rescrape KNOWN public Articles — a governing-invariant
violation. #1097 closes those legacy paths and routes normal operator actions
through the incremental ledger.

## Decision 1 — Trigger-mode taxonomy

New pure module `src/lib/scraper/incremental/trigger-mode.ts`:
`TRIGGER_MODES = ["incremental","backfill","force-rescrape"]`, default
`incremental`, IMPLEMENTED = `["incremental"]`. `validateTriggerMode` accepts
only `incremental`; `backfill`/`force-rescrape` return a typed
`not-implemented` rejection (explicit "until Phase 3"). The route body validator
uses `oneOf(TRIGGER_MODES)` and `object()` drops unknown keys, so a client cannot
smuggle a `force`/bypass flag (AC3). Phase-3 modes are NOT implemented here
(non-goal).

## Decision 2 — Job cancellation uses DEAD_LETTER (no new enum value)

"Cancel unclaimed candidate jobs" = the source's `PENDING` candidate-based
`ARTICLE_INGEST` jobs. The house already has `cancelJob()` moving a job to
`DEAD_LETTER` with a controlled reason; there is no `JobStatus.CANCELLED`. I
REUSE `DEAD_LETTER` (reason `"rollback-cancelled"`) rather than adding a new enum
value. Rationale: consistent with the existing cancellation convention, avoids an
enum-add migration, and `DEAD_LETTER` is already terminal + non-claimable
(`RUNNABLE_STATUSES = [PENDING, FAILED]`). Guarded on `status = PENDING` so a
concurrently-claimed job is never cancelled — it fails closed at Article commit
via the #1095 generation guard instead. Candidates + observations are untouched.

## Decision 3 — Activation generation = new `activationGeneration Int` column

The #1095 guard (`revalidateSourceGeneration`) already fails in-flight saves
closed while `lifecycleMode !== ACTIVE`. The MISSING piece: a job whose snapshot
predates a rollback must ALSO fail closed after a LATER re-activation. Because
`activatedAt` is stamped only once (first activation), re-activation does not
change it, so the pre-rollback snapshot would wrongly pass. I add
`DiscoverySource.activationGeneration Int @default(0)`, INCREMENTED on every
active→shadow rollback, captured in `SourceGenerationSnapshot`, and checked by
`revalidateSourceGeneration`. A pre-rollback snapshot then has a strictly lower
generation than the re-activated source → `stale-generation` → NO Article
(dovetails with, and keeps, the existing definitionVersion/activatedAt/mode
guards). Chose an explicit counter over re-stamping `activatedAt` to preserve
`activatedAt`'s display semantics and the once-only stamping.

## Decision 4 — Admin trigger + CLI request a run; they do not fetch/save

Normal path now REQUESTS an incremental discovery run by making the provider's
claimable-mode discovery sources (`SHADOW/BASELINE/ACTIVE`) due
(`nextRunAt = now`, guarded `updateMany`). Bodies are fetched later by the
candidate-ingest job pipeline; the trigger never fetches or saves. `scrapeAndSave`
and `discoverProviderUrls` are removed from both normal paths, proving the legacy
save path unreachable.

## Decision 5 — Which scripts are "normal workflows" vs dev/one-off tools

- CONVERT (normal provider workflow): `scripts/scrape-provider.ts` `scrape`/
  `resume` → incremental request.
- LEAVE (explicitly-authorized dev/one-off tools, invoked only by a manual
  `npm run …`, wired into NO admin route or scheduler): `scripts/scrape.ts`,
  `scrape-undark.ts`, `scrape-smithsonian.ts`, `scrape-reading-sources.ts`,
  `scrape-review.ts` (no DB), `build-quality-corpus.ts`, and `src/lib/seed.ts`
  (used only by `scripts/seed.ts` for local dev seeding). They already skip
  existing sourceUrls and are not reachable as a normal operator action. The
  scheduled discovery workflow already runs through the ledger
  (`runDiscoveryLoop`), so there is no legacy scheduled synchronous scrape.

## Consequence

Rollback (active→shadow) atomically: stops enqueue (mode flip + parks
`nextRunAt`), cancels unclaimed candidate ingest jobs, and bumps
`activationGeneration` so stale running work fails closed even across
re-activation — while retaining candidates + observations for deterministic
requeue on a later explicit activation.

# Decision note — #1132 reconcile stamped-but-unclaimed rescrape regeneration

- **Agent:** Tank (Backend/DB/Jobs)
- **PR:** #1137 — `squad/1132-rescrape-regen-reconciler` → `main`
- **Commit:** 2d203e7d25347fe892c7103e319b98fd8e1c746b
- **Schema change:** none (queries existing columns/tables only)

## What shipped
- `src/lib/scraper/incremental/rescrape-regen-reconcile.ts` — `countUnclaimedRescrapeRegen()` +
  `reconcileUnclaimedRescrapeRegen({ limit?, now? })`, pure `clampReconcileLimit` /
  `reconcileStampCutoff` helpers.
- `scripts/reconcile-rescrape-regen.ts` + `maintenance:rescrape-regen` npm script (mirrors
  `retention-maintenance`).
- Tests: `tests/db/rescrape-regen-reconcile.test.ts`, `tests/rescrape-regen-reconcile.test.ts`,
  `tests/reconcile-rescrape-regen-cli.test.ts`.
- Docs: `docs/operations/admin-operations.md`.

## Key decisions (rationale for reviewers)
1. **"Unclaimed" predicate:** version `status = ACTIVE` AND `derivedRegenerationRequestedAt <= now - grace`
   AND no `ArticleProcessingStep` with `step = rescrape-regen:<versionId>`. A step in **any** status
   (running OR generated) = claimed → skip. The claim persists permanently on success, so absence
   unambiguously means lost-enqueue.
2. **In-memory anti-join, action-bounded (not scan-bounded).** Prisma has no anti-join and the claim
   key is a computed string (not a relation). I scan the stamped-ACTIVE population id-only and subtract
   claimed steps (chunked lookup), then bound the **action** to `limit`. Deliberately did NOT bound the
   candidate *fetch* by `limit`: because almost every stamped-ACTIVE version is already claimed, a
   `take: limit` candidate fetch (oldest-first) could **starve** a genuinely-unclaimed version behind
   many older claimed ones. Force-rescrape is operator-gated/rare, so the id-only scan is cheap.
3. **Grace window = 2 min (`RECONCILE_GRACE_MS`), a named constant.** Skips just-activated versions so
   the sweep never races the original runner. Optimization only — re-invoking is already race-safe via
   the unique claim. Both sides tested.
4. **Re-invokes `requestDerivedRegeneration` (not reimplemented).** Idempotency + at-most-once come from
   the existing `@@unique([articleId, step])` claim; a raced claim returns `alreadyRequested`.

## Validation
- typecheck 0 errors; eslint (touched files) clean.
- `npm test` 0 fail (5248 pass, +7 new unit/CLI).
- `npm run test:db` — only the 22 pre-existing PG-guard failures (fail == guard-message count == 22);
  all 6 new DB tests pass on SQLite.
- `api-catalog` clean; `schema:check-parity` OK+OK.

## Deferred
None.

## 2026-07-19T10:45:00Z — Discovery-source admin UI (frontend half of #1089)

By: Trinity (via Copilot, requested by huangyingting)

**What:** Built the admin surface for discovery-source observability at
`/admin/discovery-sources` (list + `[id]` detail) plus lifecycle action controls
(`AdminDiscoverySourceActions`), a client-safe action-metadata module
(`lifecycle-action-meta.ts`), a pure action-eligibility mirror
(`lifecycle-action-eligibility.ts`), a shared status badge
(`DiscoverySourceStatusBadge`), and a `formatAgeSeconds` day-aware duration
helper. Added a "Discovery" AdminNav link, a unit test, and a Playwright spec.

**Why / notable decisions:**
- Server components read the observability query lib directly for the initial
  render (mirroring `/admin/sources`); the client component uses the POST
  lifecycle API for mutations. Keeps auth via `requireCapability` on the page.
- Single-sourced the seven action NAMES in a client-safe `lifecycle-action-meta`
  module and re-exported them from the server dispatcher (`lifecycle-actions.ts`)
  so the UI button set and the validated API set never drift.
- Action-button eligibility is a PURE mirror of `applyLifecycleAction` via
  `classifyLifecycleTransition`, computed server-side and passed as `enabledActions`
  so the client bundle never imports server/prisma code. `resume` is restricted
  to PAUSED (a safe subset of backend acceptance) rather than the broader classify
  result, so the UI never offers "resume" on a non-paused source.
- AC1 status badge uses `data-status` for robust test targeting; AC4 upheld by
  rendering only PII-free DTO fields (a unit test asserts no PII field names).
- E2e ran green in this environment (46s).

# Decision — #1104 P3.5: canonical-conflict + deleted-article governance UI

Date: 2026-07-20T09:00:00Z
By: Trinity (via Copilot, requested by huangyingting)

## Scope
Admin UI + focused UI-state tests only, layered on Tank's already-verified backend
(query/commit modules + 5 API routes) on branch `squad/1104-canonical-conflict-governance`.
No backend logic, routes, or query/commit modules were touched.

## Pure UI-state helper modules (React-free, shared by pages + tests)
- `src/lib/scraper/incremental/canonical-conflict-ui.ts` and
  `src/lib/scraper/incremental/deleted-article-ui.ts` hold all parsing, constants,
  type-guards, badge tones, count formatters, and error classifiers.
- **Why**: mirrors the `candidate-review-ui.ts` pattern so `node:test` suites can assert
  logic without importing React/jsdom. Pages import the same parsers, so searchParam
  bounds (`DEFAULT_*_LIMIT=50`, `MAX_*_LIMIT=200`, offset≥0) are single-sourced.
- Wire-accuracy: I `import type` the backend DTOs from the query/recovery modules and
  override `Date` fields to `string` via `Omit<Dto,"field"> & { field: string }`. This
  keeps compile-time field-name safety while matching the JSON serialization. Only
  `import type` is used, so no prisma value ever reaches the client bundle.

## Resolve flow (destructive, two-key)
- `ConflictDetailSheet` fetches `/api/admin/canonical-conflicts/{id}`, renders per-article
  dependent-data counts, and hosts a survivor radio over `detail.articles`, a required
  reason `Textarea`, and an explicit confirm `Switch`. POSTs
  `{ survivingArticleId, reason: reason.trim(), confirm: true }`.
- Server outcomes mapped in UI: 200 applied/noop, 400 `survivor-not-a-participant`
  (surface server message), 409 `stale` → "refresh & retry" banner, 404 not-found.
- **Why**: the survivor must be chosen from the conflict's own participants (never a free
  text id), and a destructive merge requires reason + confirm so the audit trail is
  complete before any Article is retired.

## Recover flow (destructive, two-key)
- `DeletedRecoverButton` (Popover, mirrors `ReviewActionButton`) collects reason + confirm
  and POSTs `{ reason, confirm: true }` to `/api/admin/deleted-articles/{id}/recover`
  (`{id}` = CrawlCandidate id). 409 `ineligible` and `conflict`(stale) get distinct
  messages; recovery is described as re-admission to the crawl pipeline, not a content
  restore.

## Privacy invariant
- UI renders only ids, sanitized hashes, dependent-data counts, reason categories, and
  timestamps. No URL, title, article/selected text, or credential field is fetched or
  displayed — enforced by the DTO shape and asserted by a dedicated test in each suite
  that greps the component source for forbidden field names.

## Design-system compliance
- Composed from `src/components/ui/*` primitives (`Button`, `Switch`, `Popover`, `Sheet`,
  `Field`, `Textarea`, `SegmentedControl`, `Badge`, `EmptyState`, `Skeleton`) +
  `AdminPageHeader`/`AdminTableWrap`. No raw hex/rgb/hsl, no raw `font-size`, no inline
  `style` font-size; token classes only (e.g. `text-[length:var(--text-sm)]`,
  `color-mix(... var(--danger) ...)`). Tests strip `#\d+` issue refs before the hex scan.

## AC3 (withdrawal/takedown) — verified, not rebuilt
- Existing UI `src/components/AdminArticleTakedown.tsx`, rendered from
  `src/app/admin/articles/[id]/page.tsx`, already drives
  `POST /api/admin/articles/{id}/takedown` (the existing content-governance model). No new
  UI was added — AC3 is satisfied by the existing surface.

## Deferred
- None. All deliverables landed; no follow-up issue filed.

---

### 2026-07-20: Platform-admin Organizations surface built ON the existing tenant system

**By:** Tank (Backend)
**What:** Added issue #1163's `/admin/organizations` oversight surface without rebuilding tenancy. One new global capability `organizations.manage` (Admin-only), a read-only `src/lib/admin/organizations/*` module (platform-wide list + org detail), two admin API routes (`GET`/`POST /api/admin/organizations`, `GET /api/admin/organizations/[id]`), and admin pages + two client islands. Member role/removal REUSES the existing `/api/orgs/[id]/members/[memberId]` tenant routes (system-admin bypass already there); create REUSES `createOrganization` + `addMember`.
**Why:** The tenant RBAC + CRUD already existed and was wired; the only gap was a staff-facing list-all/oversight surface. Reusing tenant commands/routes avoids duplicated mutation logic and keeps the last-admin guard authoritative in one place. Also corrected now-stale "not wired yet" comments in `src/lib/rbac.ts` (tenant caps/roles ARE resolved via membership) and regenerated `docs/platform/api-catalog.{json,md}` for the two new routes.

---

# Decision: Assignment sub-system (#1164)

**Author:** Tank (Backend) · **Date:** 2026-07-20 · **Issue:** #1164

## Context
Make the classroom assignment sub-system fully work: quiz-driven completion,
assignment edit, overdue indicators, and an optional manual-revert.

## Decisions

1. **Quiz-driven completion is a best-effort side-effect.** `markAssignmentQuizComplete`
   is called from the quiz-attempt route via `bestEffortMastery("quiz.assignment_completion", …)`,
   mirroring the existing `markTodayComprehensionComplete` wiring. It NEVER breaks the
   quiz write. Student id + score are server-derived (session + `result.attempt.scorePct`),
   never trusted from the body. Enrollment is scoped with the same
   `classroom: { members: { some: { userId } } }` pattern as `getStudentAssignmentContext`.
   The same article assigned in >1 enrolled classroom completes all matching assignments.

2. **Shared due-date/instructions helpers.** `parseOptionalDueDate` and `trimOrNull`
   are now exported from `article-assignments.ts` and reused by `updateAssignment`
   (commands.ts) so create and edit validate identically. `updateAssignment` only
   writes the fields present in its input (partial update).

3. **PATCH mirrors DELETE gating.** `PATCH /api/assignments/[id]` resolves the
   classroom via `getAssignmentClassroom`, then `requireClassroomManageApi` — teacher /
   org-admin / system-admin pass, others 403; missing assignment → 404. Body schema
   reuses the create route's `dueDate string({min:1,max:40})` + `instructions string({max:2000})`.

4. **Client-safe overdue helper.** `isAssignmentOverdue(dueDate, status, now)` lives in
   `src/lib/classroom/overdue.ts` with NO server-only imports (compares status against the
   `"COMPLETED"` string literal, not the Prisma enum) so it is safe to import into client
   and server components alike. Teacher-list status is synthesized from the analytics
   aggregate (`completed >= assigned && assigned > 0` → COMPLETED).

5. **New `listClassroomAssignmentMeta` query.** The analytics `perAssignment` aggregate
   omits `dueDate`/`instructions`, so the teacher page merges in a focused meta query for
   the overdue badge + edit-form prefill (keyed by assignmentId).

6. **Part 4 kept light.** Manual (quizScore == null) completions get an "Undo" button that
   POSTs `status: IN_PROGRESS` to the existing completion route. Quiz-driven completions
   (quizScore set) remain read-only in the UI — no new endpoint, no quiz-path complexity.

## No schema change
All fields already existed (`Assignment.dueDate/instructions`,
`AssignmentCompletion.status/quizScore/completedAt`).

---

# Decision: Tag chip editor for article moderation (#1159, item 3)

**Date:** 2026-07-20
**Agent:** Trinity (Frontend)
**Branch:** squad/1159-tag-chips
**Scope:** `src/components/AdminArticleReview.tsx` (client island) + new test.

## What changed
Replaced the single comma-separated tags `Input` with an add/remove **chip** UI.

- Tag state is now `string[]` (`useState<string[]>(() => parseTagList(initial.tags))`),
  seeded ONCE from the existing comma-joined `initial.tags` prop. `parseTagList` is
  retained solely for that initial parse.
- Each tag renders as a `Badge` (neutral) chip with a removable `IconButton` (lucide `X`,
  `aria-label={`Remove tag ${tag}`}`).
- New tags append via **Enter** (with `preventDefault` so it does not submit the form) OR
  an **Add** `Button`. Pure helper `addTagTo()` trims, ignores empties, and dedupes
  case-insensitively.
- Submit sends `tags` (the array) directly to the SAME `POST /api/admin/articles/[id]/review`
  body — dropped the `parseTagList(tags)` re-parse at submit.

## Decisions / tradeoffs
- **Backend contract unchanged.** The payload remains `tags: string[]` (replace-all); only the
  client-side representation changed. No route/api-catalog impact.
- **Primitives only.** Composed from `Badge` + `IconButton` + `Input` + `Button` + `Field`;
  no hand-rolled chip/button/focus ring. Token-driven (no raw hex / inline font-size).
- **Case-insensitive dedupe** keeps the first-seen casing (does not rewrite existing chips).
- **`IconButton size="sm"`** (28px) is the smallest shared icon-button; kept it rather than
  hand-rolling a tighter control, to honour design-system governance.

## Verification
- `npm run typecheck` → 0 errors
- `npm run lint` (touched file) → clean
- `npm test` → 5434 pass / 0 fail / 238 skipped

PR: targets `main`, closes #1159 (items 1 & 2 already shipped via #1163/#1164 and #1162).


### 2026-07-21T03:45:00Z: Global review cycle — 25 issues closed via 16 sequential PRs

**By:** Scribe

**What:** Captured the completed ReadWise global-review cycle. Phase 1 used four parallel read-only review lanes (Tank, Mouse, Morpheus, Trinity) to surface 35 findings, curated into issues #1169–#1193. Phase 2 implemented all 25 issues through 16 squash-merged PRs (#1194–#1209), one PR at a time on the shared working tree. Trunk `main` advanced to `3f9895fe` and all 25 issues closed.

**Decisions:**
1. Implementation remained strictly sequential because the working tree was shared; only read-only review was parallelized.
2. Safe merge pattern: `squash --admin --delete-branch` is acceptable only when the sole non-green gate is the systemic 98% native coverage gate lacking `RUN_DB_INTEGRATION`; all six functional gates must be green.
3. Issue #1189 preserved distinct weak-word thresholds: study-plan `0.4` and recommendation re-exposure `0.5`.
4. Issue #1207 archive semantics are additive nullable `Classroom.archivedAt` with paired SQLite/PostgreSQL migrations; DELETE hard-deletes only empty classrooms.
5. Known pre-existing native-runner isolation failure remains out of scope: `tests/server-read-models-runtime.test.ts` can fail under isolated native execution due circular-import/export ordering around `articleAccessContextForUser`, while full suite/CI passes.

**Why:** Provides future agents with the merge, routing, schema, and test-governance constraints established by this global-review implementation wave.


### 2026-07-21T05:57:04+0000: Global Review Cycle 2 closure

**Author:** Squad Coordinator  
**Requester:** huangyingting

**Scope:** Completed a full global review of ReadWise modules/functions across backend/auth/tenant/audit/jobs/classroom (Tank), data/AI/scraper/Prisma/privacy (Mouse), learning-domain/cross-cutting (Morpheus), and UI/design-system (Trinity). Four review lanes produced 22 findings, curated into 15 GitHub issues (#1210–#1224), and all 15 issues were implemented as sequential PRs merged to `main`. Final `main` HEAD: `f03978ff`.

**Outcomes:** #1210, #1211/PR #1233, #1212, #1213, #1214/PR #1227, #1215/PR #1228, #1216/PR #1226, #1217, #1218, #1219/PR #1235, #1220/PR #1234, #1221/PR #1236, #1222/PR #1237, #1223/PR #1238, and #1224/PR #1239 all landed on `main`.

**Key technical decisions:**
1. Implementation remained sequential on a single shared working tree: one branch/PR at a time, each merged before the next dispatch, to prevent parallel-edit clobbering.
2. Safe merges used `--squash --admin` only when the sole red gate was the systemic pre-existing `Unit tests + native coverage` failure (~107 DB-route failures plus 98% coverage gate); Build, Fast checks, PostgreSQL migrate/integration, tests, dependency review, and supply-chain hygiene still had to be green.
3. #1224 established the client-safe enum pattern: mirror the Prisma enum as a pure runtime const leaf module with `import type` plus bidirectional compile-time exhaustiveness assertions, keeping `canonical-conflict-ui.ts` Prisma-runtime-free while enforcing lockstep.

**Decision inbox:** Checked `.squad/decisions/inbox/`; no pending agent decision files were present.

**Verdict:** Cycle 2 global review is complete; all curated P1/P2 issues merged to `main` at `f03978ff`, with sequential orchestration, safe-merge criteria, and client-safe enum mirroring carried forward.
1. `src/lib/difficulty.ts` consolidation — `articleHtmlToReaderText` from `content-pipeline` shape may change under #946.
2. `src/lib/reader/page-loader.ts` — `sanitizeArticleHtml` + `articleHtmlToReaderText` from `content-pipeline`.
3. `src/lib/recommendations/scoring.ts` — `scraper/providers` has live uncommitted changes; interface is in flux.
4. `src/lib/article-library/admin.ts` — structural refactor touching `getArticleProcessingSteps`/`StepRow`.
5. `src/lib/article-library/collections/tags.ts` — `articleHtmlToReaderText` from `content-pipeline`.
6. `reader/` merge execution (if decided) — execution carries `page-loader.ts` pipeline coupling into article-library.
7. Full `difficulty.ts` + `difficulty-version.ts` consolidation into clean module — gated on content-pipeline final boundary.

---

## Deferred-Work Tracking Requirement (non-negotiable)

**The deferred scope MUST NOT be silently dropped.** A dedicated follow-up child issue must be filed under #939 to track these 7 deferred items explicitly. Acceptance criteria from #949 that are not deliverable in the PARTIAL GO pass must be replicated verbatim in the child issue with "Blocked by #946" annotation. This is a condition of PARTIAL GO authorization.

---

## Validation Path for ALLOWED Work

```
npm run typecheck
npm test -- tests/article*.test.ts tests/reader*.test.ts tests/recommendations*.test.ts tests/leveling*.test.ts
```

Note: `tests/difficulty*.test.ts` target remains in scope only for the constants/version file; `difficulty.ts` itself deferred.

---

## Ordering

1. **Start with leveling/** — fully isolated, clean seam, fastest win
2. **difficulty-version.ts** — constants consolidation decision
3. **recommendations/ (5 safe files)** — barrel + import-direction audit; document engagement→recommendations direction as intentional
4. **article-library/ (14 safe files)** — barrel doc pass + any-removal on safe sub-modules
5. **reader/ (3 safe files)** — scope review + document merge decision (do not execute)
6. **After #946 merges** → file child issue → execute deferred 7 items in one pass

### 2026-07-21T13-17-33: Assignment lifecycle refactor — target process + PR plan
**By:** Morpheus
**What:** Assignment lifecycle refactor — target process + PR plan
**References:** Tank, Trinity, Switch, RW-061, #1164
**Why:** ## Context
User ask: make the classroom assignment feature *workable* end-to-end between student and teacher. CRUD already exists (#1164) but the PROCESS is disjointed from the act of reading. Three verified gaps: (1) the reader has ZERO assignment awareness; (2) reading an assigned article to 100% does NOT advance the assignment (only a quiz or manual toggle completes it); (3) IN_PROGRESS is a dead state — nothing sets it from reading, so teachers can't distinguish "not started" from "in progress". This is a DESIGN-GATE decision; no feature code written here.

## Locked target process

### Teacher (unchanged flow, clearer board)
create classroom → enroll students → assign article (due date + instructions) → monitor a 3-state board **Not started / In progress / Completed** per assignment and per student, with inline due date + overdue → review quiz scores. Data for all 3 states ALREADY exists in `aggregateClassroom` (`perAssignment.notStarted/inProgress/completed`) and the drilldown rows carry per-student status; only the UI currently collapses it to binary.

### Student
see assigned reading (classroom, due, instructions, status) at /assignments → open it → the READER shows an assignment banner (classroom, due date, instructions, status, complete affordance) → the act of reading advances it automatically → may still manually mark/undo a MANUAL completion.

### State-transition rules (monotonic; mirror deriveCompletionState + Today)
- Absence of an AssignmentCompletion row == ASSIGNED.
- **ASSIGNED → IN_PROGRESS**: first reading-progress save at/above `ASSIGNMENT_START_PERCENT` (new constant, propose = 1 → "any real progress"). Creates an IN_PROGRESS row. Only when no row exists (never touches an existing COMPLETED/IN_PROGRESS row).
- **→ COMPLETED (reading-driven)**: reading reaches `COMPLETION_THRESHOLD` (95, reuse `@/lib/engagement/progress-rules`). Upserts COMPLETED, stamps `completedAt` (sticky — never overwrite an existing one), and **must NOT write quizScore** (preserve any existing quiz score).
- **→ COMPLETED (quiz-driven)**: unchanged `markAssignmentQuizComplete` — any GRADED attempt completes + records score. Quiz score wins over reading completion.
- **Precedence / no-regression (invariants):** automatic signals are strictly monotonic ASSIGNED(0) < IN_PROGRESS(1) < COMPLETED(2). A reading signal NEVER downgrades COMPLETED→IN_PROGRESS and NEVER clears/overwrites `quizScore`. Quiz completion is never regressed by reading. (Deliberately KEEP #1164 behavior that any graded attempt — pass or fail — completes; do not gate on pass, to avoid regressing that contract.)
- **Manual undo stays**, MANUAL (quizScore == null) completions only → posts IN_PROGRESS via existing route. Quiz-driven completions remain read-only. Manual "Mark complete" stays (offline/screen-reader path, mirrors markTodayReadingCompleteManual rationale).
- **Regression is only ever explicit** (student Undo). Teachers do not mutate student status.

### No schema change
`AssignmentStatus` enum + `AssignmentCompletion.status/quizScore/completedAt` already model the full lifecycle. ASSIGNED = no row; IN_PROGRESS/COMPLETED via existing columns. A `startedAt` timestamp is NOT needed (IN_PROGRESS presence + board counts suffice). Prefer-no-schema-change satisfied.

## PR breakdown (sequential, single shared working tree)

### PR1 — Backend/domain: reading→assignment lifecycle sync (owner: Tank)
Deep module mirroring `markAssignmentQuizComplete` + `syncTodayReadingFromProgress`.
- ADD `src/lib/classroom/completions.ts`: `syncAssignmentReadingProgress({ userId, articleId, percent, completed }): Promise<{ startedCount: number; completedCount: number }>`. Short-circuits (no query) when `percent < ASSIGNMENT_START_PERCENT && !completed`. Finds all `assignment.findMany({ where: { articleId, classroom: { archivedAt: null, members: { some: { userId } } } } })` (handles N enrolled classrooms), reads existing completions, then per assignment applies the monotonic rules above (never downgrade, never clobber quizScore, sticky completedAt). Non-tx independent upserts may use Promise.all.
- ADD `ASSIGNMENT_START_PERCENT` constant (in completions.ts or progress-rules.ts); reuse `COMPLETION_THRESHOLD`/`isCompletePercent`.
- ADD read query in `src/lib/classroom/student-reads.ts`: `listStudentAssignmentsForArticle(studentId, articleId): Promise<StudentAssignment[]>` — the viewer's own assignments for THIS article across enrolled, non-archived classrooms (for the reader banner). Reuse existing include/map helpers.
- EXPORT both from `src/lib/classroom/index.ts`.
- WIRE into `src/app/api/reader/[id]/progress/route.ts`: after `syncTodayReadingProgress`, add `await bestEffortMastery("progress.assignment_completion", () => syncAssignmentReadingProgress({ userId, articleId, percent: progress.percent, completed: progress.completed }))`. Best-effort; never breaks the progress write; never mutates ReadingProgress.
- TESTS (same PR): new `tests/classroom-assignment-reading-sync.test.ts` (model on `classroom-quiz-completion.test.ts`): ASSIGNED→IN_PROGRESS at start percent; →COMPLETED at threshold; multi-classroom N; monotonic no-downgrade; reading never clobbers a quizScore; archived-classroom excluded; not-enrolled excluded; sticky completedAt.
- api-catalog: NO route added/renamed and progress response unchanged → no `npm run api-catalog` needed.

### PR2 — Frontend/UI: reader banner + 3-state boards (owner: Trinity) [depends on PR1]
- Reader banner: extend `ReaderPageData` in `src/lib/reader/page-loader.ts` with `assignments: StudentAssignment[]` via `listStudentAssignmentsForArticle(session.user.id, articleId)` (empty when unassigned). Render a new banner in `ReaderShell.tsx`/`ArticleHeader.tsx` region: per enrolled classroom show classroom name, due date (+overdue), instructions, status chip, and complete affordance (reuse `CompleteAssignmentButton`). Token-driven; use `Card`/`Badge` primitives; no business-logic change.
- Student `/assignments` page: replace binary completed badge with 3-state chip (Not started / In progress / Completed[+quiz%]) driven by `assignment.status`.
- Teacher `src/app/(app)/teacher/classrooms/[id]/page.tsx`: replace binary `assignmentSynthesizedStatus` with a 3-segment count from existing `perAssignment.{notStarted,inProgress,completed}`; per-student rows use drilldown status; recompute overdue from due date + not-fully-complete.
- TESTS (same PR): extend `tests/assignment-edit-ui.test.ts`/`assignment-overdue.test.ts` + a reader-banner render test; light/dark/mobile + keyboard focus smoke per AGENTS.md UI checklist.

### PR3 — Test hardening / regression (owner: Switch) [depends on PR1+PR2]
- Integration/regression test walking the whole path: assign → sub-threshold read (IN_PROGRESS) → threshold read (COMPLETED) → quiz precedence (score wins, no regress) → manual Undo → re-read re-completes → archived guard (409) → session-derived identity (never body). Update any drift tests. Optional: fold into PR1/PR2 if the team prefers 2 PRs.

## Invariants & risks
- Security: studentId ALWAYS session-derived (route provides `session.user.id`); enrollment gate via `members.some`; archived-classroom guard (`archivedAt: null`); multi-classroom N handled everywhere.
- Redaction: only IDs + status/score metadata persisted or logged — never article text, selected text, instructions content in logs, or PII.
- No-regress-quiz-completion: reading sync never touches quizScore and never downgrades COMPLETED; quiz path unchanged.
- Prisma parity: no schema change, so no migration/3-schema/fixture work.
- api-catalog: plan adds no routes; if any PR adds/renames a route or changes a status code, it MUST run `npm run api-catalog` and commit `docs/platform/api-catalog.{json,md}`.
- Perf: sync fires on every progress save but short-circuits below start percent before any DB read; otherwise one findMany + bounded upserts, all best-effort.


### 2026-07-21: DB integration test strategy for reading→assignment lifecycle

**By:** Switch (🧪)

**What:** Created `tests/db/postgres-assignment-reading-sync.test.ts` — 9 PostgreSQL integration tests covering the full reading→assignment lifecycle. Tests are modeled exactly on the sibling `postgres-org-classroom.test.ts` (same imports, guard pattern, and `dbit_` PREFIX hygiene). All 9 tests fail with the benign guard message on SQLite and are verified via the `test:db` baseline (31 guard failures = 31 total failures, zero logic errors).

**Why:** Unit tests in `tests/classroom-assignment-reading-sync.test.ts` (PR1) mock Prisma and cannot prove the actual upsert target (`assignmentId_studentId`), enrollment `where` clause, archived-classroom exclusion filter (`archivedAt: null`), or multi-row fan-out work against a real schema. Integration tests are the only reliable gate for these DB-level invariants. Chosen `completed:true` as an explicit second code path for scenario (c) rather than merging it with the percent path, ensuring both branches of `isCompletePercent(percent) || completed` are covered in isolation.


### 2026-07-22T10:45:14+0000: Assignment review v2 (Wave 2) complete — all 6 gaps closed via PRs #1276–#1281
**By:** coordinator
**What:** Assignment review v2 (Wave 2) complete — all 6 gaps closed via PRs #1276–#1281
**Why:** Second-wave complete review of the assignment system (Lead: Morpheus) found 11 gaps → validated → triaged into 6 issues/PRs, all now merged to main:

- W2-1 (P1) #1276 b8063e0e — [core gap]
- W2-2 (P1) #1277 d06e81a2 — [core gap]
- W2-3 (P1) #1278 e03f4136 — edit-time targeting + clear fields + audience visibility
- W2-4 (P1) #1279 bbb3078a — grading: pointsAwarded + student sees title/points/score (+4 rubber-duck fixes: content-safe audit, GDPR export, points-below-awarded 409 guard, overflow cap)
- W2-5 (P2) #1280 17644eb1 — bulk assign per-student targeting
- W2-6 (P2) #1281 82605f88 — draft/scheduled publish lifecycle (AssignmentPublishState enum + publishAt; assignmentLiveWhere AND-composed at all student reads; +6 rubber-duck fixes: nudge-path push leak gated, bulk schedule up-front 400 validation, global teacher list lifecycle badges + overdue suppression, 3 stale tests fixed, publishAt-only PATCH 400 guard, server-tz badge note)

Process notes for future waves:
- Rubber-duck caught real regressions BOTH large PRs (#1279, #1281) missed — notably 3 tests that passed in the aggregate run but FAILED in isolation (mock-leak / stale where.OR assertions). Always re-run touched test files INDIVIDUALLY, not just the aggregate.
- OR-clobbering trap: assignmentVisibleToStudentWhere and assignmentLiveWhere both return {OR}; must compose via AND:[...], never spread as sibling keys.
- CI "Unit tests + native coverage" baseline nondeterministic ~111 fails (flaky DB-route 500s); the separate DB-free "test" gate + PostgreSQL Migrate/Integration are the real signals for schema-change PRs.
- Test runner summary format is `ℹ pass N` / `ℹ fail N` (spec reporter), not `# pass`.
