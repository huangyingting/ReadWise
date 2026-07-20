---
type: "design"
status: "current"
last_updated: "2026-07-19"
description: "Design for stateful incremental provider ingestion: the governing invariant, the durable discovery ledger data model (DiscoverySource, CrawlCandidate, UrlAlias, DiscoveryObservation, CanonicalConflict), its enums, uniqueness constraints, cascade/retention decisions, versioned URL normalization / public article identity (Phase 1.2), and the idempotent baseline seed / conflict isolation from existing public Articles (Phase 1.3), the SSRF-safe discovery fetch seam exposing response metadata / conditional requests / typed outcomes (Phase 1.4), and the atomic paged discovery commit + candidate classification (Phase 1.5). Later phases are stubbed."
---

# Incremental provider scraping design

This document records the agreed design for **stateful incremental provider
ingestion** (program epic #1077). It replaces stateless provider rescans with a
durable, source-aware model that discovers and saves genuinely new public
articles without automatically refreshing known ones. It complements the current
scraper reference in [`scrapers.md`](./scrapers.md) and the source governance in
[`content-policy.md`](./content-policy.md).

The document is filled in phase by phase as implementation lands. The data model
(#1081), URL normalization / public article identity (Phase 1.2, #1082), the
baseline seed / conflict isolation (Phase 1.3, #1083), the discovery fetch
seam (Phase 1.4, #1084), the atomic paged commit + classification
(Phase 1.5, #1085), the watermark / overlap / calibration / gap frontier
(Phase 1.6, #1086), leased discovery-source scheduling (Phase 1.7, #1087), and
the baseline & strict shadow lifecycle (Phase 1.8, #1088) are **current** below;
later phases are **planned** stubs.

## Program overview

Provider *extraction* and *admission* logic stays versioned in code
(`src/lib/scraper/*`). Only *operational* state — schedule, lease, watermark,
budgets, health — and a *permanent candidate/alias ledger* live in the database.
The ledger is the authority for whether a public provider identity has ever been
handled, so ingestion can be resumed, replayed, and run concurrently while
converging through database uniqueness.

### Governing invariant (#1077)

> Normal incremental ingestion processes only article identities **first
> observed after a completed source baseline**. It must never automatically
> refetch, update, recreate, or revive a known public Article.

The data model makes this invariant enforceable: candidate identity is
**permanent and deletion-safe**. Deleting the produced `Article` nulls the
back-reference but never deletes or resets the `CrawlCandidate`, so a URL that
was already handled can never be silently re-ingested as if it were new.

## Data model (Phase 1) — current

Five new models form the discovery ledger. All are **metadata only**: no article
text, credentials, cookies, tokens, signed URLs, prompts, translations, or
user-private content is stored. Identity keys (`provisionalKey`, `canonicalKey`,
`aliasKey`, `observationKey`, `watermarkKey`, `checkpointCursor`) are versioned,
**sanitized** digests of a URL identity — never the raw, secret-bearing URL.

`providerKey` follows the existing `ContentSource` / `CrawlRun` convention: a
plain string that references the code provider-registry key, **not** a foreign
key. The ledger is therefore independent of `ContentSource` row lifecycle and
lives alongside (does not replace) `ContentSource` and `CrawlRun`.

### Orthogonal controlled fields

Source `role`, `lifecycleMode`, `automationPolicy`, and `health` are **separate
enums / columns**, never one overloaded status column. On a candidate,
`status` (lifecycle) and `observedInBaseline` (baseline membership) are likewise
independent.

### `DiscoverySource`

Durable per-source scheduling / lease / watermark record. One row per
`(providerKey, sourceKey, definitionVersion)`; bumping the code-defined
`definitionVersion` starts a fresh, independently-baselined source without
disturbing prior history.

Field groups:

- **Identity / definition** — `providerKey`, `sourceKey`, `definitionVersion`.
- **Role** — `role` (`DiscoverySourceRole`).
- **Lifecycle mode** — `lifecycleMode` (`DiscoverySourceLifecycleMode`).
- **Automation policy** — `automationPolicy` (`DiscoveryAutomationPolicy`).
- **Health** — `health` (`DiscoverySourceHealth`).
- **Schedule** — `scheduleCron`, `pollIntervalSeconds`, `nextRunAt`, `lastRunAt`.
- **Lease** — `leaseOwner` (opaque worker token, never a secret),
  `leaseAcquiredAt`, `leaseExpiresAt`.
- **Checkpoint** — `checkpointCursor` (opaque sanitized pagination token),
  `checkpointPage`.
- **Watermark** — `watermarkAt` (the "first observed after baseline" frontier),
  `watermarkKey`.
- **Validator** — `validatorVersion` (fingerprint of the admission validator in
  code).
- **Baseline** — `baselineStartedAt`, `baselineCompletedAt`,
  `baselineObservedCount`.
- **Activation** — `activatedAt`.
- **Backoff** — `backoffUntil`, `backoffLevel`, `consecutiveFailures`.
- **Budgets** — `discoveryBudgetPerRun`, `bodyFetchBudgetPerRun`,
  `backfillBudgetPerRun` (separate budgets per work class).
- **Gap** — `gapState` (`DiscoveryGapState`), `gapDetectedAt`, `gapNote`.
- **Bookkeeping** — `lastError`, `createdAt`, `updatedAt`.

Uniqueness: `@@unique(providerKey, sourceKey, definitionVersion)`.

### `CrawlCandidate`

The permanent public-ingestion identity for a provider URL — the ledger
authority for whether an identity has ever been handled.

- **Ownership** — `providerKey`, `discoverySourceId?` (FK, `SetNull`).
- **Versioned sanitized identity** — `identityVersion`, `provisionalKey`,
  `canonicalKey?`.
- **Lifecycle status** — `status` (`CrawlCandidateStatus`).
- **Baseline membership (orthogonal)** — `observedInBaseline`.
- **Observation window** — `firstObservedAt`, `lastObservedAt`,
  `observationCount`.
- **Processing version** — `processingVersion`.
- **Trusted date provenance** — `trustedPublishedAt`, `dateProvenance`
  (`CandidateDateProvenance`).
- **Terminal / deletion-safe history** — `terminalReason`, `terminalAt`,
  `ingestedAt`, `articleDeletedAt`.
- **Article linkage** — `articleId?` (FK, nullable, **`onDelete: SetNull`**).

Uniqueness:

- Provisional identity — `@@unique(providerKey, identityVersion, provisionalKey)`.
- Final public canonical identity — `@@unique(providerKey, canonicalKey)`. The
  nullable `canonicalKey` means many not-yet-canonicalized candidates coexist
  (multiple NULLs are distinct on both engines), while at most one candidate can
  ever own a given final canonical identity per provider.

### `UrlAlias`

Alternate sanitized identity keys (redirects, canonical links, duplicates,
mirrors) mapped onto a candidate.

- `candidateId` (FK, `Cascade`), `providerKey`, `identityVersion`, `aliasKey`,
  `kind` (`UrlAliasKind`), `firstSeenAt`, `lastSeenAt`.
- Uniqueness: `@@unique(providerKey, identityVersion, aliasKey)`.

### `DiscoveryObservation`

Idempotent record of a source seeing a candidate identity during a run.

- `discoverySourceId` (FK, `Cascade`), `candidateId?` (FK, `Cascade`),
  `runId?` (sanitized plain-string reference to a `CrawlRun`; **not** an FK, so
  run summaries can be pruned independently), `identityVersion`,
  `observationKey`, `observedCanonicalKey?`, `positionRank?`, `httpStatus?`,
  `observedAt`.
- Uniqueness (idempotency): `@@unique(discoverySourceId, observationKey)`.

### `CanonicalConflict`

Unresolved conflict where more than one provisional identity resolves to the
same final canonical identity. Surfaces uncertainty for operator review rather
than silently picking a winner.

- `providerKey`, `identityVersion`, `canonicalKey`, `challengerKey` (sanitized
  provisional key of the challenger), `incumbentCandidateId?` (FK, `SetNull`),
  `status` (`CanonicalConflictStatus`), `reason?`, `detectedAt`, `resolvedAt?`,
  `resolvedBy?`.
- Uniqueness: `@@unique(providerKey, identityVersion, canonicalKey)`.

### Enums (allowed values)

| Enum | Values |
|------|--------|
| `DiscoverySourceRole` | `PRIMARY_FEED`, `SECTION_INDEX`, `ARCHIVE_INDEX`, `SITEMAP`, `SUPPLEMENTAL` |
| `DiscoverySourceLifecycleMode` | `DISABLED`, `SHADOW`, `BASELINE`, `ACTIVE`, `PAUSED`, `RETIRED` |
| `DiscoveryAutomationPolicy` | `MANUAL`, `SCHEDULED`, `CONTINUOUS` |
| `DiscoverySourceHealth` | `UNKNOWN`, `HEALTHY`, `DEGRADED`, `FAILING`, `BLOCKED` |
| `DiscoveryGapState` | `NONE`, `SUSPECTED`, `DETECTED` |
| `CrawlCandidateStatus` | `DISCOVERED`, `BASELINE`, `QUEUED`, `INGESTING`, `INGESTED`, `SKIPPED`, `REJECTED`, `FAILED`, `CONFLICT` |
| `CandidateDateProvenance` | `UNKNOWN`, `FEED`, `PAGE_METADATA`, `URL`, `HTTP_HEADER`, `INFERRED` |
| `UrlAliasKind` | `PROVISIONAL`, `REDIRECT`, `CANONICAL`, `DUPLICATE`, `MIRROR` |
| `CanonicalConflictStatus` | `OPEN`, `RESOLVED`, `DISMISSED` |

### Cascade & retention decisions

| Relationship | `onDelete` | Rationale |
|--------------|-----------|-----------|
| `CrawlCandidate.articleId → Article` | **SetNull** | Governing invariant: candidate identity must survive Article deletion so a known URL is never auto-reingested. `articleDeletedAt` preserves history. |
| `CrawlCandidate.discoverySourceId → DiscoverySource` | **SetNull** | Candidate identity is permanent; it must outlive a retired/replaced source. |
| `UrlAlias.candidateId → CrawlCandidate` | **Cascade** | Aliases belong to a candidate. Candidates are permanent (never deleted in normal operation), so aliases survive Article deletion by construction. |
| `DiscoveryObservation.discoverySourceId → DiscoverySource` | **Cascade** | Source-run observations are ephemeral and **may expire** with their source. |
| `DiscoveryObservation.candidateId → CrawlCandidate` | **Cascade** | Observation rows are run-scoped bookkeeping, not identity. |
| `CanonicalConflict.incumbentCandidateId → CrawlCandidate` | **SetNull** | Conflicts must survive so the resolution record persists even if a candidate is removed. |

Summary: **candidate identity, aliases, conflicts, terminal outcomes, and
deletion history survive Article deletion**; only source-run observations expire
with their source or candidate.

## Phase 1.2 — URL normalization & public article identity — current

Issue #1082 lands the single deterministic module that turns a secret-free
provider URL into (1) a readable **normalized URL** and (2) a fixed-size,
**versioned identity key** used for the ledger's identity columns
(`provisionalKey`, `canonicalKey`, `aliasKey`, …). It is implemented in
[`src/lib/scraper/url-identity.ts`](../../src/lib/scraper/url-identity.ts) and is
distinct from `normalize.ts` (which normalizes article *HTML*).

### Purity contract

The module is **pure and deterministic**: no network fetch (it never loads a
page to discover a canonical link), no database access, and no
candidate-lifecycle decisions. It maps *URL → identity* and nothing else. All
lifecycle and admission logic stays in the discovery/ingestion layers.

### Shared normalization rules

Applied to every URL, regardless of provider:

- Lowercase the scheme and hostname; Unicode hosts are folded to their punycode
  form (`münchen.example` ≡ `xn--mnchen-3ya.example`) by the URL parser.
- Remove the fragment (`#…`) and default ports (`:80` for http, `:443` for https).
- Remove **only centrally approved tracking parameters** — an explicit
  allowlist-to-strip: the `utm_*` / `pk_*` / `piwik_*` / `hsa_*` prefixes plus
  named click IDs (`fbclid`, `gclid`, `gclsrc`, `dclid`, `gbraid`, `wbraid`,
  `msclkid`, `yclid`, `twclid`, `ttclid`, `igshid`, `mc_cid`, `mc_eid`,
  `mkt_tok`, `_hsenc`, `_hsmi`, and similar). Unknown parameters are **never**
  stripped merely because they look inconvenient.
- Surviving query parameters (including duplicates) are sorted by `(name, value)`
  for a stable key, so parameter order never changes identity.

### Provider-owned rules

Each provider may add declarative, **data-only** rules via the optional
`urlIdentity?: ProviderUrlIdentityPolicy` field on `Provider` (same additive
pattern as `cleanup` / `declutter` — omitting it leaves behavior at the shared
default):

- `meaningfulParams` — query params that carry identity meaning. When set, only
  those are kept (empty array = drop all query params); otherwise every
  non-tracking, non-credential param is preserved. Dropping other params is a
  provider-owned decision that must be proven by tests never to merge distinct
  content.
- `trailingSlash` — `"preserve"` (default), `"strip"`, or `"add"`.
- `amp` — fold AMP/mobile host and path variants (`hosts`, `pathPrefixes`,
  `pathSuffixes`) onto the canonical form.
- `hostnameAliases` + `canonicalHost` — fold owned host variants (e.g.
  `bbc.com` → `www.bbc.com`) to one canonical host.
- `associatedDomains` — different domains this provider explicitly owns for
  canonical-ownership acceptance (see below).

Representative wiring proves real behavior: **natgeo** declares
`meaningfulParams: []` (its discovery already discards the query string);
**bbcfeatures** folds `bbc.com → www.bbc.com`, strips trailing slashes, and lists
`bbc.co.uk` as an associated domain; **theconversation** folds the `www` alias
and an `…/amp` suffix.

### Security & redaction guarantees

Credential material is removed **before** any URL-derived value is returned,
persisted, logged, or included in a thrown error:

- Userinfo (`user:pass@host`) and the fragment are stripped at the parse
  boundary.
- Credential/signature query params are always dropped — the `x-amz-*` /
  `x-goog-*` / `x-ms-*` presign families plus names/substrings such as
  `token`, `access_token`, `sig`, `signature`, `hmac`, `apikey`, `api_key`,
  `password`, `secret`, `sessionid`, `jwt`, `bearer`, `expires`. Two signed URLs
  for the same resource therefore collapse to one identity.
- Only `http(s)` schemes are accepted; other schemes are rejected.
- Thrown errors and the exported `redactUrlForLog(url)` helper never echo
  userinfo, the query string, or the fragment. An unparseable input is rendered
  as `[unparseable-url]` rather than echoed verbatim.

### Provisional vs. canonical operations

Two separate operations expose the discovered-vs-trusted distinction:

- `deriveProvisionalIdentity(rawUrl)` — the **discovered/provisional** identity.
  Permissive: it normalizes with the owning provider's rules when one is
  registered for the host, otherwise applies only the shared rules, and never
  rejects an unknown-provider URL.
- `deriveCanonicalIdentity(canonicalUrl, { owningProviderKey })` — the **trusted
  final canonical** identity. Canonical ownership is accepted **only** when the
  host belongs to the same owning provider, to a **separately registered
  provider** (which reruns its own admission downstream), or to one of the owning
  provider's **explicitly associated domains** (host preserved, not rewritten).
  Any other cross-domain canonical is rejected (`unknown-cross-domain-canonical`)
  so a page cannot claim an unrelated domain's identity.

### Identity-key format & version-bump procedure

The identity key is `<identityVersion>:<sha256hex>` — for `v1`, the literal
`v1:` followed by the 64-char lowercase SHA-256 hex of the normalized URL (67
chars total). It is fixed-size and non-null, suitable for the ledger's unique
constraints, and the version prefix guarantees keys from different normalization
behaviors never collide.

`URL_IDENTITY_VERSION` (currently `"v1"`) is the single source of truth. **Any**
change to normalization behavior — the tracking allowlist, credential detection,
provider-rule handling, the hash, or the key shape — is a breaking change and
**requires bumping the version tag**. The migration strategy on a bump:

1. Bump `URL_IDENTITY_VERSION` to `v2` in the same change that alters behavior.
2. Recompute keys for existing candidates/aliases under the new version and
   backfill the ledger's `identityVersion`-scoped columns (a dedicated migration
   job, deferred to the ingestion phases — this pure module does not migrate
   data). The ledger's `@@unique(providerKey, identityVersion, …)` constraints
   let `v1` and `v2` identities coexist during the transition.
3. Never mutate `v1` keys in place; old keys remain valid for historical rows.

## Phase 1.3 — baseline seed & conflict isolation — current

Phase 1.3 (#1083) initializes the discovery ledger from the Articles that
**already exist** in the library, so the very first incremental run starts from a
truthful "everything already known" baseline instead of an empty ledger. It is a
pure backfill: **no network fetch, no scraper fetch dependency, and no merging of
historical data**. Core logic lives in
`src/lib/scraper/incremental/baseline-backfill.ts`
(`backfillDiscoveryBaseline` + the pure `classifyBaselineArticles`); the CLI
wrapper is `scripts/backfill-discovery-baseline.ts`
(`npm run backfill:discovery-baseline [-- --dry-run]`).

### Selection predicate

An Article is eligible when it is a **public provider** article:
`visibility = PUBLIC` **and** `ownerId = null` **and** `sourceType = SCRAPED`.
Private/user imports (`ownerId != null` or `visibility = PRIVATE`) are excluded by
construction, so a private copy sharing a `sourceUrl` never occupies the public
identity nor blocks a public provider Article — `Article @@unique([sourceUrl,
ownerId])` keeps the two rows distinct. A **null `sourceUrl`** is intentionally
*not* filtered in SQL: it is surfaced as a reported skip (`missing-source-url`)
rather than silently hidden.

### Identity mapping (#1082 string tag → #1081 columns)

The #1082 module emits a string version tag (`"v1"`) and a combined key
(`"v1:<sha256hex>"`). Phase 1.3 maps these onto the #1081 ledger columns with a
single consistent rule applied **everywhere** (candidate, alias, conflict):

- `identityVersion` (Int) = numeric parse of the tag: `"v1"` → `1`.
- `provisionalKey` / `aliasKey` / `canonicalKey` / `challengerKey` (String) = the
  **full** versioned key (`"v1:<sha256hex>"`), never the bare hash and never a raw
  URL. The full key is the module's public identity token and stays collision-safe
  across versions.

`deriveProvisionalIdentity` is used (never `deriveCanonicalIdentity`): no new page
canonical is inferred and the network is never touched. An Article whose URL is
unparseable, non-http(s), or owned by **no registered provider** is skipped and
reported (`invalid-url`, `unsupported-scheme`, `no-registered-provider`) — a
candidate's `providerKey` is NOT NULL and is never fabricated.

### Conflict detection & isolation

Eligible Articles are grouped by `(providerKey, identityVersion, provisionalKey)`
**before** any identity value is enforced:

- **Unique group (exactly one Article):** one `CrawlCandidate` is created with
  `observedInBaseline = true`, `articleId` set, `status = INGESTED` plus
  `ingestedAt`/`terminalAt` and `terminalReason = "baseline-existing-article"`,
  and `canonicalKey` left null (no canonical inferred). `INGESTED` is the truthful
  terminal outcome: the public article's body is already ingested and published.
  One PROVISIONAL `UrlAlias` is created for the same key.
  `firstObservedAt`/`lastObservedAt` are set to the Article's
  `publishedAt ?? createdAt` to preserve temporal ordering.
- **Conflict group (two or more Articles → one identity):** exactly one
  `CanonicalConflict` is written (`status = OPEN`,
  `reason = "baseline-duplicate-provisional-identity"`, `canonicalKey =
  challengerKey =` the contested key) and **no candidates** are created for those
  Articles — their public keys are left unset and the identity **fails closed**.
  Unrelated identities and providers continue to seed normally.

### Governing-invariant guarantee

Every backfilled candidate carries `observedInBaseline = true`. This is the flag
normal incremental ingestion checks to guarantee it **never auto-refetches,
updates, recreates, or revives a known public Article**: a pre-existing identity
is a baseline member, not a newly discovered one.

### Idempotency, resumability & dry-run

Writes are keyed on the #1081 unique constraints
(`@@unique([providerKey, identityVersion, provisionalKey])` for candidates,
`([providerKey, identityVersion, aliasKey])` for aliases,
`([providerKey, identityVersion, canonicalKey])` for conflicts) via
existence-check-then-create with a `P2002` tolerance, so a rerun converges to
**identical final counts** with no duplicate rows and an interrupted run resumed
mid-way never double-writes. `--dry-run` performs **zero writes** and pulls in
only the pure identity module (no fetch dependency).

The report is **metadata only**: Article IDs, the controlled conflict reason, and
counts — never article content, titles, URLs, or user-private data.

## Phase 1.4 — discovery fetch seam — current

Phase 1.4 (#1084) lets discovery adapters read HTTP **response metadata** —
status, final URL, validators, and retry hints — without weakening or forking the
existing SSRF-safe fetch. It adds a response-returning function alongside the
body-only extractor path; both are built on ONE shared safe hop loop.

### Shared safe hop loop (no SSRF fork)

`src/lib/scraper/fetch.ts` now factors the SSRF/redirect machinery into a single
internal `performSafeFetch(url, init, timeoutMs, consume)`. It owns, exactly once,
every safety guarantee and both public paths reuse it verbatim:

- `resolveAndPin` validates + IP-pins **every hop** (initial URL and each redirect
  target) before a byte is sent — closing the DNS-rebinding / TOCTOU gap.
- Redirects are followed **manually** and bounded by `MAX_REDIRECTS` (5).
- A single `AbortController` enforces the hard timeout across all hops.
- The pinned undici dispatcher is always closed; redirect bodies are cancelled.
- Body size is capped by `readBodyWithLimit` (Content-Length pre-check + streaming
  byte count + gzip-bomb guard) against `scraperMaxBytes`.

`performSafeFetch` stops the loop WITHOUT consuming a response for a SSRF-rejected
hop or an exceeded redirect budget, returning a typed stop marker. The two public
functions then translate that marker into their own contract:

- `fetchCore` / `fetchHtml` / `fetchText` — **unchanged public behavior**: still
  return the bounded body and still **throw** `FetchHttpError` on non-2xx and an
  `Error` on blocked/too-many-redirects. `ExtractorFetch` is untouched.
- `fetchDiscoveryResponse` — the new response-metadata path (see below).

### `fetchDiscoveryResponse` interface (as built)

```ts
fetchDiscoveryResponse(url, init?: DiscoveryFetchInit, timeoutMs?): Promise<DiscoveryFetchResult>
```

`DiscoveryFetchInit` extends the core init with typed conditional-request
conveniences `ifNoneMatch` / `ifModifiedSince` (mapped to `If-None-Match` /
`If-Modified-Since` request headers). It issues a **single validated origin
request per hop** and deliberately does **NOT** run the bot-challenge strategy
rotation (`fetch-strategies.ts`) — that browser/reader/Wayback fallback is
reserved for article-body GETs via `fetchHtml`, whose behavior is unchanged.

### Typed outcomes (never thrown for HTTP-level results)

`DiscoveryFetchResult` is a discriminated union on `outcome` so callers branch on
data, not on caught errors:

| `outcome`        | When                     | Fields |
| ---------------- | ------------------------ | ------ |
| `ok`             | `200–299`                | `status`, `finalUrl`, bounded `body`, `validators` (`etag`, `lastModified`), `headers` (allowlist) |
| `not-modified`   | `304`                    | `status: 304`, `finalUrl`, `notModified: true`, `validators` — **no body** |
| `retryable`      | `429` / `5xx`            | `status`, `finalUrl`, parsed `retryAfterMs?` |
| `error`          | other non-2xx (e.g. 404) | `status`, `finalUrl` |
| `blocked`        | SSRF-rejected hop / redirect budget | `reason: "unsafe-address" \| "too-many-redirects"` — **no URL** |

The response-header surface is a MINIMAL allowlist: only `Content-Type`
(`headers.contentType`) plus the `ETag` / `Last-Modified` validators and the
`Retry-After` hint. Arbitrary headers (cookies, auth echoes, vendor headers) are
never exposed to feature code.

### Redaction & privacy guarantees

- URL redaction is centralized in the dependency-free
  `src/lib/scraper/url-redaction.ts` (`redactUrlForLog`, re-exported by
  `url-identity.ts` to preserve #1082's surface). The fetch layer imports it from
  there so the SSRF path never transitively pulls in the provider registry.
- Any URL that reaches a log passes through `redactUrlForLog` (userinfo, full
  query string, and fragment stripped).
- `blocked` outcomes intentionally omit the target URL, and the SSRF rejection
  error's raw message (which may embed a private address) is never surfaced —
  only the redacted **request** URL and the hop index are logged.
- No authorization headers, cookies, signed URLs, request bodies, or response
  bodies for non-200 outcomes are ever logged or returned.

### Dependency injection

The discovery DI seam mirrors `DiscoverDeps.fetchHtml`: `DiscoverDeps.fetchResponse`
defaults to `fetchDiscoveryResponse` and is passed to `urlExtractor` via the new
optional `UrlExtractorContext.fetchResponse`, so RSS/API/sitemap/HTML discovery
tests stay network-free by injecting a canned `DiscoveryFetchResult`.

## Phase 1.5 — atomic page commit & classification — current

Phase 1.5 (#1085) makes one bounded discovery **page** replay-safe: every item is
durably classified BEFORE the source's continuation checkpoint can advance. The
orchestration lives under `src/lib/scraper/incremental/` (`classify.ts` for the
PURE classifier, `page-commit.ts` for the single-transaction commit). Routes,
scripts, and workers call `commitDiscoveryPage` and MUST NOT re-implement the
admission/classification rules.

### Page-oriented adapter result (as built)

`DiscoveryPageResult` (built on the Phase 1.4 `DiscoveredUrl` shape) is the unit
committed atomically:

- `items: DiscoveryPageItem[]` — each item carries the discovered `url`, an
  optional adapter-provided `stableId`, a controlled `publishedAt` +
  `dateProvenance` (`CandidateDateProvenance`), and optional `positionRank` /
  `httpStatus`. `pageItemFromDiscoveredUrl` maps a `DiscoveredUrl` to an item with
  a channel-derived default provenance (rss/api→`FEED`, sitemap→`PAGE_METADATA`,
  else `URL`).
- `continuation: { cursor?, page? } | null` — the sanitized checkpoint to persist
  after the page fully commits (`null` leaves the checkpoint unchanged).
- `boundaryReached: boolean` — whether the configured discovery boundary was hit.
- `validators?: { etag?, lastModified?, validatorVersion? }` — validator updates;
  `validatorVersion` is persisted to `DiscoverySource.validatorVersion`.

### Classification outcomes (pure, no article-body fetch)

`classifyPage` normalizes each URL via `deriveProvisionalIdentity` (#1082),
resolves the owning provider from the identity hostname (`providerForUrl`),
applies the same versioned provider admission gate as discovery
(`articleUrlPattern` + `articleUrlFilter`), and assigns EXACTLY ONE outcome. The
identity mapping is kept consistent with the Phase 1.3 baseline seed
(`identityVersionToInt`, full `"v1:<sha256hex>"` key as `provisionalKey`):

- **`policy-rejected`** — unparseable / unsupported-scheme URL, no registered
  provider, or admission-pattern/filter miss. Observation-only (no candidate);
  rejections stay re-evaluable on an admission-version bump.
- **`existing-identity`** — the identity is already in the ledger. Re-observed and
  its `lastObservedAt` touched, but `status`/`observedInBaseline`/`articleId` are
  NEVER changed (governing invariant: a known identity is never revived or
  re-ingested). Takes precedence over mode/window logic in every mode.
- **`baseline-shadow`** — any non-`ACTIVE` source (BASELINE/SHADOW/…): a new
  identity is recorded as a candidate with `status = BASELINE`,
  `observedInBaseline = true`, and NO Article/body fetch/ingest job.
- **`outside-window`** — ACTIVE source, admitted, dated at/before the frontier
  window (`watermarkAt ?? baselineCompletedAt`, exclusive). Observation-only.
- **`review-required`** — ACTIVE source, admitted, but undated (no trusted date
  and provenance). Observation-only; held for later dating/review.
- **`eligible`** — ACTIVE source, admitted, dated, first observed AFTER the
  frontier: a new active candidate (`status = DISCOVERED`,
  `observedInBaseline = false`, trusted date + provenance recorded).

Every item — regardless of outcome — is represented by exactly one idempotent
`DiscoveryObservation`. Its `observationKey` is the versioned identity key when
derivable, otherwise a one-way digest of the stable ID / URL (`id:…` / `url:…`,
never the raw URL).

### Single-transaction ordering

`commitDiscoveryPage` performs ALL classification reads (source snapshot, known
identity keys) BEFORE opening the transaction, then inside ONE interactive
`prisma.$transaction`:

1. **Re-read + revalidate the lease/version** — confirm `leaseOwner` still matches
   the caller's token AND `definitionVersion` matches; abort (roll back, no
   writes) otherwise. (A cheaper identical pre-check also runs before the tx.)
2. **Upsert candidates** (eligible/baseline-shadow) and **touch** existing ones.
3. **Upsert the provisional `UrlAlias`** for each candidate-bearing item.
4. **Upsert one observation per item** (the universal durable outcome record).
5. **Advance the checkpoint** via a guarded conditional `updateMany` scoped to
   `{ id, leaseOwner, definitionVersion }` — a zero-row result means the lease was
   stolen mid-commit, which throws and rolls the WHOLE page back.

Because the checkpoint advances only after every write in the same transaction, a
fault after any write boundary rolls back atomically and the checkpoint never
advances with a missing candidate/observation outcome.

### Idempotent-race handling (cross-engine)

Candidate/alias/observation writes use `upsert` (INSERT … ON CONFLICT), never a
catch-`P2002`-inside-the-transaction (which would poison a PostgreSQL
transaction). Two concurrent commits of the same page therefore converge on ONE
candidate/alias/observation set and one checkpoint; a uniqueness race is resolved
by the DB winner and NEVER drops an item. Replaying the same page produces no
extra candidate, alias, observation, or (Phase-2) ingest job.

### Network-outside-transaction rule

The page is fetched via the Phase 1.4 `fetchDiscoveryResponse` seam by the caller
BEFORE `commitDiscoveryPage` is invoked; only DB writes and lease revalidation run
inside the transaction. Baseline/shadow commits create NO Article, NO body fetch,
and NO `ARTICLE_INGEST` job — enqueuing ingest work is Phase 2 (#1091).

## Phase 1.6 — watermarks, overlap, validator calibration, and gap detection (#1086)

Phase 1.6 BOUNDS repeated discovery WITHOUT ever treating a timestamp or an HTTP
validator as proof that no provider article was missed. All frontier DECISIONS
live in a PURE module (`src/lib/scraper/incremental/frontier.ts`, no DB / no
network); a thin guarded persistence layer
(`src/lib/scraper/incremental/frontier-commit.ts`) applies them to
`DiscoverySource`. Provider-specific tuning is DATA-ONLY on
`Provider.discovery` (`nativeCursor`, `watermark`, `overlap`); omitting it leaves
the shared safe defaults unchanged.

### Compound watermark advance (`computeNextWatermark`)

The frontier is the compound boundary `(watermarkAt, watermarkKey)` — a
publication instant plus a sanitized identity/stable-item key that breaks
same-timestamp ties. `classifyPage` now accepts an optional `windowKey`: an item
dated exactly at `watermarkAt` is `outside-window` only when its identity key is
at or before `watermarkKey`, so a same-timestamp item with a greater key stays
in-window and is never silently skipped. Without `windowKey` the window remains
the pure `<= windowStart` timestamp bound (unchanged #1085 behavior).

The next watermark is the maximum surviving compound `(at, key)`, subject to:

- **Provenance gating** — only `FEED` (provider RSS/API publication fields) and
  `PAGE_METADATA` (approved structured page fields) advance it by default.
  Sitemap `lastmod`, URL-inferred (`URL`), `HTTP_HEADER`, `INFERRED`, and undated
  (`UNKNOWN`) observations are `ineligible` and never advance the watermark.
- **Future-date rejection** — a date more than `clockToleranceMs` (default 5 min)
  ahead of now is an anomaly (`futureRejected`); it never advances the watermark.
- **Conflict by precedence** — two differing trusted dates for one identity are
  resolved by configured source precedence (`sourceRank`, higher wins); an
  UNRESOLVED conflict (equal/absent ranks) stays an anomaly (`conflicts`) and
  contributes no date.
- **Never regress** — a lower/equal computed watermark keeps the proven one, so a
  delayed OLD entry can never rewind the frontier.
- **Never leapfrog a gap** — observations at or after an optional `blockedAbove`
  bound are held back so a detected gap is not silently jumped.

Because the window is measured from the watermark (not wall-clock), a ten-day
outage still accepts every observable identity published after the last proven
watermark on recovery.

### Overlap and pagination termination (`decidePagination`, `overlapWindowStart`)

A provider-native cursor is authoritative: pagination continues until the cursor
is exhausted or the boundary is explicitly reached. For non-cursor pagination the
run stops as CAUGHT-UP only after the configured number of CONSECUTIVE all-known
pages (`overlap.consecutiveEmptyPages`, default 2); a single known URL or one old
date (one empty page, or any new identity on the page) is INSUFFICIENT to stop.
`overlapWindowStart` shifts the classify window DOWN from the watermark by the
configured overlap depth (`overlap.overlapSize`, default 25) so the most-recent
identities are always re-scanned — known ones dedup, genuinely new delayed /
out-of-order entries within the overlap are admitted — never moving the window
forward past the proven watermark.

### Gap detection (`detectGap`)

Comparing the oldest still-observable item against the proven boundary
(`watermarkAt ?? baselineCompletedAt`): when the feed has ROLLED past the
boundary (oldest visible item is newer than it), the intervening span is no
longer discoverable → `gapState = DETECTED` with a redacted, metadata-only
manual-backfill suggestion note. Entering a gap stamps `gapDetectedAt` once;
clearing to `NONE` resets it. A gap NEVER blocks recording current confirmable
candidates and NEVER triggers a historical body fetch or automatic backfill. An
unknown oldest item on a run that did not reach the boundary is at most
`SUSPECTED` — a failed/partial read is never treated as proof of completeness.

### Validator calibration (`calibrateValidator`)

ETag/Last-Modified `304` responses are request OPTIMIZATIONS only. A periodic
UNCONDITIONAL calibration scan over the same overlap validates them: when the
conditional path reported `304` "not modified" but the unconditional scan
surfaces new identities, the validator is proven stale/misleading →
`disableValidator` + `alert`, and `frontier-commit` clears `validatorVersion` so
a bad long-lived `304` can never permanently suppress discovery. An incomplete
calibration proves nothing and never disables a validator.

### Run-completion accounting (`decideRunCompletion`)

A source is CAUGHT UP (health advanced to `HEALTHY`) only when the run BOTH
reached the observable boundary AND processed every planned page without a
failure. A failed or partial page can never mark the source caught up.

### Guarded persistence (`commitFrontierState`)

Reads happen before the transaction; the single `$transaction` re-reads and
revalidates the lease/`definitionVersion` and advances state via a guarded
`updateMany({ where: { id, leaseOwner, definitionVersion } })`. A zero-row update
means the lease was lost/stolen → the whole write rolls back and nothing is
persisted (the same keystone pattern as `commitDiscoveryPage`). The watermark
never regresses even here (a belt-and-braces same-timestamp/older-date guard).

## Phase 1.7 — leased discovery-source scheduling in the worker (#1087) — current

The EXISTING worker (`src/lib/worker/`) now safely claims and runs independently
scheduled discovery sources across multiple instances, WITHOUT a second daemon or
external broker. A sibling scheduling pass (`runDiscoveryLoop`) runs under the
same worker runtime — sharing its poll cadence, stop signal, and `once` mode —
and is activated only when a page-fetch seam is supplied (`options.discovery`).

### Claim + lease model (`claimDueDiscoverySource`)

Mirrors the Job claim (`src/lib/jobs/claim.ts`): a public dispatcher branches on
the active database URL to a PostgreSQL adapter (`FOR UPDATE SKIP LOCKED`) and a
generic SQLite/serialized adapter (a guarded conditional `updateMany`). A source
is claimable when it is due (`nextRunAt <= now`), in a claimable lifecycle mode
(`SHADOW`/`BASELINE`/`ACTIVE`), under an auto-claim automation policy
(`SCHEDULED`/`CONTINUOUS`), its lease is free OR expired, and it is not inside an
active backoff. Claiming stamps `leaseOwner`/`leaseAcquiredAt`/`leaseExpiresAt`
atomically so two workers never claim the same source. An expired lease
(`leaseExpiresAt < now`) is reclaimable, so a crashed worker never strands a
source; `leaseOwner` is an OPAQUE worker token, never a secret.

Single-writer-per-source/version is enforced AGAIN on every write: the page and
frontier commits revalidate the lease + `definitionVersion` on their guarded
updates, so even a mid-run lease steal cannot double-process one source/version.

### Bounded, resumable run (`runClaimedDiscoverySource`)

Each claim runs a SINGLE bounded page (preferred over heartbeating a long scan —
it keeps leases short): fetch ONE page via the injected #1084 seam (network stays
out of every transaction) → `commitDiscoveryPage` (#1085) → `commitFrontierState`
(#1086) with the pure `decideRunCompletion` health → persist the next `nextRunAt`
and RELEASE the lease under the same guarded update. A crashed worker resumes
from the last durably-committed checkpoint. A non-boundary page leaves the source
immediately due so pagination continues page-by-page across claims. Baseline/
shadow runs create NO Article / body fetch / ingest job — the run handler never
enqueues body work.

### Scheduler clock (`computeNextRunAt`)

A PURE, deterministic function (no DB/network/randomness) computes the next
`nextRunAt` from the schedule tier (`pollIntervalSeconds` or the tier default),
source role, observed publication cadence bounds, failure backoff, pause state,
and provider request budget. Role tiers map onto the schema's roles: PRIMARY_FEED
/ SECTION_INDEX / ARCHIVE_INDEX / SITEMAP run at the base cadence (primary tier),
SUPPLEMENTAL runs at a strictly LOWER reconciliation frequency, and "fallback" is
modelled as a source that stays dormant (returns no schedule) until its
activation condition holds. Failure backoff is a capped, jitter-free exponential
that dominates the cadence while a source keeps failing; budget exhaustion defers
by at least a cooldown; the interval is clamped to the observed cadence bounds. A
paused, non-eligible, or dormant-fallback source returns `null` — a `NULL`
`nextRunAt` never satisfies the claim predicate, so it is simply never picked up.

### Failure isolation

The run handler catches ANY error, converts it to a REDACTED metadata-only
`lastError` (query strings and URLs stripped via `redactUrlForLog`), escalates
`backoffLevel`/`consecutiveFailures`, sets `backoffUntil`, marks the source
`FAILING`, and still releases the lease — never throwing to the loop. One failing
optional provider can neither stop the Job loop nor block other discovery
sources.

## Phase 1.8 — baseline & strict shadow lifecycle (#1088) — current

Phase 1.8 establishes each source's already-known observable set BEFORE
activation, then proves subsequent new-item decisions WITHOUT any body fetch. The
decisions are PURE (`src/lib/scraper/incremental/lifecycle.ts`); a thin guarded
persistence layer (`lifecycle-commit.ts`) applies them with the #1085/#1086
lease + `definitionVersion` guard, and a run guard (`lifecycle-run-guard.ts`)
makes the "no body work" invariant explicit and testable.

### Lifecycle state machine + transition order

The authoritative progression is `DISABLED → BASELINE → SHADOW → ACTIVE`, plus
`PAUSED` (from any active-ish state) with resume, safe one-step `rollback` toward
`DISABLED`, and terminal `RETIRE`. `classifyLifecycleTransition` is the single
source of truth for which `from → to` edges are legal (every other edge is
refused, so activation stays explicit and auditable). The persistence layer
applies a transition only under a guarded `updateMany` keyed on
`{ id, leaseOwner, definitionVersion, lifecycleMode }`, so a lost lease or a
concurrent transition rolls the whole change back. Activation is AUDITED via a
redacted, metadata-only log entry (source id + queued/deferred counts + cutoff).

### OBSERVED_BASELINE vs OBSERVED_SHADOW mapping

The schema has no `OBSERVED_BASELINE`/`OBSERVED_SHADOW` status; the issue's
conceptual labels map onto the real `CrawlCandidateStatus` + the orthogonal
sticky `observedInBaseline` flag:

- **OBSERVED_BASELINE** = `status = BASELINE` + `observedInBaseline = true` — a
  known, pre-existing identity of the source's baseline window that normal
  incremental runs must NEVER auto-ingest.
- **OBSERVED_SHADOW** = `status = DISCOVERED` + `observedInBaseline = false` — a
  NEW post-baseline identity observed while the source is in SHADOW, being proven;
  eligible for activation catch-up but not yet queued.

The single `baseline-shadow` classification outcome (`classify.ts`) is split by
the source's live lifecycle mode in `page-commit.ts`: BASELINE mode writes
OBSERVED_BASELINE, SHADOW mode writes OBSERVED_SHADOW. A baseline is each
source's normal incremental observable window (NOT its full archive); its
identities are persisted as OBSERVED_BASELINE and never enqueued even when a date
looks recent.

### Immediate second-scan cutover

Baseline completion is GATED: `decideBaselineCompletion` (reusing the #1086
`decideRunCompletion` accounting) requires EVERY configured page/shard/cursor
segment to reach its boundary AND commit its checkpoint — a partial or failed
segment refuses completion, so a baseline can never complete on incomplete data
(an empty segment set fails closed too). On success the source stamps
`baselineCompletedAt` + the initial watermark, records `baselineObservedCount`,
and enters SHADOW immediately due for the second scan. The cutover invariant is
enforced for free by the sticky flag: the page-commit upsert `update` path never
changes `status`/`observedInBaseline`, so an identity first observed during the
baseline stays OBSERVED_BASELINE even when re-seen — the second scan re-sees
baseline identities as `existing-identity` (not reclassified) while genuinely new
identities become OBSERVED_SHADOW candidates.

### Shadow no-body-work guarantee

In BASELINE and SHADOW the run performs normalization, classification, ledger
commits, metrics, and gap detection but PROHIBITS article-body fetches, Article
writes, and article-processing jobs. `isBodyWorkProhibited` names the invariant,
and `guardIngestPort` wraps any body-work port so a call in BASELINE/SHADOW is
refused with `BodyWorkProhibitedError` BEFORE the real dependency runs. Tests
inject FAILING body-fetch / Article-write / Job-enqueue deps and prove they are
never reached (zero body fetches, Article writes, and `ARTICLE_INGEST` jobs).

### Activation catch-up (age + count limits)

On activation, `selectActivationCatchUp` deterministically picks which
OBSERVED_SHADOW candidates to queue within BOTH per-source limits — default
SEVEN DAYS and 100 CANDIDATES, with EITHER limit stopping catch-up. Candidates
are ordered newest-first (age reference = trusted publication date, else
first-observed) with the sanitized identity key as a stable tiebreak; only the
newest, in-window candidates within the count cap move `DISCOVERED → QUEUED`.
Older / over-limit candidates stay OBSERVED_SHADOW (only an explicit future
backfill may reactivate them). The queue move is guarded on `status = DISCOVERED`
so activation is idempotent and deterministic on retry, and resumable after a
partial activation (a retry queues only the still-eligible remainder without
re-stamping `activatedAt`). Queuing to `QUEUED` is the Phase-1 terminal state;
real ingestion is Phase 2 (#1091).

### Observability, auto-degradation & minimal admin controls (Phase 1.9, #1089)

Phase 1.9 makes a source's operational state legible to operators and lets a
drifting source demote itself, following the pure-logic + thin-persistence house
style. NONE of this triggers body work or ingestion — it only READS state and
flips lifecycle mode.

- **Pure metrics (`observability.ts`).** `computeSourceMetrics` takes a
  metadata-only snapshot (source columns + per-status `CrawlCandidate` counts +
  recent observation timings) and `now`, and derives per-source signals:
  publication-to-discovery delay percentiles, zero-discovery streak, watermark
  stall age, gap age, candidate rollups (total / backlog / discovered / ingested
  / rejected / failed / conflict), conflict rate, and a volume anomaly. It
  collapses these into ONE `OperationalStatus` badge via
  `deriveOperationalStatus` — precedence `gap-detected` > `stalled` > `partial` >
  `healthy-backlog` > `healthy-caught-up` — so the admin UI renders a source
  without inspecting the database (AC1). Every field is a controlled id, count,
  status, or duration; no URL, article content, or secret is ever read into a
  metric or emitted (AC4).
- **Pure degradation (`degradation.ts`).** `decideDegradation` takes a drift
  snapshot + provider-aware thresholds and returns `keep` or `demote-to-shadow`.
  Only ACTIVE sources are considered. A sustained HTTP-200/zero-discovery drift
  (`consecutiveZeroDiscoveryRuns >= maxZeroDiscoveryStreak`, default 8) or a
  stalled watermark (`>= maxWatermarkStallMs`, default 21 days) demotes the
  source; run failures are left to the existing backoff. `nextZeroDiscoveryStreak`
  is the single pure accounting for the durable `consecutiveZeroDiscoveryRuns`
  counter (added to `DiscoverySource`): a boundary-reached run discovering no new
  eligible identities increments it, any new discovery resets it, a mid-scan run
  leaves it unchanged.
- **Auto-degradation wiring.** The discovery run finalizer computes the new
  streak and calls `evaluateAndApplyDegradation` UNDER the worker's still-held
  lease. A `demote-to-shadow` decision applies the guarded ACTIVE→SHADOW
  `transitionDiscoveryLifecycle` (a "rollback" edge), so checkpoint, candidate,
  and watermark state are preserved and the source is fully recoverable
  (SHADOW→ACTIVE re-activates it) — AC3. The evaluation is no-throw: a
  degradation fault can never break the discovery loop (failure isolation).
- **Capability-protected admin API.** Three routes under
  `/api/admin/discovery-sources`, all gated on `sources.manage` via
  `createCapabilityHandler` (deny-by-default 401/403, CSRF, and security-event
  recording handled by the wrapper — no hand-rolled auth), expose read + minimal
  lifecycle control without touching the schema's URL/secret columns:
  `GET /` (list summaries), `GET /{id}` (detail summary), and
  `POST /{id}/lifecycle` (`{ action }`: begin-baseline | activate | pause |
  resume | rollback | disable | retire). The action + id are validated, and the
  mutation dispatcher (`applyLifecycleAction`) reuses the guarded lifecycle
  commits on an IDLE source (refusing a worker-held one), never writing a new
  transition path. Every successful mutation writes a sanitized audit log
  (`admin.discovery_source.lifecycle`: sourceId, from/to mode, counts — never a
  URL/content/secret) — AC2. Review, backfill, conflict resolution,
  authenticated-source secrets, and force-rescrape are deliberately NOT exposed
  in this phase.
- **Minimal admin UI (`/admin/discovery-sources`).** Two capability-gated App
  Router pages (both `requireCapability(sources.manage)`), built entirely from
  the shared design-system primitives (`@/components/admin`, `@/components/ui`)
  and design tokens — no raw colours/font-sizes:
  - the **list** (`page.tsx`) reads `listDiscoverySourceMetrics` server-side and
    renders one row per source with a coloured **operational-status badge**
    (caught-up / backlog / partial / stalled / gap-detected — AC1), lifecycle
    mode, automation policy, role, health, last run, watermark stall age, backlog
    count, and gap state, plus a provider-key + lifecycle-mode filter and an
    empty state;
  - the **detail** (`[id]/page.tsx`) reads `getDiscoverySourceMetrics` and shows
    the full metric summary (lifecycle/role, runs + watermark + baseline, gap,
    drift signals — zero-discovery streak, backoff, publication→discovery delay
    percentiles, volume anomaly, conflict rate, validator failures — and
    candidate counts by status), plus the lifecycle **action controls**.
  - The action controls (`AdminDiscoverySourceActions.tsx`, a client component)
    render the seven actions; each is DISABLED when it is not valid from the
    source's current mode (derived by the pure `lifecycle-action-eligibility.ts`
    mirror — e.g. `activate` only from SHADOW, `begin-baseline` only from
    DISABLED), and the unwind/stop actions (rollback / disable / retire) require
    an inline confirm. Each action POSTs to `POST /{id}/lifecycle`; the backend
    stays the source of truth, so a 409 (busy / invalid-transition /
    baseline-incomplete) is surfaced as an inline error and the page refreshes on
    success. The UI renders ONLY the PII-free DTO fields (ids/counts/statuses/
    durations) — never a URL, article content, or credential (AC4). States
    covered: loading (button spinner), empty (no sources), error (409 alert),
    disabled-action, compact mobile, and light/dark. Playwright coverage lives in
    `e2e/admin-discovery-sources.spec.ts`.

### Phase 1 canaries & exit gates — the go/no-go capstone (Phase 1.10, #1090)

Phase 1.10 proves the SAME incremental-discovery model against all three common
input styles BEFORE any body ingestion is enabled, and encodes the quantitative
go/no-go bar for the whole program. It adds NO schema and does NO body work; it
only reads metadata and gates the SHADOW→ACTIVE transition.

- **Three canary adapters (`incremental/adapters/*.ts`).** Each implements the
  `DiscoveryPageFetcher` seam for ONE channel, fixture-driven and body-free:
  - **RSS** (`rss-adapter.ts`) — reuses `parseRssEntries` (`rss.ts`); trusted
    per-item `<published>` date → FEED provenance.
  - **Sitemap** (`sitemap-adapter.ts`) — parses `<urlset>` `<loc>`/`<lastmod>`;
    trusted `<lastmod>` → PAGE_METADATA provenance.
  - **Seed-HTML** (`html-seed-adapter.ts`) — reuses `hrefsFromHtml` to resolve
    anchors on a seed index; NO trusted per-item date → UNKNOWN provenance
    (`review-required` in ACTIVE, never silently windowed).
  All three share `adapters/types.ts`: they fetch ONLY the one channel document
  via the injected SSRF-safe `DiscoveryFetch`, cap the items to one bounded
  observable window (`boundaryReached = true`), return an empty page on 304, and
  throw `CanaryFetchError` on retryable/error/blocked so the run handler isolates
  the source. There is NO code path from an adapter to a body, an Article, or an
  ingest job (the governing invariant + AC4).
- **Declarative canary config (`incremental/canaries.ts`).** Data-only records
  (the house provider-config convention) select one representative,
  unauthenticated, live-stable source per channel — The Conversation (RSS),
  Works in Progress (sitemap), Undark (seed-HTML) — each with a stable
  source-key/version, observable-window rule, date-trust policy, role, schedule
  tier, overlap/stop rule, validator-calibration interval, admission policy
  (the SAME versioned provider pattern — no canary-specific relaxation), and a
  `rationale`. Every canary is seeded DISABLED; the pure `assertNoCanaryAutoActivates`
  proves no registry sync can silently ACTIVATE a source.
- **Pure exit-gate evaluator (`incremental/exit-gates.ts`).** Given a
  metadata-only `ExitGateSnapshot` (the #1089 `SourceMetricSummary` + the
  reconciliation result + controlled counts), `evaluateExitGates` returns a
  per-gate pass/fail and an overall verdict, which is `pass` ONLY when EVERY gate
  passes. The five gates are HARD ZEROS and are NEVER relaxed:
  - `no-old-item-false-positives` — no known/baseline identity reclassified as
    new (`oldItemFalsePositives === 0`);
  - `no-duplicate-jobs` — no identity has two queued/ingest jobs
    (`duplicateJobs === 0`);
  - `no-unexplained-misses` — reconciliation found no unexplained miss
    (`unexplainedMisses === 0`);
  - `recovery-successful` — at least one fault was injected AND all recovered
    (`faultsInjected > 0 && unrecoveredFaults === 0`; fail-closed);
  - `within-budget` — discovery volume within the per-run budget and no volume
    spike anomaly.
- **Gate enforcement on activation (AC2).** `activateDiscoverySource`
  (`lifecycle-commit.ts`) takes an optional `ExitGateGuard`, evaluated BEFORE any
  state change; a non-passing verdict REFUSES activation (`exit-gates-failed`
  with the failing gate names), the source stays SHADOWED, and the refusal is
  audited. Because SHADOW→ACTIVE is the ONLY forward edge into ACTIVE (every
  other admin action routes through `transitionDiscoveryLifecycle`, which never
  targets ACTIVE — `resume` returns to SHADOW/BASELINE), gating activation closes
  every shortcut. The admin dispatcher (`lifecycle-actions.ts`) installs a
  FAIL-CLOSED `canaryExitGateGuard` for canary sources: with no operator-supplied
  soak evidence the `recovery-successful` gate fails, so a canary can never reach
  ACTIVE until its recovery evidence is supplied. There is deliberately NO
  operator override in this phase — a failing canary is fixed or replaced, never
  waved through. The lifecycle route maps `exit-gates-failed` to a 409.
- **Reconciliation tooling.** Pure `reconcile` (`incremental/reconciliation.ts`)
  compares ledger observations against a controlled provider sample and tallies
  hits / explained-misses / UNEXPLAINED-misses / extras (plus a per-category
  rollup), storing ONLY sanitized identity keys, counts, and category labels —
  never article content or a raw URL. The thin
  `scripts/reconcile-discovery-canary.ts` runner (npm `reconcile:discovery-canary`)
  assembles the two sets from metadata-only reads and exits non-zero on any
  unexplained miss.
- **Definition-version replacement + rollback (AC3).** Each definition version
  is a DISTINCT `DiscoverySource` row keyed by the existing
  `@@unique([providerKey, sourceKey, definitionVersion])`, so a replacement has
  its OWN lease/checkpoint/watermark/ledger and runs INDEPENDENTLY in shadow while
  the prior row is RETAINED untouched — no schema change.
  `replaceDefinitionVersion` creates the next version DISABLED (copying
  role/schedule/budgets); `rollbackDefinitionVersion` guardedly RETIRES the newest
  non-retired version (never stealing a live lease) and the retained prior version
  stays restorable through the normal gated activation path. The pure
  `nextDefinitionVersion`/`planRollback` planners are unit-tested.
- **Fault simulations + fixture soak.** DB-backed lifecycle tests (`tests/db/`,
  guarded by `RUN_DB_INTEGRATION`) assert safe recovery for worker crash / stale
  lease reclaim, live-lease-not-stolen, long outage, source reordering, stale
  validator / stale definition version, and definition-version replacement, all
  reusing the merged guarded-claim/lease machinery. A deterministic, fixture-driven
  soak (`tests/db/canary-soak.test.ts`) exercises the full
  baseline→shadow→(gated)activate cycle over one simulated publication cycle and
  proves AC4 STRUCTURALLY: the body-work guard refuses in baseline/shadow so
  injected FAILING body-fetch/Article-write/ingest deps are never reached, and no
  Article or ARTICLE_INGEST job is ever written across the whole cycle including
  the gated activation.

### Phase 1 go/no-go checklist

A canary is GO for activation only when ALL of the following are true (each is a
quantitative exit gate; none is ever relaxed to force a pass):

| # | Gate | Threshold | Evidence |
|---|------|-----------|----------|
| 1 | Old-item false positives | `= 0` | `no-old-item-false-positives` — no baseline/known identity reclassified as new |
| 2 | Duplicate jobs | `= 0` | `no-duplicate-jobs` — no identity with two queued/ingest jobs |
| 3 | Unexplained sampled misses | `= 0` | `no-unexplained-misses` — reconciliation vs controlled sample |
| 4 | Fault recovery | `faults injected > 0` and `unrecovered = 0` | `recovery-successful` — fault-sim suite (fail-closed by default) |
| 5 | Volume / cost | `discovered/run ≤ budget` and no volume spike | `within-budget` — #1089 metric summary |
| 6 | No body work / no Article write | structural, all modes | AC4 soak — injected failing body deps never reached; Article & ARTICLE_INGEST counts stay 0 |
| 7 | No silent activation | structural | `assertNoCanaryAutoActivates`; activation is the only edge into ACTIVE and is gate-enforced |
| 8 | Version rollback | replaced version shadows independently; prior retained + restorable | AC3 replacement/rollback tests |

The Phase-1 soak in this repository is FIXTURE-DRIVEN and deterministic (no live
network is required to reproduce the go/no-go evidence). A true multi-cycle live
soak against the real canary endpoints is an operational follow-up; the
fixture-driven equivalent exercises the same baseline→shadow→(gated)activate path
and the same exit-gate evaluation.

## Phase 2.1 — atomically enqueue candidate-based ingestion work (#1091) — current

Phase 2 turns eligible NEW candidates into durable ingestion work. Phase 2.1
enqueues that work atomically with the discovery page commit; it does NOT fetch,
extract, or create an Article (that is #1095). The governing invariant is
unchanged: normal incremental ingestion acts ONLY on identities first observed
AFTER a completed baseline, and a known public identity is never auto-refetched
or revived.

### Transaction-aware idempotent enqueue (`enqueueJobInTx`)

`enqueueJobInTx(tx, type, payload, dedupeKey, opts)` participates in the CALLER'S
existing interactive transaction. Idempotency inside the transaction uses
`upsert` (INSERT … ON CONFLICT) on the unique `Job.dedupeKey`, never a
catch-`P2002`-inside-the-transaction — a caught `P2002` poisons a PostgreSQL
transaction and would abort the whole page commit. The `ON CONFLICT` update is a
deliberate no-op: an existing Job — ACTIVE **or** TERMINAL — is REUSED, never
reset. Concurrent or replayed enqueues therefore converge on the single database
winner (the upsert returns it), and a terminal Job is never revived by ordinary
rediscovery. The type's retry policy, priority, run-after, and empty
error-history initialization are preserved. The standalone `enqueueJob` /
`enqueueDeduped` (which DO reset a terminal job) are unchanged for
non-incremental callers.

### Candidate-based payload + dedupe key (metadata only)

Incremental ingestion is keyed on the ledger CANDIDATE identity, never on a URL.
The Job payload carries ONLY `{ candidateId, processingVersion }` — no URL,
provider policy, credential, article data, or mutable candidate field. The pure,
DB-free seam `src/lib/jobs/candidate-ingest.ts` builds/validates the payload and
constructs the dedupe key `article-ingest:candidate:<candidateId>:v<processingVersion>`.
`processingVersion` is a code-defined constant (`CANDIDATE_INGEST_PROCESSING_VERSION`),
so no schema change is required; bumping it in code starts a fresh,
independently-deduped attempt without disturbing prior terminal Job history.

### Enqueue inside the page-commit transaction (eligible + ACTIVE only)

`commitDiscoveryPage` enqueues one candidate-based `ARTICLE_INGEST` job for every
item classified `eligible` in `ACTIVE` lifecycle mode, INSIDE the same
`$transaction` that upserts the candidate/alias/observation and advances the
guarded checkpoint. Because the enqueue shares that transaction, any later
rollback — a write fault, or a lost lease at the guarded checkpoint advance —
rolls the Job back too, so a committed checkpoint NEVER points past a missing
Job. Baseline, shadow, existing-identity, review-required, outside-window, and
policy-rejected outcomes enqueue NOTHING (`eligible` is only ever emitted by the
pure classifier in ACTIVE mode; the explicit mode check is belt-and-suspenders).
Still, no Article is created and no body is fetched here.

### Worker dispatch + #1095 hand-off boundary

The `ARTICLE_INGEST` handler dispatches on payload shape: a candidate-based
payload resolves the candidate from the ledger by id at execution time; the
legacy url/articleId ArticleIngest payload keeps delegating to the article
processor (no runtime compatibility layer was added for the old shape). For a
candidate payload the handler guards the governing invariant — a missing
candidate is a permanent failure, and a terminal / baseline-observed /
already-linked candidate is a safe no-op (never re-ingested) — then stops at a
clear no-op hand-off point. Fetch / extract / Article creation is explicitly
OUT OF SCOPE and lands in #1095. No URL or article content is ever logged.

### Acceptance evidence

- **AC1 (atomicity)**: an eligible ACTIVE commit yields exactly one active
  `ARTICLE_INGEST` job; fault injection after the item write, and a lease steal
  at the guarded checkpoint advance, both roll the whole page back (no candidate,
  no job, unadvanced checkpoint). `tests/db/candidate-ingest-enqueue.test.ts`.
- **AC2 (idempotency)**: replaying and concurrently committing the same page
  converge on one job.
- **AC3 (terminal not reset)**: a `COMPLETED` job survives ordinary rediscovery
  of the same candidate/version — the dedupe winner is reused, not recreated.
- **AC4 (PII-free)**: the payload is `{ candidateId, processingVersion }` and the
  error history is empty; unit + DB tests assert no URL/scheme leaks.

## Phase 2.2 — resolve final canonical identity & body fingerprints under concurrency (#1092) — current

Phase 2.2 makes URL variants and identical provider content **converge on one
candidate BEFORE Article creation**, without ever turning an identity check into
a refresh of a known Article. It splits, per the house pattern, into PURE
resolution logic (no DB/network/clock) that operates on PROVIDED inputs, and
THIN guarded persistence that applies a decision to the ledger atomically. Body
fetch / extraction / Article creation remain OUT OF SCOPE (#1095) — this phase
operates on the fetched final URL, declared canonical, and extracted prose that
the future pipeline will PROVIDE.

### Trusted final identity (pure — `final-identity.ts`)

`resolveFinalIdentity({ owningProviderKey, finalUrl, canonicalUrl? })` delegates
to the versioned #1082 `deriveCanonicalIdentity` (sanitized, versioned keys) and
returns exactly one decision:

- `keep-own-provider` — the trusted canonical belongs to the same owning provider
  (directly, or on an explicitly-associated domain whose host is preserved).
- `transfer-to-provider` — the canonical belongs to ANOTHER registered provider.
  Ownership transfers and that provider's admission policy (`articleUrlPattern` +
  `articleUrlFilter`, via `admittedByProvider`) is **re-run**; a URL the new
  provider would not admit is routed to review, never silently accepted under a
  laxer policy.
- `route-to-review` — an UNKNOWN cross-domain redirect/canonical, an
  unparseable/unsupported URL, or a rejected transfer. A declared canonical is
  authoritative over the fetched final URL.

### Versioned prose fingerprint (pure — `prose-fingerprint.ts`)

`computeProseFingerprint(prose)` returns `v<PROSE_FINGERPRINT_VERSION>:<sha256hex>`
of normalized prose (NFKC → lowercase → collapse whitespace → trim). Matching is
**exact-only** — a hash gives zero false merges; there is deliberately no fuzzy /
semantic similarity (which could merge distinct articles or masquerade as a
refresh of a known Article). The prose text is never stored or logged — only the
hash + version columns `CrawlCandidate.bodyFingerprint` / `bodyFingerprintVersion`
(provider-scoped `@@index([providerKey, bodyFingerprint])`; **no global unique**,
so cross-provider matches route to review rather than fail/merge).

### Merge-winner selection (pure — `selectMergeWinner`)

Given the colliding participants: two or more with an Article → unmergeable →
review (`multiple-known-articles`); otherwise a protected tier wins (an Article
beats everything, then a baseline identity), and among equally-protected the
earliest by `firstObservedAt`, then `createdAt`, then `id`. A KNOWN identity
always wins so it is never touched (AC4).

### Thin guarded persistence (`final-identity-commit.ts`)

`applyFinalIdentity` is the orchestration the #1095 pipeline calls after fetch +
extraction:

1. **Guard (AC4)** — a candidate with `articleId != null` or `observedInBaseline`,
   or an already-terminal status, is left untouched (checked before AND inside the
   tx).
2. **Review routing (AC2)** — unknown cross-domain / rejected transfer / cross-
   provider fingerprint / multiple known articles are parked with an OPEN
   `CanonicalConflict` row (auditable `reason`) and `NEEDS_REVIEW` status; the
   pending `ARTICLE_INGEST` job is cancelled.
3. **Collision merge (AC1/AC3)** — the canonical identity is assigned in a single
   guarded interactive `$transaction`; a collision folds later candidates into the
   earliest winner: aliases (relabelled `DUPLICATE`) + observations are re-pointed
   (RETAINED — every discovery site is preserved), losers are marked
   `DUPLICATE_ALIAS`, and their ingest jobs cancelled.
4. **Convergence-after-conflict (AC1)** — the `@@unique([providerKey,
   canonicalKey])` slot is the collision point. Idempotent writes inside the tx use
   `upsert` (never catch-P2002-in-tx); a concurrent claim makes the tx throw P2002,
   and the STANDALONE wrapper (`convergeCanonicalMerge`, ≤5 retries) re-queries the
   now-existing winner and folds into it — two racing workers converge on ONE
   candidate instead of both failing.
5. **Prose fingerprint** — exact same-provider duplicates merge into the earliest
   winner; a cross-provider match parks for review.

New `CrawlCandidateStatus` values: `DUPLICATE_ALIAS`, `NEEDS_REVIEW`. Under SQLite
the status column is TEXT (no migration for new values); PostgreSQL uses
`ALTER TYPE … ADD VALUE`.

### Acceptance evidence

- **AC1 (convergence)**: tracking / AMP / redirect / canonical variants resolving
  to one canonical produce a single winning candidate (sequential AND concurrent)
  with at most one Article-creation path. `tests/db/final-identity-commit.test.ts`.
- **AC2 (auditable stop)**: unknown cross-domain AND cross-provider fingerprint
  cases stop before Article creation with a `CanonicalConflict` + `NEEDS_REVIEW`.
- **AC3 (retain + cancel)**: a merged loser's aliases + observations are re-pointed
  to the winner while its ingest job is cancelled.
- **AC4 (invariant)**: a known Article/baseline candidate is untouched even when a
  later fetch would differ; a fresh candidate colliding with a known Article folds
  INTO it (never refreshed). Pure decision tests in
  `tests/scraper-final-identity.test.ts` / `tests/scraper-prose-fingerprint.test.ts`.

### Deferred

Source-window / publication-policy re-evaluation on a cross-provider transfer is
deferred to the #1095 pipeline (which owns the discovery-source context); Phase
2.2 re-runs the target provider's URL admission gate.

## Phase 2.3 — propagation retries, quarantine & extractor-version reactivation (#1093) — current

Phase 2.3 lets a genuinely-new candidate **recover from TEMPORARY unavailability**
(CDN propagation lag, transient `5xx` / `429`, short extraction) while ensuring
**DETERMINISTIC failures** (`410`, permanent access/policy, unfixable bad pages)
reach ONE stable terminal state and stop consuming resources forever. It follows
the house pattern: PURE classification + scheduling logic (no DB / network /
clock — takes `now: Date` + provided inputs) plus THIN guarded persistence that
applies a decision to a candidate + its `ARTICLE_INGEST` Job atomically. The body
fetch / extraction / Article creation that PRODUCES the attempt outcome remains
OUT OF SCOPE (#1095) — this phase classifies an outcome the future pipeline will
PROVIDE and exposes the seam it calls.

The governing invariant is enforced everywhere: retries, quarantine, and
reactivation apply ONLY to candidates with `articleId == null` AND
`!observedInBaseline`. A KNOWN public Article is never retried, refreshed,
quarantined, or reactivated; an extractor upgrade is never a content refresh.

### Failure classification (pure — `ingest-outcome.ts`)

`classifyIngestAttempt({ outcome, now, attemptNumber, firstAttemptAt, config })`
maps a #1095-supplied outcome to `{ disposition, reason, retryAfterMs?,
nextAttemptAt? }`. Reason codes are machine-only — **never** a body, URL, or
secret:

- **Permanent → `terminal`** (immediate, no retries): `http_410_gone`,
  `access_restricted`, and any other non-404/403/429 client error
  (`http_client_error`).
- **Transient → `retry`** while attempts remain, else `quarantine-on-exhaustion`:
  `fetch_timeout`, `network_error`, `http_404_pre_propagation` (a 404 still
  inside the grace window), `http_403_temporary`, `http_429`, `http_5xx`,
  `extraction_incomplete`.
- **Deterministic reprocessable → `quarantine-on-exhaustion`** immediately (no
  point retrying the same extractor, but reactivatable by a future upgrade):
  `quality_rejected`, and `http_404_after_grace` (a 404 once the propagation
  window has elapsed = a persistent not-found).

### Propagation grace + backoff + Retry-After (pure)

- `withinPropagationGrace(firstAttemptAt, now, graceMs)` — a newly-discovered
  candidate gets a CONFIGURABLE propagation grace window
  (`SCRAPER_INGEST_PROPAGATION_GRACE_MS`, default 6h) measured from
  `firstIngestAttemptAt`. A 404 inside grace is pre-propagation (retry); after
  grace it is quarantine. The first attempt (`firstAttemptAt == null`) anchors on
  `now`, so it is always within grace.
- `computeNextAttemptAt()` — a server-supplied `Retry-After` (`retryAfterMs`)
  **overrides** the computed backoff entirely; otherwise the next attempt is
  `now + jitteredExponentialBackoff({ attempt, baseMs, maxMs })`, reusing
  `src/lib/backoff.ts` and the per-JobType `RETRY_POLICIES`. An injectable RNG +
  fake clock make it deterministic under test.

### Thin guarded persistence (`ingest-recovery.ts`)

`applyIngestClassification({ candidateId, classification, now, extractorVersion,
job? })` applies a decision restart-safely. Every write is a guarded
`updateMany({ where: { id, articleId: null, observedInBaseline: false,
status: { in: RECOVERABLE_CANDIDATE_STATUSES } } })` whose `count === 0 ⇒ throw
RecoveryConflictError ⇒ rollback` (AC4). `RECOVERABLE_CANDIDATE_STATUSES` =
`{ DISCOVERED, QUEUED, INGESTING, FAILED }`:

- `retry` → bump `ingestAttemptCount`, set `nextAttemptAt` + `lastFailureReason`,
  stamp `firstIngestAttemptAt` on the first attempt; the Job (when a `job`
  context is supplied) goes back to `FAILED` with `runAfter = nextAttemptAt`.
- `quarantine-on-exhaustion` → move the candidate to the NEW
  `CrawlCandidateStatus.QUARANTINED` (ONE visible state) with `terminalReason` +
  `terminalAt`; the Job is `DEAD_LETTER`.
- `terminal` → move the candidate to `REJECTED` (permanent 410 / access) with
  `terminalReason` + `terminalAt`; the Job is `DEAD_LETTER`.

When a `job: { jobId, workerId }` context is supplied, the candidate and Job
transition in ONE interactive `$transaction` guarded on
`{ status: RUNNING, lockedBy: workerId }`, so a stale non-owner worker rolls BOTH
back (AC4). At the worker seam the handler applies the candidate-only transition
and then THROWS a mapped `JobError`, letting the canonical `failJob` machinery
own the Job transition, error-history, and queue metrics.

**Why QUARANTINED is not re-enqueued on every scan:** page-commit only enqueues
`ARTICLE_INGEST` for a NEW `eligible` classification; re-observing an existing
candidate only touches `lastObservedAt` and never enqueues, and the ingest Job's
dedupe key already exists (the terminal Job is reused, never reset). A
QUARANTINED candidate is therefore stable across rescans (AC2).

### Extractor-version reactivation (pure select + thin apply)

`selectReactivationEligible(candidates, { newExtractorVersion, budget })` returns
the eligible set, deterministically ordered and capped by `budget`. A candidate
is eligible IFF `articleId == null` AND `!observedInBaseline` AND
`status == QUARANTINED` AND `lastFailureReason ∈ REACTIVATABLE_FAILURE_REASONS`
(`extraction_incomplete`, `quality_rejected`) AND
(`extractorVersion == null || extractorVersion < newExtractorVersion`).
**Prohibited (never reactivated):** any candidate with an Article
(saved/deleted), `NEEDS_REVIEW`, `CONFLICT`, `DUPLICATE_ALIAS`, `SKIPPED`
(policy), `REJECTED` (permanent), and any baseline identity.

`reactivateCandidate` / `reactivateEligibleCandidates` bump the candidate
`processingVersion` + `extractorVersion` to `newExtractorVersion`, reset the
attempt metadata, set status back to `DISCOVERED`, and enqueue a NEW
`ARTICLE_INGEST` Job via `candidateIngestDedupeKey(id, newExtractorVersion)` — a
NEW dedupe key, so the PRIOR terminal Job (dedupe `v1`) stays intact for audit
history. Reactivation is bounded by `SCRAPER_REACTIVATION_BUDGET` (default 50).

### Acceptance evidence

- **AC1 (recover pre-propagation 404)**: a candidate returning `404` inside the
  grace window is retried on the SAME candidate/Job and LATER succeeds without
  rediscovery — fake-clock tests in `tests/ingest-outcome.test.ts` (grace +
  backoff + Retry-After override) and the retry persistence test in
  `tests/db/ingest-recovery.test.ts`.
- **AC2 (permanent-failure containment)**: an exhausted / deterministic failure
  reaches ONE `QUARANTINED` state and is not re-enqueued on rescan —
  `tests/db/ingest-recovery.test.ts` (quarantine transition + rescan stability).
- **AC3 (bounded, eligible-only reactivation)**: `selectReactivationEligible`
  selects only the eligible no-Article failure set and obeys the budget —
  eligibility + prohibited-status + budget tests in
  `tests/ingest-outcome.test.ts`, plus the enqueue-with-bumped-version test in
  `tests/db/ingest-recovery.test.ts`.
- **AC4 (determinism under restart / stale-Job reclaim)**: guarded `updateMany`
  count-zero rollback keeps retry + quarantine deterministic when a stale worker
  loses its lease — `tests/db/ingest-recovery.test.ts` (stale-Job reclaim).

New `CrawlCandidateStatus` value: `QUARANTINED`. New metadata-only
`CrawlCandidate` columns: `ingestAttemptCount`, `nextAttemptAt`,
`lastFailureReason`, `firstIngestAttemptAt`, `extractorVersion` (+
`@@index([status, nextAttemptAt])`). Under SQLite the status column is TEXT (no
migration for new values); PostgreSQL uses `ALTER TYPE … ADD VALUE`.

### Deferred

The real fetch / extraction / Article-creation that produces an
`IngestAttemptOutcome`, and the scheduled scanner that drives due retries +
reactivation passes, are #1095. Phase 2.3 delivers the pure classifier, the
guarded persistence, and the worker seam #1095 will call.

## Phase 2.4 — hostname budgets, provider fairness, priorities & cost budgets (#1094) — current

Phase 2.4 governs *how fast and in what order* discovery and (future) body work
may hit each publication, so a high-volume provider can never monopolize the
global worker pool and real-time incremental work can never be starved by
historical backfill. All decision logic is pure and injected-clock testable
(`rate-governor.ts`); persistence is a thin guarded-tx layer
(`rate-governor-commit.ts`) over two durable tables; wiring reads runtime config
(`rate-governor-config.ts`). No external broker is introduced (explicit
non-goal — no Redis / external queue).

### Pure governor (`rate-governor.ts`)

Takes an injected `now: Date` plus plain metadata snapshots and returns
decisions — never touches the DB, network, or the wall clock:

- **Shared hostname budget (AC1).** `admitHostnameRequest` enforces ONE budget
  shared across RSS, sitemap, AND article-body requests to the same hostname:
  a max in-flight `maxConcurrency`, a `minIntervalMs` minimum spacing between
  requests, and a per-UTC-day `dailyCeiling`. `0` on any knob means
  unlimited/disabled. It returns `admit` / `defer(reason)` / `paused(until)`.
- **Priority reservation (req4).** `effectiveConcurrencyLimit` reserves
  `incrementalReservedSlots` of `maxConcurrency` for the `incremental` tier, so
  `backfill` may only occupy `maxConcurrency − reservedSlots`; at least the
  reserved slots are ALWAYS available for new-article work. A backfill request
  blocked purely by that reservation defers with reason `reserved-for-incremental`.
- **Provider fairness (AC2).** `selectNextProvider` filters providers that are
  eligible (pending candidates > 0, under their daily quota) and orders them by
  `compareProviderFairness`: incremental tier first, then FEWEST in-flight (the
  anti-starvation lever), then OLDEST pending (FIFO within equal priority), then
  provider key. A busy provider therefore yields to a quieter one with ready
  incremental candidates.
- **Cost budgets (req5/req6).** `classifyCostBudget` tracks three INDEPENDENT
  daily ledgers — `discovery`, `body`, `ai`. `admitCostlyWork` defers body/AI
  work when its budget is exhausted, but `isAiBudgetExhausted` is advisory only:
  an exhausted AI/narration budget NEVER stops discovery or candidate
  persistence (explicit non-goal). Low-cost discovery keeps running and durable
  candidates accumulate; only the expensive downstream job defers until capacity
  returns, then the OLDEST real-time backlog resumes first.
- **Backoff / pause (AC3).** `applyResponseSignal` honors an explicit
  `Retry-After` (pause exactly that long, reason `retry_after`) and auto-pauses a
  hostname once a 429/403/5xx streak reaches `errorThreshold`, with a capped
  exponential window (`basePauseMs · 2ⁿ`, clamped to `maxPauseMs`). A success
  clears the streak and pause; non-throttle statuses (404/410) are left
  untouched. Reason codes are machine strings (`http_429`, `http_403`,
  `http_5xx`, `retry_after`) — never a URL.
- **Backlog throttle (req7).** `evaluateBacklog` compares the candidate backlog
  to a configured capacity threshold and, as it approaches, emits a
  throttle signal (reduce low-priority source frequency) and an alert signal.
  It NEVER deletes or drops candidates.

### Durable persistence + guarded increments (`rate-governor-commit.ts`)

Two small tables back the durable state; in-flight CONCURRENCY is deliberately
NOT stored (see tradeoff below):

- **`ScraperBudgetWindow`** — a per-`(scope, scopeKey, utcDay)` counter
  (`@@unique`), used for the hostname daily ceiling (`scope="hostname"`,
  `scopeKey=hostKey`), the provider daily quota (`scope="provider"`), and the
  three cost budgets (`scope∈{discovery,body,ai}_budget`, `scopeKey="global"`).
  Bucketing by UTC day means the window auto-resets at midnight with no sweeper.
  `scope` is a plain string (not a Prisma enum) so adding a budget kind needs no
  PostgreSQL `ALTER TYPE`.
- **`HostnameGovernorState`** — a per-`hostKey` row holding the cross-day
  `lastRequestAt` (min-interval anchor), `pausedUntil`, `consecutiveErrors`, and
  `lastFailureReason`. These MUST survive a UTC-day boundary and a worker
  restart, so they are separate from the daily counter.

Every increment is an idempotent `upsert` (INSERT..ON CONFLICT) — NEVER a
catch-P2002-inside-a-transaction (which would poison a PostgreSQL tx).
`reserveHostnameRequest` reads a snapshot, runs the pure decision, and — only on
`admit` — opens ONE interactive `$transaction` that re-reads host state,
re-validates pause + min-interval, atomically increments the day counter, then
GUARDS the daily ceiling on the NEW count (over → throw `ReservationConflictError`
→ rollback → return `defer`), and finally advances the `lastRequestAt` anchor. A
non-admit short-circuits WITHOUT a transaction, so no counter is spent on a
deferred request. `consumeCostBudget` and `consumeProviderQuota` use the same
increment-then-guard-then-rollback shape; `recordHostnameResponse` is a
standalone idempotent upsert of the pure backoff result.

### Durability tradeoff (documented)

**In-flight concurrency is ephemeral and derived, not stored.** It is computed
from currently-leased DiscoverySources (and, once #1095 lands, locked
`ARTICLE_INGEST` jobs) so it self-heals across a worker restart — a crashed
worker's lease expiry frees its slots automatically, with no stale mutable
counter to reconcile. The daily ceiling, provider quota, cost budgets,
min-interval anchor, and pause window CANNOT be derived and MUST persist, so they
live in the two tables above. The cost of this split is that in-flight is only as
accurate as lease/lock visibility (eventually consistent within a poll), which is
acceptable because the durable daily ceiling is the hard cap and the pure
concurrency check is a soft smoothing limit.

### Wiring & observability

`makeDiscoveryGovernorGate` (config layer) injects an OPTIONAL gate into
`runClaimedDiscoverySource`: before spending a fetch it calls
`reserveHostnameRequest`; a `defer`/`paused` reschedules the source to the
governor-supplied `nextRunAt` WITHOUT fetching and WITHOUT applying failure
backoff (a governed defer is not a failure), surfacing a new `deferred` run
outcome/stat. The gate defaults OFF, so the worker's behavior is unchanged until
the knobs are set. `deriveHostnameInFlight` counts a provider's currently-leased
sources (excluding self) for the shared concurrency input; `resolveHostKey` maps
a provider to its first owned hostname so discovery and body to one publication
share one budget. Body-fetch dispatch wiring and body in-flight derivation are
the #1095 hand-off boundary (see Deferred).

`observability.ts` surfaces the governor state for source health (AC4) WITHOUT
leaking URLs: `SourceMetricSummary` gains `hostPauseActive` / `hostPauseSeconds`
/ `hostPausedUntil` / `hostConsecutiveErrors` / `hostLastFailureReason`,
`discoveryBudgetExhausted` / `bodyBudgetExhausted` / `aiBudgetExhausted`, and
`backlogThrottleActive` / `backlogAlert` / `backlogUtilization`. An active
hostname pause flips a healthy source to `partial` status. All fields are counts,
timestamps, booleans, or machine reason codes.

### Configuration (`runtime-config/scraper.ts`)

Twelve new knobs, each with a documented default and individually overridable via
env; `0` means unlimited/disabled where that reading is natural:
`SCRAPER_HOST_CONCURRENCY`, `SCRAPER_HOST_MIN_INTERVAL_MS`,
`SCRAPER_HOST_DAILY_CEILING`, `SCRAPER_PROVIDER_DAILY_QUOTA`,
`SCRAPER_DISCOVERY_DAILY_BUDGET`, `SCRAPER_BODY_DAILY_BUDGET`,
`SCRAPER_AI_DAILY_BUDGET`, `SCRAPER_INCREMENTAL_RESERVED_SLOTS`,
`SCRAPER_BACKLOG_CAPACITY_THRESHOLD`, `SCRAPER_HOST_ERROR_PAUSE_THRESHOLD`,
`SCRAPER_HOST_PAUSE_BASE_MS`, `SCRAPER_HOST_PAUSE_MAX_MS`.

### Acceptance evidence

- **AC1 (shared hostname cap)**: concurrent RSS + sitemap + body reservations to
  one hostname never exceed the shared concurrency / min-interval / daily ceiling
  — fake-clock tests in `tests/scraper-rate-governor.test.ts` and the durable
  ceiling-rollback test in `tests/db/rate-governor.test.ts` (counter never
  exceeds the cap).
- **AC2 (no provider starvation)**: `selectNextProvider` / `compareProviderFairness`
  fairness + FIFO + quota tests in `tests/scraper-rate-governor.test.ts`, plus the
  durable per-provider quota guard in `tests/db/rate-governor.test.ts`.
- **AC3 (budget exhaustion keeps candidates durable & resumes oldest first)**:
  cost-budget exhaustion tests prove discovery + candidate persistence keep
  running while body/AI defer, and the oldest real-time backlog resumes before
  lower-priority work — `tests/scraper-rate-governor.test.ts`; the durable
  body-budget rollback is in `tests/db/rate-governor.test.ts`.
- **AC4 (backoff/pause/recovery visible without URLs)**: Retry-After +
  429/403/5xx pause + recovery pure tests, the durable pause/recovery test in
  `tests/db/rate-governor.test.ts` (asserts no URL persisted), and the
  observability field tests in `tests/scraper-observability.test.ts` (pause →
  `partial`, no URL in the summary).

### Deferred

Body-fetch DISPATCH wiring and per-provider/hostname BODY in-flight derivation
depend on the #1095 fetch/extract/Article-creation pipeline (the same hand-off
boundary as Phase 2.3). Phase 2.4 delivers the pure governor, the durable guarded
persistence, the discovery-path gate, observability, and the config knobs #1095
will consume; the Job payload carries only `{candidateId, processingVersion}`
today (no hostname/provider and no Job→CrawlCandidate relation), so body in-flight
cannot yet be derived by join and is left to #1095.

## Phase 2.5 — atomically save Article, candidate outcome & downstream jobs (#1095) — current

Phase 2.5 is the pivotal Phase-2 step every prior issue deferred: it turns ONE
fully-validated genuinely-new candidate into EXACTLY one **`DRAFT` public-library
Article** plus its required durable follow-up work (an `ARTICLE_PROCESS`
enrichment job) — **atomically**. It composes the pure resolver + thin guarded
persistence from #1092 rather than reinventing them.

### Where the work lives

- **`ingest-runner.ts` — `createIngestAttemptRunner(deps)`** builds the
  `runIngestAttempt` runner injected into the #1093 worker seam
  (`makeCandidateIngestHandler`). Per attempt it: re-reads the candidate + its
  discovery source (OUTSIDE any transaction), runs the **injected**
  fetch/extract/final-check seam (`prepareDraft`), resolves the trusted final
  identity via `applyFinalIdentity` (#1092), and — for a genuinely-new public
  identity ONLY (`kept`/`transferred`, no existing Article) — calls the atomic
  save. Expensive AI/narration is **not** run here; it is the asynchronous
  `ARTICLE_PROCESS` job the save enqueues. Optional providers keep their graceful
  fallback (AI/Speech/etc are never hard-required).
- **`article-save-commit.ts` — `saveIncrementalArticle(input)`** owns the single
  all-or-nothing `$transaction` (AC1). This is where the Article + candidate
  terminal state + downstream job are committed together or not at all.

### Fetch / extract OUTSIDE the transaction

Fetch, extraction, and every final CHECK (canonical, fingerprint, date-window,
source ownership, quality, access) are IMPURE and happen behind the injected
`prepareDraft` seam BEFORE any transaction opens. The seam returns a normalized
`PreparedDraft`: a ready `draft`, a transient/terminal `failure` outcome (which
#1093 classifies + schedules), or a deterministic non-saving `stop` (e.g. a
trusted outside-window date) — a stop creates NO Article and is NOT a retry.

### The save transaction (revalidate → create → link → enqueue)

Inside the single interactive `$transaction`, immediately before writing:

1. **Revalidate** by re-reading the candidate + source under the tx and guarding:
   the governing invariant (`articleId == null` and `observedInBaseline == false`;
   otherwise a `known-article-untouched` no-op — AC4), a saveable candidate status
   (already-terminal ⇒ idempotent `noop-terminal`), **provider ownership**
   (`expectedProviderKey`), and the **source activation generation** — lifecycle
   mode `ACTIVE`, `definitionVersion`, and the `activatedAt` marker all unchanged
   since extraction. A failed generation/ownership guard throws a deterministic
   `revalidation-failed` (`stale-generation` / `provider-mismatch`) that rolls the
   whole tx back — this IS the active→shadow stale-worker stop (AC3): the stale
   worker writes no Article and no job, and does **not** retry.
2. **Create** the ownerless `DRAFT` Article (`ownerId = null`,
   `status = DRAFT`, `sourceType = SCRAPED`) with its public source/canonical URL
   and extracted fields.
3. **Link** the candidate with a guarded `updateMany({ where: { id, articleId: null,
   observedInBaseline: false, status in SAVEABLE } })` → `INGESTED` + `articleId`
   + versioned prose fingerprint (never the prose). A zero-row count means a
   concurrent worker already saved it → throw so the Article insert rolls back too
   (no duplicate). This guarded update, in the SAME tx as the Article insert, is
   the effective serialization point.
4. **Enqueue** the deduplicated required `ARTICLE_PROCESS` job in the SAME tx via
   `enqueueArticleProcessInTx` (upsert on dedupe key `article-process:<articleId>`).

### Stop outcomes (create NO Article, NO downstream job)

Existing public identity / baseline (governing invariant), an alias loser or
canonical conflict or cross-provider body match (resolved upstream by
`applyFinalIdentity` → `known-article-untouched` / `noop-terminal` /
`routed-to-review`), a trusted outside-window date (a `prepareDraft` `stop`), and
a stale activation generation (`revalidation-failed`) each stop before any Article
is created. The runner returns `{ ok: true }` for every non-saving outcome so
#1093 does not schedule a spurious retry.

### Convergence after a race (never a duplicate, never a jobless candidate)

Idempotent writes use `upsert`; a `P2002` is **never** caught inside the
interactive tx (it poisons a PostgreSQL transaction). On the guarded-link race or
the Article `@@unique([sourceUrl, ownerId])` conflict, the tx rolls back and a
bounded standalone loop (`MAX_CONVERGENCE_RETRIES`) re-reads the winner: if this
candidate is now linked, it just ensures the winner's `ARTICLE_PROCESS` job and
returns `converged`; if the identity slot was won by a different candidate, it
attaches this one to the existing winner Article (guarded) and ensures the job.
Net guarantee: never a duplicate Article, never a saved candidate without its
required job.

### As-built decisions

- **Terminal status: reuse `INGESTED` (no new `SAVED`).** `INGESTED` already means
  "candidate → Article created" and is already in every terminal set
  (`worker/registry.ts`, `final-identity-commit.ts`); the governing-invariant guard
  keys on `articleId != null`. A distinct `SAVED` state carried no semantic value
  here and would have forced a 3-file schema-parity change plus terminal-set edits,
  so it was deliberately avoided.
- **No schema change.** The candidate-level #1092 body fingerprint (linked via
  `articleId`) already supports the cross-provider body-match stop, so no Article
  fingerprint columns were added.
- **AC4 — never update an existing Article.** No incremental path updates an
  existing Article's content even when the freshly-fetched body differs; the module
  only ever CREATES a new Article or CONVERGES onto an existing winner.

### Acceptance evidence

- **AC1 (all-or-nothing)**: a fault injected at EVERY commit write
  (`beforeArticleCreate` / `beforeCandidateLink` / `beforeJobEnqueue`) proves the
  Article, the candidate `INGESTED`+`articleId` link, and the `ARTICLE_PROCESS`
  job all roll back together — `tests/db/article-save-commit.test.ts`.
- **AC2 (one Article under concurrency)**: two concurrent workers on one winning
  candidate create exactly ONE Article, leave the candidate in ONE consistent
  terminal state, and ensure exactly ONE required job (the loser converges) —
  `tests/db/article-save-commit.test.ts`.
- **AC3 (stale generation writes nothing)**: an active→shadow flip, a
  definition-version bump, or a provider-ownership change between extraction and
  commit refuses the save (no Article, no job) — `tests/db/article-save-commit.test.ts`;
  the runner returns `{ ok: true }` (no retry) in `tests/scraper-ingest-runner.test.ts`.
- **AC4 (no update of a known Article)**: a candidate already linked to an Article,
  and a baseline-observed candidate, are left untouched even with a differing
  fetched body — `tests/db/article-save-commit.test.ts`.
- **Runner composition** (fetch failure vs stop vs known/baseline vs non-keep
  resolution vs kept/transferred save, provider-key and fingerprint propagation) —
  `tests/scraper-ingest-runner.test.ts`.

### Deferred

Production body-fetch DISPATCH (SSRF-safe fetch, the extractor, the quality/
date-window/access gates) and routing that fetch through the #1094 rate governor
(`reserveHostnameRequest` / `consumeCostBudget(kind:"body")`) land behind the ONE
injected `prepareDraft` seam and are a follow-up: the Job payload + ledger persist
only sanitized hashed identity keys (`{candidateId, processingVersion}`), **not a
fetchable URL**, so resolving a URL to fetch requires a separate URL-availability
change that is out of #1095's atomic-save scope. `createDefaultRegistry` therefore
leaves `runIngestAttempt` unset by default (preserving the existing hand-off
no-op) unless `candidateIngest.runIngestAttempt` is supplied. The atomic-save
transaction, revalidation guards, stop outcomes, convergence, and the in-tx
`ARTICLE_PROCESS` enqueue are all delivered here.

## Phase 2.6 — Gate trusted-provider auto-publication and optional enrichment (#1096) — current

Phase 2.5 lands every incrementally-ingested Article as an ownerless `DRAFT`.
Phase 2.6 decides which of those drafts may AUTO-publish (bypassing human review)
and which must stay in the existing review flow — and decouples that decision
from OPTIONAL enrichment so a degraded optional provider can never block a
publishable trusted article. It changes ONLY the publication gate; it introduces
no moderation product and provider trust is never self-granting (explicit
non-goals).

### Provider trust settings (three independent, default-OFF flags)

Three additive, metadata-only booleans on `DiscoverySource` (dual SQLite +
PostgreSQL migration `20260719200000_trusted_provider_publication`), all
`@default(false)` and deliberately SEPARATE — a permission never implies another:

- **`canFetchAuthenticated`** — permission to fetch the source WITH credentials.
  Grants access only; it NEVER contributes to publication (it is not even an
  input to the policy).
- **`canRepublishPublicly`** — permission to republish the source's content in
  the PUBLIC library (source-ownership / republication rights).
- **`autoPublishTrusted`** — explicit trust to auto-publish a validated draft
  without human review. It CANNOT be granted by the fetch or republish flags
  alone; auto-publication requires this flag AND `canRepublishPublicly`.

They are booleans only — never a credential, cookie, URL, or article content.

### The pure publication policy

`src/lib/processing/publication-policy.ts` is a PURE module (no DB,
network, or clock) in the house `classify.ts`/`exit-gates.ts` style. It lives in
`lib/processing` (the publish gate's owner) rather than `lib/scraper` to respect
the one-way processing↛scraper module boundary.
`decideIncrementalPublication(input)` returns `"auto-publish"` or
`"leave-in-review"` plus a machine reason code, evaluating in a fixed
short-circuiting order (most-significant blocker first):

1. `autoPublishTrusted` false ⇒ `provider-not-auto-publish-trusted` — an
   untrusted provider ALWAYS yields a reviewable draft (AC1).
2. `canRepublishPublicly` false ⇒ `public-republication-not-permitted` —
   authenticated access alone can NEVER make content public (AC3).
3. Any required check false ⇒ `required-check-failed:{body-quality,
   content-safety,source-ownership,mandatory-metadata}`.
4. Required enrichment incomplete ⇒ `required-enrichment-incomplete`.
5. Only all-true ⇒ `auto-publish` (`all-required-checks-passed`).

`resolveProviderTrust(candidates)` aggregates trust across ALL linked candidates
CONSERVATIVELY: a permission is granted only when there is ≥1 candidate and every
candidate resolves to a source that grants it — a single orphaned
(`source == null`, deleted via `onDelete: SetNull`) or untrusted candidate
withholds the grant, so a stray alias/transfer can never upgrade an article.
`resolveSourceOwnershipOk(candidates)` requires every candidate's resolved source
`providerKey` to match the candidate's own (an intact ownership chain).

### Wiring the gate (`processor.ts`)

`publishDraftIfReady` is now provider-trust-aware. `loadArticleState` additionally
selects `crawlCandidates` (+ their source trust), `wordCount`, `content`, and
`sourceUrl`. At publish time:

- **Already published** ⇒ no-op (`skipped`).
- **Non-incremental** drafts (NO linked candidate — manual/imported/`text-import`)
  PRESERVE the legacy behavior exactly: publish when every step succeeded.
- **Incremental provider** drafts consult the pure policy. The four required
  checks are computed in-pipeline and CONSERVATIVELY (any unverifiable signal ⇒
  `false` ⇒ stay draft): `bodyQualityOk` = `wordCount >= MIN_WORD_COUNT`;
  `contentSafetyOk` = `moderateText(content)` not flagged (screened IN MEMORY —
  the content string is never logged or persisted); `sourceOwnershipOk` =
  intact candidate→source chain; `mandatoryMetadataOk` = title + sourceUrl + body
  present. On `auto-publish` the draft flips to `PUBLISHED` (publishedAt = now)
  and `revalidateArticlesCache()` fires EXACTLY ONCE on that state change;
  otherwise the draft stays put and records a `skipped` publish step whose detail
  is the machine reason code (never sensitive content).

### Optional enrichment is decoupled from publication

Publication now depends on `requiredEnrichmentComplete` — computed from the
REQUIRED registry features only (`FEATURE_REGISTRY.filter(isRequired)` =
difficulty, tags, vocabulary, quiz; a step counts as complete when its status is
not `failed`). Optional enrichment (translation, TTS) is excluded, so a failed or
degraded optional provider leaves a visible, retryable `failed`/`fallback` step
WITHOUT rolling back the Article or blocking a publishable trusted article
(requirements 4 & 6). The run-level `ok`/job-retry semantics are unchanged, so an
optional step remains independently retryable via the existing job.

### Privacy

Every publication signal is a machine code, count, or boolean. No prompt,
response, article text/prose, translation, definition, or credential is written
to Job errors, processing metadata, audit metadata, or logs (AC4); content is
screened in memory only.

### Acceptance evidence

- **Policy matrix** — the full trusted/untrusted × republish × required-check ×
  required-enrichment truth table (only the all-true row auto-publishes), trust
  aggregation, and source-ownership resolution — `tests/processing-publication-policy.test.ts`.
- **Gate wiring** — trusted auto-publish (+ revalidate exactly once), untrusted
  stays in review, authenticated-only never publishes, failed OPTIONAL (TTS) does
  not block a publishable article, failed REQUIRED (quiz) keeps it in review,
  unsafe/too-thin body and orphaned source chains stay in review, already-published
  no-op, and non-incremental legacy preservation — `tests/processing-publication-gate.test.ts`.
- **Persistence + visibility** — the three flags default false and persist, and a
  public DRAFT is hidden from the public listing and becomes listable exactly on
  the publish state change — `tests/db/publication-gate.test.ts`.

### Deferred

Remote content-safety moderation (e.g. Azure AI Content Safety behind
`isRemoteModerationEnabled`) remains a heuristic-only screen here — layering in a
provider endpoint is a separate follow-up and does not change the gate contract. A
per-provider admin UI to toggle the three trust flags is Phase 3 operator work; the
flags land as durable schema in Phase 2.6.

## Phase 2.7 — Explicit incremental mode + rollback (#1097) — current

Phases 1–2.6 built the ledger, the claimed-source discovery loop, the atomic
candidate/Article commit, and the trusted-publication gate — but the NORMAL
operator entry points still ran the LEGACY synchronous path: the admin provider
trigger and the provider CLI looped `discoverProviderUrls` +
`scrapeAndSave`/`scrapeProvider`, fetching and re-saving bodies for URLs a
provider lists TODAY. That path can rescrape a KNOWN public Article and so
violates the governing invariant. Phase 2.7 closes those legacy paths and moves
normal operator actions onto the candidate ledger by default, and adds the
active→shadow rollback that fails in-flight work closed while RETAINING the
ledger. It implements ONLY `incremental`; `backfill` and `force-rescrape` are
defined but rejected explicitly (Phase 3, non-goals here).

### Explicit trigger-mode taxonomy

`src/lib/scraper/incremental/trigger-mode.ts` is a PURE module (no DB, network,
or clock) defining the operator-facing mode taxonomy:

- `TRIGGER_MODES = ["incremental", "backfill", "force-rescrape"]` — every
  DEFINED mode, so the taxonomy is stable and the API/CLI can name a deferred
  mode when rejecting it.
- `DEFAULT_TRIGGER_MODE = "incremental"` — the mode when a trigger omits `mode`.
- `IMPLEMENTED_TRIGGER_MODES = ["incremental"]` — the only mode wired here.

`validateTriggerMode(input)` returns `{ ok: true, mode }` for `incremental`, an
`unknown-mode` rejection for anything not in `TRIGGER_MODES`, and a typed
`not-implemented` rejection (naming the mode) for `backfill`/`force-rescrape`.
Combined with the route's object schema dropping unknown keys, a normal trigger
input CANNOT smuggle a bypass/force flag and CANNOT fall through to old
synchronous behavior (AC1/AC3).

### Requesting an incremental run (no synchronous fetch/save)

`src/lib/scraper/incremental/incremental-run-request.ts` `requestIncrementalRun(
providerKeys, now)` is the thin persistence op the NORMAL path now uses instead
of discover-and-save. It marks the providers' CLAIMABLE-mode discovery sources
(`SHADOW`/`BASELINE`/`ACTIVE`) DUE (`nextRunAt = now`) so the worker's discovery
loop (`runDiscoveryLoop` → `claimDueDiscoverySource` → `runClaimedDiscoverySource`)
picks them up and runs bounded, ledger-based discovery pages; bodies are fetched
LATER by the candidate-ingest job pipeline. It never fetches a body, never writes
an Article, never changes a source's lifecycle/lease/watermark, and never wakes a
`DISABLED`/`PAUSED`/`RETIRED` source (those need an explicit lifecycle action) —
so a trigger can neither resurrect a stopped source nor rescrape a known Article.
It returns `{ requested }` (sources woken); only provider keys, counts, and
timestamps cross the seam.

### Admin trigger + route

`src/lib/scraper/admin-trigger.ts` `runAdminScrapeTrigger` validates the trigger
mode (rejecting unimplemented modes via `AdminScrapeTriggerModeError`), the
provider selection and bounded limit (`ADMIN_SCRAPE_TRIGGER_DEFAULT_LIMIT = 5`,
`ADMIN_SCRAPE_TRIGGER_MAX_LIMIT = 50`, reused from the legacy path), calls
`requestIncrementalRun` per selected provider, and writes an AUDIT record with
controlled machine fields only (mode, provider keys, counts, phase — never a URL
or article content). `src/app/api/admin/scrape/trigger/route.ts` accepts an
optional `mode` (`oneOf(TRIGGER_MODES)`, default `incremental`) alongside the
existing `provider`/`all`/`limit`, maps trigger input/mode errors to `400`, and
returns `{ ok, mode, results, totalSourcesRequested, note }`. The route keeps its
existing scrape/source capability + admin auth (`createCapabilityHandler`); the
regenerated API catalog reflects the new `mode` field.

### Private single-URL intake stays separate (non-goal to remove)

`src/app/api/admin/articles/ingest/route.ts` (the authorized single-URL private/
user import via `scrapeAndSave(url, …)`) is DELIBERATELY untouched. It is not a
public-provider workflow and is not routed through public candidate uniqueness or
the baseline/candidate identity gate — direct private intake remains available.

### Provider CLI moves to incremental

`scripts/scrape-provider.ts` normal commands (`scrape`, `resume`) now call an
incremental-run request (`runIncrementalRequest` → `requestIncrementalRun`) and
validate the mode via the same taxonomy; the synchronous worker-pool
(`runScrape`) and its `scrapeAndSave`/`closeBrowser`/`recordCrawlRun` imports are
REMOVED, so old direct provider scraping is unreachable from a normal command
(proven by a CLI contract test that scans the source for the removed symbols).
`--mode` defaults to `incremental` and help text documents it. The dev/one-off
scripts (`scrape.ts`, `scrape-undark.ts`, `scrape-smithsonian.ts`,
`scrape-reading-sources.ts`, `scrape-review.ts`, `build-quality-corpus.ts`, and
`src/lib/seed.ts`) are explicitly-authorized tools, not normal operator actions,
and are left as-is.

### Active→shadow rollback (fail closed, retain the ledger)

`src/lib/scraper/incremental/rollback-commit.ts` `rollbackActiveToShadow(sourceId,
now)` backs the admin `rollback` lifecycle action when a source is ACTIVE. In ONE
guarded transaction it:

1. Transitions ACTIVE → SHADOW and PARKS scheduling (`nextRunAt = null`) so the
   discovery loop stops claiming the source and no new candidate ingest work is
   enqueued (SHADOW discovery is observe-only anyway).
2. INCREMENTS `activationGeneration` (a new `Int @default(0)` column on
   `DiscoverySource`, dual SQLite + PostgreSQL migration
   `20260719220000_source_activation_generation`).
3. Cancels the source's UNCLAIMED (`PENDING`) candidate-based `ARTICLE_INGEST`
   jobs.

Candidates and observations are PRESERVED, so a later explicit `activate` can
deterministically requeue eligible shadow candidates (requirement 6). The read
happens before the transaction; the interactive `$transaction` re-validates
lease/`definitionVersion`/mode via a guarded `updateMany({ where: { id,
lifecycleMode: ACTIVE, leaseOwner: null, definitionVersion } })` — a zero-row
update (a worker claimed the source, the definition changed, or a concurrent
rollback won) throws and rolls the whole write back, so two rollbacks can never
double-apply. A source under an active discovery lease is refused (`busy`) rather
than raced. Only ids, modes, counts, and a sanitized reason code are logged.

### How the two fail-closed mechanisms dovetail with #1095's guard

`revalidateSourceGeneration` (in `article-save-commit.ts`) runs INSIDE the
Article save transaction. It captures a `{ definitionVersion, activatedAt,
activationGeneration }` snapshot at context-load time and, at commit, throws
`stale-generation` (→ rollback, NO Article) when the source is missing, its
`lifecycleMode !== ACTIVE`, its `definitionVersion` changed, its `activatedAt`
changed, OR its `activationGeneration` changed. So:

- A CLAIMED/RUNNING body-fetch job in flight at rollback time is NOT cancelled;
  it fails closed at commit because the source is now SHADOW (`lifecycleMode !==
  ACTIVE`).
- The `activationGeneration` bump adds the piece the mode check alone can't
  cover: a job whose snapshot predates the rollback ALSO fails closed after a
  LATER re-activation (which restores `ACTIVE` but leaves the generation bumped),
  so stale pre-rollback work can never commit an Article across an
  activate→rollback→activate cycle.

### Job cancellation without a new status

`JobStatus` has no `CANCELLED`. `src/lib/jobs/candidate-ingest-cancel.ts`
`cancelPendingCandidateIngestJobsInTx` reuses the existing `cancelJob()`
convention: it moves the source's `PENDING` candidate-ingest jobs to the terminal,
non-claimable `DEAD_LETTER` with the controlled reason `ROLLBACK_CANCELLED_REASON
= "rollback-cancelled"`, guarded on `status = PENDING`. The Job model has no FK to
a candidate, so jobs are matched by the deterministic dedupe-key prefix
`article-ingest:candidate:` and filtered to the source's candidate ids via their
candidate-identity-only payloads. A job a worker claims concurrently is skipped by
the guard and instead fails closed at commit via the generation guard. Candidates
and observations are untouched.

### Acceptance evidence

- **Admin route** — auth, provider/mode validation, incremental enqueue,
  `backfill`/`force-rescrape`/unknown-mode explicit rejection (`400`), audit
  metadata carries no URLs, security event, and `all: true` —
  `tests/admin-scrape-routes.test.ts`.
- **CLI contract** — default mode `incremental`, explicit `--mode`, and a
  source scan proving `scrapeAndSave`/`runScrape` are gone and
  `requestIncrementalRun`/`runIncrementalRequest` present —
  `tests/scrape-provider-cli.test.ts` and `tests/scripts-scrapers.test.ts`.
- **Rollback + generation** — active→shadow rollback parks scheduling, bumps the
  generation, and cancels PENDING candidate ingest jobs while retaining the
  ledger (`tests/db/lifecycle.test.ts`), and a save whose generation snapshot
  predates a rollback fails closed with NO Article
  (`tests/db/article-save-commit.test.ts`).

### Deferred

`backfill` (bounded historical re-discovery under a separate budget) and
`force-rescrape` (explicit operator refresh of a KNOWN Article) are defined in
the taxonomy but rejected explicitly here; both are Phase 3 (epic #1080) work.
Production body-fetch dispatch remains the injected `prepareDraft` seam from
Phase 2.5.

## Phase 2.8 — Roll out public providers in measured batches (#1098) — current

Phases 2.5–2.7 built the atomic Article save, the activation-generation guard,
and the active→shadow rollback. Phase 2.8 makes it SAFE to enable REAL body
ingestion for public providers *gradually*: expand only while a metadata-only
set of rollout gates stays green, and prove the three canaries under load before
widening. This issue is heavily OPERATIONAL; the code deliverables below make a
measured rollout **possible and safe**, and the live-operation parts are called
out explicitly under "Deferred to live operation" — they are honest follow-ups,
not fabricated evidence.

### Rollout-gate model (`rollout-gates.ts`)

A PURE evaluator (no DB/network/clock; takes `now` + a metadata-only snapshot),
modeled on the Phase-1.10 `exit-gates.ts`. It reuses the #1089
`SourceMetricSummary`, the #1090 `ReconciliationResult`, and controlled count
inputs, and returns a per-gate pass/fail with a **go / hold** verdict. Every
`detail` is a controlled count/label/enum — never a URL, body, secret, or article
text (AC4). The eight gates, with explicit named thresholds at the top of the
module:

| Gate | Class | Bound |
| --- | --- | --- |
| `discovery-latency` | advisory | p90 publication→discovery lag ≤ `MAX_DISCOVERY_LAG_SECONDS` **and** last completed run age ≤ `MAX_DISCOVERY_RUN_AGE_SECONDS` (fails closed when the source never ran) |
| `no-old-item-false-positives` | **blocking** | `=== 0` (governing invariant: never revive a known identity) |
| `no-duplicate-work` | **blocking** | `=== 0` (no duplicate ingest jobs / Articles per identity) |
| `queue-health` | advisory | worker queue depth ≤ `MAX_QUEUE_DEPTH` and oldest pending age ≤ `MAX_QUEUE_AGE_SECONDS` |
| `retry-quarantine-rate` | advisory | retry rate ≤ `MAX_RETRY_RATE`, quarantine rate ≤ `MAX_QUARANTINE_RATE` |
| `no-unexplained-gaps` | **blocking** | reconciliation `unexplainedMisses === 0` |
| `provider-http-health` | advisory | source health not DEGRADED/FAILING/BLOCKED and no active host pause |
| `cost-budget` | advisory | within per-run discovery budget + per-day body-ingestion budget, no governor budget exhaustion, no `spike` volume anomaly |

The three **blocking** gates are correctness HARD ZEROS — never relaxed to make a
source pass (explicit non-goal). The verdict is `go` only when EVERY gate passes;
`blockingFailures` and `advisoryFailures` are surfaced separately so an operator
sees which reds are absolute correctness stops versus tunable-threshold warnings.

### Batch / tier configuration (`rollout-batches.ts`)

A DATA-ONLY declarative module (house convention, mirrors `canaries.ts`).
Rollout is grouped into ordered batches by discovery STRATEGY / RISK class, so a
framework defect (present across every channel) is distinguishable from a
provider-adapter defect (isolated to one channel), with LOW per-day
body-ingestion + downstream-work limits that ramp up across tiers:

| Order | Batch | Risk class | Per-day body cap | Concurrent |
| --- | --- | --- | --- | --- |
| 0 | `tier-0-canaries` | canary (all three channels) | 25 | 3 |
| 1 | `tier-1-rss` | RSS (trusted feed date) | 100 | 5 |
| 2 | `tier-2-sitemap` | sitemap (trusted `<lastmod>`) | 250 | 8 |
| 3 | `tier-3-seed-html` | seed-HTML (untrusted date) | 500 | 8 |

The **first** batch is exactly the three Phase-1 canaries. Expansion batches
(1–3) carry the tier limits and risk class but start EMPTY of additional members:
operators append public same-channel sources, each of which still passes its OWN
baseline → shadow acceptance. `tier-3-seed-html` carries the highest cap safely
because untrusted-date drafts NEVER auto-publish (Phase 2.6) — they all land as
review-required drafts, so ingest volume carries no publication risk. Pure guards
enforce the safety invariants: `assertNoBatchSkipsBaseline` (registry sync alone
can never activate a member — the `autoActivate: false` literal + runtime check),
`assertNoAuthenticatedProviderInBatch` (authenticated providers are excluded from
every public batch — auth is #1099's scope), and `assertBatchesOrdered` (a batch
never skips ahead of an earlier, less-proven tier).

### Acceptance matrix (`evaluateActivationReadiness`, in `rollout-gates.ts`)

A pure, FAIL-CLOSED predicate (mirrors `canary-exit-gate-eval.ts`) run **before
every batch** (AC1). It checks that each provider activation has attached
baseline evidence, a passing shadow exit-gate verdict, an explicit operator
approval, an active definition version, configured per-run + per-day budgets, and
a named rollback owner. Absent evidence (`null`) fails the requirement — a source
with no attached evidence is never ready. Operator identities (approver, rollback
owner) are reported as presence flags only, never echoed into details.

### Rollback drill (AC3, `tests/db/rollout-rollback-drill.test.ts`)

The key testable AC — "a rollback drill proves no stale task can write an Article
after mode generation changes" — exercised end-to-end against the live database
(engine-agnostic; runs on SQLite and PostgreSQL, `{ skip: !enabled }`). The drill
ties together #1097 `rollbackActiveToShadow` and #1095's activation-generation
guard: (1) set up an ACTIVE source at generation N and capture the in-flight
task's snapshot; (2) roll ACTIVE → SHADOW → generation N+1, the PENDING
candidate-ingest job is DEAD_LETTERed and candidates/observations are preserved;
(3) the STALE in-flight task's save with the generation-N snapshot is REJECTED
(`revalidation-failed` / `stale-generation`) — no Article written, candidate
untouched; (4) a fresh task at generation N+1 in the correct (re-activated) mode
saves exactly one Article.

### Rollback triggers

A red **blocking** gate (`no-old-item-false-positives`, `no-duplicate-work`,
`no-unexplained-gaps`) is an active→shadow rollback trigger: it means a
correctness invariant has been violated, so the source must stop ingesting
immediately (the admin/CLI `rollback` path from #1097 flips ACTIVE → SHADOW,
bumps the generation, and cancels PENDING ingest jobs; in-flight jobs fail closed
at commit via the generation guard). A red **advisory** gate holds expansion —
the current tier is paused and the next batch is not started until the threshold
is back within bounds — but does not by itself force a rollback unless it
persists or is paired with a blocking failure.

### Final public-provider coverage + intentionally disabled sources

- **Covered by rollout:** the three unauthenticated Phase-1 canaries (RSS —
  The Conversation; sitemap — Works in Progress; seed-HTML — Undark) form
  `tier-0`, then per-channel expansion frames (`tier-1-rss`, `tier-2-sitemap`,
  `tier-3-seed-html`) into which operators add public same-channel sources under
  ramping caps, each gated through its own baseline → shadow acceptance.
- **Intentionally DISABLED:** authenticated / credentialed providers are excluded
  from every public batch (deferred to #1099 and enforced by
  `assertNoAuthenticatedProviderInBatch`). Seed-HTML sources (untrusted per-item
  date) remain publication-disabled by the Phase-2.6 gate — they ingest as
  review-required drafts and never auto-publish. `backfill` / `force-rescrape`
  refresh of KNOWN Articles stays out of scope (Phase 3, #1080).

### Deferred to live operation (follow-up)

This issue is heavily operational; the following CANNOT be executed without live
providers running under real load and are **honest follow-ups**, not done here:

- Actually STARTING the canaries (and later batches) ingesting bodies under real
  provider load, and observing real publication cycles at each tier.
- Attaching real dashboards / metadata reports and feeding the live
  `SourceMetricSummary` + reconciliation into `evaluateRolloutGates` on a cadence.
- Recording live go / no-go decisions per batch (the acceptance matrix is
  automated; the human sign-off + approval evidence is captured operationally).
- Live smoke checks and soak observation before widening each tier.

No live-operation evidence is fabricated in this PR. It is recommended these
operational steps be filed as a separate follow-up issue.

## Phase 2.9 — credentialRef-based authenticated provider ingestion (#1099) — current

Phase 2.9 closes epic #1079. It lets a source be fetched with a
**project-authorized** provider credential **without ever persisting a secret**,
and without confusing *access* permission with *public republication* rights.
The governing invariant is unchanged: normal incremental ingestion only acts on
identities first observed AFTER a completed baseline and NEVER auto-refetches a
known public Article. Authenticated sources are **not special-cased** around any
correctness gate — the same hostname limits (#1094), baseline/shadow gates
(#1088/#1090), candidate uniqueness (#1092), and no-old-article-refresh invariant
apply exactly as for public sources.

### Secret-free schema (`DiscoverySource`)

Two SECRET-FREE, metadata-only columns are added (dual-engine migration
`20260720010000_source_credential_ref`, identical additive nullable DDL for
SQLite + PostgreSQL):

- `credentialRef String?` — a stable NAME/handle (an env-var key or secret-store
  key), NEVER the secret value, a token, a signed URL, or an Authorization
  header. Because only the handle is stored, rotating the secret behind a fixed
  `credentialRef` requires NO candidate/job rewrite (AC2).
- `authIdentityKind String?` — how the source's items are identified:
  `stable-provider-id`, `canonical-url`, or `signed-url-only`. Only the two
  STABLE, secret-free kinds may be activated for automatic incremental ingestion.

These join the #1096 `canFetchAuthenticated` / `canRepublishPublicly` /
`autoPublishTrusted` booleans; all default false and are independently granted.

### In-memory secret resolution (`credential-resolver.ts`)

The worker-side resolver seam is the ONLY place a `credentialRef` becomes live
auth material, and it does so **in memory, per request**. `resolveCredential`
(the injectable `CredentialResolver` interface) returns either an Authorization
header value / a signed URL, or a sanitized failure status
(`missing` | `expired` | `rotated`). The resolved header/URL is returned to the
caller and NEVER written to a candidate, alias, observation, Job, CrawlRun,
audit metadata, log, or error (AC1). The default `EnvCredentialResolver` reads
from an approved env-based store (a missing/empty value ⇒ `missing`); tests inject
a FAKE resolver returning a sentinel secret or a scripted status — never a real
secret. Rotation is modeled by mutating the secret behind a fixed handle.

### Secret-free identity requirement (AC3, `credential-policy.ts`)

The PURE `decideAuthenticatedActivation` (no DB/network/clock; plain inputs →
sanitized enum) gates activation for an authenticated source: it must carry a
STABLE secret-free identity AND a `credentialRef`. A source whose items are
identified ONLY by rotating signed URLs (`signed-url-only`, or an unspecified
kind) is REFUSED — a signed URL cannot key candidate uniqueness or the
no-refresh invariant. This is wired into `activateDiscoverySource` (the single
code path to ACTIVE), so no shortcut can bypass it; the admin lifecycle route
maps the refusal to a client-safe `auth-identity-ineligible` (409).

### Pause only the affected source on credential failure (requirement 6)

When the resolver reports a missing/expired/rotated credential, the body-fetch
seam (`prepareAuthenticatedFetch`) returns a sanitized `CredentialPauseCategory`
(`credential-missing` | `credential-expired` | `credential-rotated`), and
`pauseSourceForCredentialFailure` PAUSES ONLY that source under the same guarded
(lease + definitionVersion) update the discovery run uses — flipping it to
PAUSED, clearing `nextRunAt`/lease, marking health FAILING, and recording the
sanitized category in `lastError`. It touches nothing else: candidates, aliases,
observations, Jobs, and other sources are untouched (an article is never marked
absent or policy-rejected). Resuming reuses the existing PAUSED lifecycle
(`resume` → SHADOW when the baseline is complete); after the secret is rotated
behind the fixed handle the source resumes cleanly with no candidate/job rewrite.

### Fetch permission ≠ publication rights (AC4)

Authorization to fetch WITH credentials (`canFetchAuthenticated`) is a SEPARATE
grant from public republication (`canRepublishPublicly`). Fetch permission alone
NEVER makes an Article public: the #1096 pure publication gate
(`decideIncrementalPublication`) keeps an authenticated-but-not-republishable
draft in human review (`public-republication-not-permitted`). `credential-policy`
deliberately does NOT re-decide publication and does NOT import
`lib/processing` — the one-way `scraper ↛ processing` module boundary is
preserved; publication stays owned by the processor.

### Redaction

`redactUrlForLog()` (which strips userinfo, the entire query string — where
signed-URL tokens live — and the fragment) remains the foundation; every auth
fetch log/error routes URLs through it (`redactErrorForSource`), and the resolver
seam never logs the secret or the `Bearer …` header value. Only the
`credentialRef` NAME and sanitized categories/counts ever persist or log.

### Acceptance evidence

- **AC1** (secret scan): `tests/db/credential-authenticated-ingestion.test.ts`
  runs an authenticated flow (success + failure) and asserts a sentinel secret,
  `Bearer …`, and the signed-URL token/host appear in NO DiscoverySource /
  candidate / alias / observation / Job / CrawlRun row, Job payload, or captured
  log — while the `credentialRef` NAME + sanitized category DO persist.
- **AC2** (rotation): the same suite rotates the secret behind a fixed
  `credentialRef` and asserts the candidate + Job are byte-unchanged and the
  paused source resumes cleanly. `tests/scraper-credential-resolver.test.ts`
  proves the resolver seam at the unit level.
- **AC3** (identity): the DB suite refuses to activate a `signed-url-only` source;
  `tests/scraper-credential-policy.test.ts` covers every eligibility branch.
- **AC4** (publish): `tests/scraper-credential-policy.test.ts` proves an
  authenticated-but-not-republishable draft stays in review via the #1096 gate.

### Deferred (follow-up)

Honest scope, unchanged from #1095: the production body-fetch runner
(`runIngestAttempt`) is OFF by default because the ledger stores hashed identity
keys, not fetchable URLs. Phase 2.9 therefore delivers a TESTED RESOLVER SEAM +
its activation/pause guards + redaction, wired at `prepareAuthenticatedFetch`,
awaiting the production body-fetch dispatch (the same follow-up called out in
Phase 2.5). No end-to-end authenticated body ingestion is claimed here.

## Phase 3.1 — candidate review & explicit source trust promotion (#1100) — current

Phase 3.1 lets an authorized operator decide uncertain new identities and
EXPLICITLY promote a proven sitemap/HTML source, WITHOUT any automatic trust
escalation. It upholds the governing invariant on both edges: approval routes a
candidate through the NORMAL version/dedupe candidate pipeline (it never
refetches, updates, or revives a known public Article), and promotion is an
operator action the metrics only ever REPORT — never trigger.

### Rejection state (`SKIPPED_REVIEW`)

A new `CrawlCandidateStatus` value, `SKIPPED_REVIEW`, is the terminal, no-Article
resting state recorded when an operator EXPLICITLY rejects a `NEEDS_REVIEW`
candidate. It is deliberately distinct from `REJECTED` (a provider-driven
permanent 410 / access restriction) and `SKIPPED` (a policy/frontier skip):
`SKIPPED_REVIEW` is a recorded HUMAN decision that ordinary rediscovery/ingest
NEVER re-enqueues, and that only the separate audited reactivate action can
return to `NEEDS_REVIEW`. Dual-engine parity: SQLite stores the enum as TEXT (a
comment-only migration), PostgreSQL adds it with a standalone
`ALTER TYPE "CrawlCandidateStatus" ADD VALUE 'SKIPPED_REVIEW'` (enum values
cannot be added inside a transaction), matching the #1093 precedent.

### Pure policies (no DB/network/clock)

- `candidate-review-policy.ts` — `decideCandidateReview({ action, status,
  hasArticle })` returns `apply` (legal transition + whether to enqueue ingest),
  `noop` (idempotent — the action's effect already holds), or `illegal`. The
  state machine: `NEEDS_REVIEW --approve--> QUEUED` (+ normal candidate ingest
  job), `NEEDS_REVIEW --reject--> SKIPPED_REVIEW` (terminal, never rediscovered),
  `SKIPPED_REVIEW --reactivate--> NEEDS_REVIEW`. A linked Article (`hasArticle`)
  HARD-BLOCKS every action (`illegal: has-article`) — the governing invariant.
  `reject`/`reactivate` are policy-sensitive and REQUIRE an audit reason.
- `source-trust-policy.ts` — `computeSourceTrustEvidence` rolls up sample size,
  accepted/review-rejected counts, approval rate, old-item false-positive
  rate, and drift; `decideSourceTrustEligibility` REPORTS hard blockers
  (`insufficient-sample`, `insufficient-decisions`, `low-approval-rate`,
  `old-item-false-positive`, `active-drift`) and soft warnings, but NEVER
  promotes; `decideSourceTrustDemotion` decides drift/anomaly auto-demotion. An
  old-item false positive (a pre-baseline identity that became work) is a hard,
  zero-tolerance blocker AND a demotion trigger.

### Thin guarded persistence

- `applyCandidateReview` re-reads state, applies the pure decision inside a
  single interactive `$transaction` with a guarded `updateMany({ where: { id,
  status, articleId: null } })` (a zero-row match throws → rollback → re-read →
  idempotent re-decide). Approval enqueues the SAME idempotent
  `article-ingest:candidate:<id>:v<version>` Job the discovery loop uses, in the
  same transaction, so approving twice creates EXACTLY ONE active Job (AC1): the
  second call re-reads `QUEUED` and the policy returns a no-op that enqueues
  nothing. Rejection stamps `SKIPPED_REVIEW` + a sanitized `terminalReason`
  category; reactivation is the separate `SKIPPED_REVIEW → NEEDS_REVIEW` edge.
- `promoteSourceTrust` / `demoteSourceTrust` reuse the existing DiscoverySource
  `autoPublishTrusted` flag, which is ALREADY version-scoped because the row is
  unique per `(providerKey, sourceKey, definitionVersion)`. A guarded
  `updateMany` matches only a row whose lease is free and whose
  `definitionVersion` + current flag equal the expected values (a re-versioned or
  busy source is refused). Promotion is idle-guarded AND eligibility-gated — it
  refuses unless the pure eligibility report is clear (metrics never auto-promote;
  an old-item false positive can never be trusted). A manual demote clears only
  the flag (the operator has a separate lifecycle rollback action).
- `evaluateAndApplyTrustDemotion` runs in the discovery-run finalizer under the
  worker's own lease: on a TRUSTED source, a configured drift/anomaly clears the
  trust flag AND (for an `ACTIVE` source) rolls it back to `SHADOW` via the
  guarded `transitionDiscoveryLifecycle`, which PRESERVES all candidate /
  checkpoint / watermark history (AC3). It early-outs cheaply on an untrusted
  source and NEVER throws (a fault is caught + logged so the discovery loop
  cannot break). A rediscovery guard in `commitClassifiedItem` (enqueue gated on
  a freshly-created `DISCOVERED` candidate) is a belt-and-suspenders backstop so
  a re-observed `SKIPPED_REVIEW`/terminal candidate is never requeued.

### Capability-gated endpoints (all `sources.manage`, deny-by-default + CSRF)

- `GET /api/admin/candidates` — filtered, paginated review queue (default
  `NEEDS_REVIEW`, also `SKIPPED_REVIEW`); sanitized provenance DTOs only.
- `GET /api/admin/candidates/{id}` — one sanitized candidate + conflict history.
- `POST /api/admin/candidates/{id}/review` — one idempotent approve/reject/
  reactivate; outcome→HTTP: applied/noop `200`, not-found `404`, illegal/stale
  `409` (`stale: true` for the stale-candidate UI state).
- `POST /api/admin/candidates/review` — bounded batch (≤100, de-duplicated); a
  PARTIAL-BATCH per-item result array + summary (always `200`), each item
  processed independently.
- `GET` / `POST /api/admin/discovery-sources/{id}/trust` — trust snapshot
  (policy + evidence + REPORTED eligibility) and the explicit, version-scoped,
  reversible promote/demote.

Every state-CHANGING mutation writes a sanitized audit entry via one of the new
`AUDIT_ACTIONS` (`adminCandidateReview`, `adminCandidateReactivate`,
`adminSourceTrustPromotion`): ids, from/to state, counts, before/after policy,
reason CATEGORY, and a flattened evidence summary — NEVER a URL, body, secret, or
article content. Idempotent no-ops write NO audit. The candidate ledger stores
only versioned identity HASHES (`<version>:<sha256hex>`), so the review DTOs are
sanitized by construction. (The admin UI is Trinity's half — this phase delivers
the data, states, and API contract it renders against.)

### Deferred (follow-ups)

An open `CanonicalConflict` is NOT auto-resolved when its `NEEDS_REVIEW`
candidate is approved/rejected — conflict resolution stays a separate concern.
Promotion has no force-override: an operator cannot bypass the eligibility bar
(revisit if a legitimate override need appears).

## Phase 3.2 — bounded low-priority historical backfill (#1101) — current

Phase 3.2 lets an administrator run a BOUNDED, low-priority backfill that
reactivates matching HISTORICAL identities a completed baseline deliberately
suppressed, WITHOUT ever recreating a known public Article and without ever
starting itself. It is a SEPARATE high-permission operation (its own endpoint,
its own audit trail, its own low-priority band and hostname reservation) that
REUSES the ordinary candidate-ingest pipeline — no parallel/compat ingestion
path. A gap suggestion is only an input to a human approval; nothing auto-starts
a backfill after an outage, pause, gap, provider onboarding, or source-version
change (non-goal).

### Trigger-mode decision (Option b — the normal trigger keeps rejecting)

`backfill` is now IMPLEMENTED, but ONLY behind the dedicated
`POST /api/admin/backfill` endpoint. The normal operator trigger
(`/api/admin/scrape/trigger`) and the CLI keep `IMPLEMENTED_TRIGGER_MODES =
["incremental"]` and keep rejecting `backfill` with a `not-implemented` result
whose message now points at the dedicated endpoint. This preserves the #1097
"no-smuggle" invariant — a bounded, audited, high-permission operation can never
be launched through the ordinary trigger. `force-rescrape` remains deferred.

### Schema (`BackfillRun` + `BackfillRunStatus`)

A dedicated `BackfillRun` model persists each approved operation so a large
backfill survives worker restarts: actor id (a sanitized string, NOT an FK),
reason, REQUESTED vs EFFECTIVE (clamped) window + item bounds, clamp `warnings`,
`status` (`RUNNING`/`PAUSED`/`COMPLETED`/`CANCELLED`/`FAILED`), a
`checkpointCursor` (last-processed candidate id), and matched/reactivated/
skipped/failed counters. Dual-engine parity: PostgreSQL gets a
`CREATE TYPE "BackfillRunStatus"` + table; SQLite stores the enum as TEXT with a
JSONB `warnings` column. No article content or URLs are ever stored — only
sanitized categories, counts, bounds, actor, and reason.

`SKIPPED_OUTSIDE_WINDOW` is a LANDED reactivation target (#1127): a normal
incremental run over an ACTIVE source persists an INERT candidate for an admitted
+ DATED item whose trusted publication date falls at/before the active discovery
window (`page-commit` upserts it with `status = SKIPPED_OUTSIDE_WINDOW`,
`observedInBaseline = false`, `trustedPublishedAt` set — never enqueuing ingest
work, so it is never auto-ingested). It joins the historical states an approved
backfill may reactivate — `OBSERVED_BASELINE` (status `BASELINE`),
`OBSERVED_SHADOW` (status `DISCOVERED`, not observed-in-baseline), and
`SKIPPED_OUTSIDE_WINDOW` — each only when the identity has NO Article and was
never created-then-deleted (governing invariant). The dry-run preview breaks
`eligibleCount` into `observedBaselineCount + observedShadowCount +
skippedOutsideWindowCount`.

### Pure policy (no DB/network/clock)

- `resolveEffectiveBackfillBounds(requested, config, now)` — CLAMPS a requested
  window + item count to the configured ceilings so an approval can never become
  an unbounded archive crawl. The effective window is ALWAYS a concrete bounded
  interval whose span never exceeds `maxWindowDays`, and the item cap never
  exceeds `maxItemsCeiling`; open/future edges default to `now`, an inverted
  window is rejected, and every clamp is a sanitized warning category.
- `decideBackfillReactivation(input)` — whether ONE matching identity is eligible.
  Governing invariant first: an identity that already has (`has-article`) OR had
  then lost (`article-deleted`) a public Article is NEVER reactivated; only
  `OBSERVED_BASELINE` / `OBSERVED_SHADOW` are targets.
- `decideBackfillLifecycle(status, action)` — the pause/resume/cancel state
  machine (legal transitions, idempotent no-ops, illegal on terminal), so
  pause/resume/retry stays idempotent and never widens the approved range.

### Thin guarded persistence + driver loop

- `previewBackfill` (DRY-RUN) computes bounded COUNTS only — it creates NO run,
  NO Job, and fetches NO body. The `eligibleBackfillCandidateWhere` predicate is
  shared with the commit so the preview count and the real scan can never
  diverge; candidates with an UNKNOWN publication date are excluded from a
  windowed backfill (an identity that cannot be confirmed in-window is never
  reactivated).
- `advanceBackfillRun` reactivates up to `batchSize` (capped by the remaining
  item budget) still-eligible identities beyond the checkpoint under a
  compare-and-set guard on `(status, checkpointCursor)`. Reactivation is the one
  subtle move: because `article-save-commit` and the ingest handler both suppress
  `observedInBaseline = true`, the guarded per-candidate `updateMany` flips
  `observedInBaseline → false` + `status → QUEUED` and enqueues the LOW-priority
  candidate-ingest Job IN THE SAME transaction, so the UNCHANGED downstream
  pipeline (handler → runner → atomic save) then treats it as ordinary queued
  work. The enqueue is the idempotent `article-ingest:candidate:<id>:v<version>`
  upsert, so a resumed/retried/concurrent advance NEVER double-reactivates or
  creates a duplicate Job. The run completes on `drained` or `budget-reached`.
- `applyBackfillControl` (+ `pause`/`resume`/`cancel`) applies the pure lifecycle
  decision under a guarded transaction; a guarded zero-row update re-reads +
  re-decides (idempotent no-op vs stale). Control touches only `status` +
  timestamps, so it can never widen the bounds.
- The driver is a SIBLING worker loop (`runBackfillLoop`, gated on
  `options.backfill`, default off) — not a new `JobType`. Each tick it lists
  RUNNING runs and advances each one batch, resuming from `checkpointCursor` after
  a restart. It lives in `src/lib/worker/` (the worker → scraper import direction
  is allowed) and owns no decision logic.

### Contention — real-time work always stays ahead

Backfill-enqueued Jobs run at `BACKFILL_JOB_PRIORITY = -100`; the job claimer
orders `priority DESC`, so EVERY real-time incremental Job (priority 0) is claimed
before ANY backfill Job. This composes with the #1094 rate governor, whose
`backfill` priority tier is already DEFERRED with reason `reserved-for-incremental`
whenever the per-hostname reservation floor would otherwise let backfill consume a
slot reserved for real-time work. Under shared hostname pressure, current
incremental candidates therefore continue ahead of historical backfill.

### Capability-gated endpoints (`sources.manage`, deny-by-default + CSRF)

- `POST /api/admin/backfill` — create a bounded run, or (with `dryRun: true`)
  return a metadata-only preview that creates no run/Job/body. A `reason` is
  mandatory; bounds are clamped by the pure policy; only a real creation writes a
  sanitized `adminBackfillCreate` audit entry.
- `GET /api/admin/backfill` — filtered, paginated run list (sanitized DTOs).
- `GET /api/admin/backfill/{id}` — one run's sanitized status/progress.
- `POST /api/admin/backfill/{id}` — one idempotent pause/resume/cancel; outcome→
  HTTP: applied/noop `200`, not-found `404`, illegal/stale `409`. Only a
  state-CHANGING outcome writes an `adminBackfillControl` audit entry.

### Deferred (follow-ups)

`SKIPPED_OUTSIDE_WINDOW` classification + reactivation has LANDED (#1127 — see
Schema above): outside-window items persist as inert candidates and an approved
backfill can reactivate them. Production body-fetch dispatch remains the same
#1095/#1099 follow-up: reactivated identities enqueue the ordinary
candidate-ingest Job, so they inherit whatever ingestion dispatch the normal
pipeline provides.

## Phase 3.3 — audited force-rescrape with Article content versions (#1102) — current

Phase 3.3 lets an authorized operator refresh ONE known public Article ON
EXPLICIT REQUEST — the ONLY sanctioned path to refresh a known Article — while
preserving its identity and its current readable version until a validated
replacement is FULLY checked. Like backfill it is a SEPARATE high-permission
operation (its own endpoint, its own audit trail, a mandatory reason), and it is
UNREACHABLE from scheduled/normal discovery. Nothing auto-refreshes a known
Article from a changed `lastmod`/ETag/body (non-goal): normal incremental
ingestion still processes only post-baseline identities and NEVER refetches,
updates, recreates, or revives a known public Article.

### Trigger-mode decision (the normal trigger keeps rejecting)

`force-rescrape` stays OUT of `IMPLEMENTED_TRIGGER_MODES = ["incremental"]`. The
normal operator trigger (`/api/admin/scrape/trigger`) and the CLI keep rejecting
it with a `not-implemented` result whose message now points at the dedicated
`POST /api/admin/articles/{id}/force-rescrape` endpoint (exactly as #1101 did for
`backfill`). This is the AC3 "no-smuggle" invariant: a known Article can never be
refreshed through the ordinary trigger, even after rediscovering a changed
`lastmod`/ETag/body. A regression test (`tests/db/force-rescrape.test.ts`) proves
a normal `saveIncrementalArticle` — and a repeat rediscovery of the same identity
— creates NO `ArticleContentVersion`.

### Schema (`ArticleContentVersion` + `ArticleContentVersionStatus`)

A dedicated `ArticleContentVersion` model (NOT an overload of `Article`) is the
durable content ledger. Each row carries: the versioned readable payload
(`content`, `title`, and the remaining extracted fields + the fetched
`sourceUrl`/`canonicalUrl`), the versioned prose `fingerprint` (+
`fingerprintVersion`) and `extractorVersion`, operator provenance (`requestedById`
— a sanitized string, NOT an FK — and the mandatory `reason`), a machine
`failureReason` code for controlled failures, a `derivedRegenerationRequestedAt`
marker, and a `status`
(`PENDING`/`ACTIVE`/`SUPERSEDED`/`REJECTED`/`FAILED`). CONCURRENCY (AC4) is
DB-enforced by two nullable-unique slots set only while a row occupies that state
(multiple NULLs coexist on BOTH SQLite and PostgreSQL): `pendingForArticleId
@unique` serializes concurrent refreshes (a second one hits the conflict and is
rejected cleanly, losing neither version), and `activeForArticleId @unique`
guarantees at most ONE live version per Article. Dual-engine parity: PostgreSQL
gets a `CREATE TYPE "ArticleContentVersionStatus"` + table; SQLite stores the
enum as TEXT. The versioned readable payload is PRODUCT DATA that lives ONLY on
this row — never in logs, audit metadata, Job payloads, or error history.

On the FIRST force-rescrape of an Article, the commit MATERIALIZES the Article's
current content as an `ACTIVE` baseline version, so "retain the current version"
is durable before any replacement is proposed. A `PENDING` row starts EMPTY; its
proposed content is filled only at activation, so a failed/rejected version never
persists a proposed body (privacy minimization).

### Pure policy (`force-rescrape-policy.ts`, no DB/network/clock)

- `decideForceRescrapeEligibility(input)` — the per-target pre-flight: only a
  KNOWN, `PUBLIC`, non-taken-down Article WITH a source URL to refetch is
  eligible (else `not-found`/`not-public`/`missing-source-url`/`taken-down`, no
  writes).
- `decideAnnotationMigrationGate(input)` — the annotation-migration gate. With no
  annotations it passes; if the Article has reader annotations/highlights that need
  re-anchoring and NO migrator is wired, it BLOCKS activation → controlled
  `annotation_migration_required` failure → the old version is retained. #1103 (see
  Phase 3.4) EVOLVED it: a wired migrator only opens the gate when EVERY required
  anchor migrated RELIABLY — if any anchor is missing or ambiguous
  (`unreliableAnchorCount > 0`) the gate still BLOCKS, preserving the old version
  and exposing the uncertain anchors. It NEVER silently migrates.
- `decideForceRescrapeActivation({signals, annotation})` — the ordered validation
  gate over the impure fetch/sanitize/extract signals with a deterministic
  failure precedence: empty body (`empty_body`) → blocked identity
  (`blocked_identity`) → conflicting canonical (`canonical_conflict`) → unsafe
  body (`unsafe_body`) → quality reject (`quality_rejected`) → the fail-closed
  annotation gate. Only an all-clear proceeds. `FAILED_STATUS_REASONS`
  (`fetch_failed`/`internal_error`) terminate a version as `FAILED`; every other
  reason is a deliberate validation refusal terminating it as `REJECTED`.

### Thin guarded persistence (`force-rescrape-commit.ts`) + orchestration

- `createPendingRescrape` — materializes the ACTIVE baseline (once) and CLAIMS the
  per-Article PENDING lock. Both are STANDALONE idempotent writes that MAY catch
  P2002: the `pendingForArticleId` unique slot is the AC4 serialization point.
- `recordRescrapeFailure` — the controlled-failure path: a guarded `updateMany`
  flips `PENDING → FAILED/REJECTED`, stamps the machine reason code, and RELEASES
  the pending lock — leaving the ACTIVE version and all reader access UNCHANGED
  (AC1).
- `activateRescrape` — the atomic swap, mirroring `article-save-commit.ts`:
  reads-before-tx, then ONE interactive `$transaction` re-validates the pending
  row, DEMOTES the old `ACTIVE` version to `SUPERSEDED`, PROMOTES the pending row
  to `ACTIVE` (filling content + fingerprint + provenance and stamping
  `derivedRegenerationRequestedAt` to MARK derived outputs for regeneration), and
  UPDATES the Article's readable fields IN PLACE — preserving its id, ownerId,
  visibility, status, source/canonical URLs, and every reading relationship. Each
  write is a guarded `updateMany` (`count === 0` ⇒ throw ⇒ rollback), so a fault
  at ANY step leaves the old active version fully intact (proven all-or-nothing by
  a fault-injection test); a P2002 is NEVER caught inside the tx.
- `requestForceRescrape` (`force-rescrape-runner.ts`) — the impure conductor
  (mirrors `ingest-runner.ts`): read the Article + annotation count BEFORE any
  write → pure eligibility → `dryRun` metadata-only preview (no writes) →
  `createPendingRescrape` → the injected `PrepareRescrapeDraft` seam (fetch →
  sanitize → extract → quality → safety → canonical, NO tx) → pure activation gate
  → `activateRescrape` or `recordRescrapeFailure`. Any thrown error releases the
  pending lock via a controlled `internal_error` failure so a stuck lock can never
  wedge future refreshes.

### "Mark derived outputs for regeneration" — the #1103 gate seam (now implemented)

Activation stamps `derivedRegenerationRequestedAt` to MARK the Article's derived
outputs (translations, speech, quiz, vocabulary, difficulty, processing steps)
and reader annotations for regeneration/re-anchoring. #1102 only MARKED and
DEFINED the seam: the `AnnotationMigrator` type's mere PRESENCE opens the
annotation-migration gate, but #1102 NEVER wired one (so an annotated Article
failed closed) and NEVER called it. #1103 (Phase 3.4 below) both supplies the
migrator and performs the actual re-anchoring + derived regeneration behind this
gate.

### Capability-gated endpoint (`sources.manage`, deny-by-default + CSRF)

- `POST /api/admin/articles/{id}/force-rescrape` — request a refresh, or (with
  `dryRun: true`) return a metadata-only preview that creates no version and
  fetches no body. A `reason` is mandatory; `SCRAPER_FORCE_RESCRAPE=false`
  hard-disables the endpoint (`503`) before any read/write (a kill-switch
  independent of RBAC). Only a real state-CHANGING outcome writes a sanitized
  audit entry: `adminForceRescrapeActivate` (activated) or `adminForceRescrapeFail`
  (controlled failure) — actor, reason, version ids, and failure code only, never
  a URL or article content. Outcome→HTTP: activated/failed `200`, concurrent
  conflict `409`, not-found `404`, other ineligible `409`.
- `GET /api/admin/articles/{id}/force-rescrape` — one Article's sanitized
  force-rescrape status: its `ACTIVE` + `PENDING` versions, a bounded newest-first
  history, and the reader-annotation count that gates activation — all metadata
  only (no content/title/URL).

### Production body-fetch dispatch (`PrepareRescrapeDraft`) — wired in #1129

The production preparer `createProductionRescrapePreparer` (`rescrape-preparer.ts`)
COMPOSES existing production building blocks behind the ONE `PrepareRescrapeDraft`
boundary: the SSRF-safe `fetchHtml` (only ever the Article's `sourceUrl`) →
`extractArticle` → the deterministic quality gate → heuristic moderation over the
Reader text → #1092 canonical-identity resolution (`resolveFinalIdentity`). Every
building block is an INJECTABLE seam defaulting to the real function, so the
preparer is unit-testable with fakes and needs NO network/DB. It fails CLOSED at
every step: a blocked/non-OK/timed-out fetch or an unusable extraction returns
`fetch_failed` (retain the current version), and a refreshed page that resolves to
a DIFFERENT or blocked/quarantined canonical identity yields `conflict`/`blocked`
(the activation gate refuses, retaining the version). Because `src/lib/scraper/*`
may not import `@/lib/content-pipeline`, the endpoint injects
`articleHtmlToReaderText` as the moderation `deriveReaderText` seam (mirroring the
annotation migrator). PRIVACY: the fetched body/title/URL are returned STRAIGHT to
the runner (written only to the `ArticleContentVersion` row) — never logged or put
in audit/Job metadata; every emitted signal is a boolean/enum. The runner's DEFAULT
seam stays fail-closed (`defaultPrepareRescrapeDraft`) so an unwired caller can
never overwrite an Article. The annotation re-anchoring migrator behind the
fail-closed gate landed in #1103 — see Phase 3.4.

## Phase 3.4 — re-anchor annotations & regenerate derived outputs (#1103) — current

Phase 3.4 plugs the real annotation migrator into the Phase 3.3 gate seam so a
validated replacement content version can ACTIVATE without silently corrupting
highlights, notes, reading state, or derived assets. It runs ONLY inside the
audited force-rescrape activation — NEVER from ordinary incremental rediscovery
(the governing invariant; a regression test proves normal save + repeat
rediscovery creates no version and triggers no regeneration).

### Content-position vs article-level classification (requirement #1)

The migrator draws an explicit line (documented in `derived-regeneration.ts`):

- **CONTENT-POSITION dependent** — basis is the article prose, so they are
  regenerated (or, for anchors, MIGRATED): highlight/note anchors, narration/
  `ArticleSpeech` timing, `Translation` + `SentenceTranslation` caches,
  `QuizQuestion`, `VocabularyItem`, `GrammarExplanation`, and the Article
  difficulty/lexile fields.
- **ARTICLE-LEVEL** — attached to the Article identity, NOT its text, so they
  remain attached and UNMIGRATED: ownership/visibility/status, `ReadingProgress`,
  `ReadingListItem`, `ArticleMastery`, saved words, audit, `ContentReview`, and
  assignments. Force-rescrape refreshes the Article in place, so these stay valid.

### Re-anchoring engine reuse + ambiguity detection

The migrator REUSES the Reader's `revalidateAnchor` engine (`offline-conflict.ts`)
— it does NOT invent a second annotation format. The pure core
(`annotation-reanchor.ts`) layers the net-new AMBIGUITY DETECTION on top: an
anchor is RELIABLE only when it is `valid` (still at its offsets → "exact"), or
`moved` to an UNAMBIGUOUS location — the quote occurs once, OR (for repeated text)
the stored prefix+quote+suffix context resolves to exactly one place, OR a reflow
match is unique. A `missing` quote, or a `moved` quote whose position cannot be
uniquely resolved (`revalidateAnchor` would otherwise latch onto the FIRST
`indexOf` for repeated text), is AMBIGUOUS/UNRELIABLE. A collision pass guards the
`@@unique([userId, articleId, startOffset, endOffset])` constraint: if two
reliable anchors for one user would land on the same offsets, an `exact` keeps the
slot and colliding moves are demoted to ambiguous rather than moved arbitrarily.

### Reliability gate + offset migration in the activation tx

The runner (reads-before-tx) calls the injected `annotationMigrator.assess()` —
which loads the Article's anchors and derives the PROPOSED version's plain text the
SAME way the Reader does (injected `deriveReaderText = articleHtmlToReaderText`, so
offsets line up) — and feeds the `unreliableAnchorCount` into
`decideAnnotationMigrationGate`. If ANY anchor is unreliable the gate BLOCKS: the
old version is retained and `recordRescrapeFailure` stamps `unresolvedAnchorCount`
+ `unresolvedAnchorIds` on the rejected version (METADATA ONLY — Highlight IDs,
never quote/note text) for operator/user confirmation via the existing
stale-highlight Reader surface + the force-rescrape status endpoint. If every
anchor is reliable, `activateRescrape` migrates the reliable "moved" offsets IN THE
SAME atomic swap transaction as the content (two-phase parking to avoid transient
unique collisions), so highlight offsets and content change all-or-nothing.

### Deduplicated derived-output regeneration

After activation, `requestDerivedRegeneration` invalidates and re-enqueues ONLY the
content-derived outputs whose basis changed. It CLAIMS a per-version
`ArticleProcessingStep` (`rescrape-regen:<versionId>`, guarded by
`@@unique([articleId, step])`) so a worker restart/retry is a no-op
(`alreadyRequested`); clears the stale caches + feature steps in a transaction; and
enqueues ONE `AI_REBUILD` via the `@/lib/jobs` barrel with a dedupeKey scoped to
BOTH the Article id AND the target content-version id
(`rescrape-regen:<articleId>:<versionId>`) — so retries converge on the single job
(AC3/AC4). Regeneration is best-effort/retryable and does NOT block activation on
optional AI/narration provider availability (requirement #5); the job payload
carries ids + language codes + a `tts` flag only — never article/quote/note/prompt
text. New columns `ArticleContentVersion.unresolvedAnchorCount` /
`unresolvedAnchorIds` are the only schema change (dual-engine parity migration
`20260720070000_annotation_migration_regeneration`); regeneration REUSES the
existing `AI_REBUILD` job type rather than adding a new one.

### Deferred (follow-ups)

- Retiring the orphaned narration `MediaAsset` blob when `ArticleSpeech` is cleared
  for regeneration (the row is deleted; the underlying asset is left for a storage
  reaper) — follow-up #1131.
- A reconciler that re-drives `requestDerivedRegeneration` from a stamped-but-not-
  claimed `derivedRegenerationRequestedAt` if the best-effort enqueue is lost after
  activation — follow-up #1132.

## Phase 3.5 — Resolve canonical conflicts & govern deleted / withdrawn / taken-down Articles (#1104) — current

Phase 3.5 gives operators explicit, safe, audited ways to (a) resolve a
canonical-identity conflict onto exactly one surviving public Article, and (b)
govern content-lifecycle events — deletion, recovery, and withdrawal/takedown —
**without ever letting normal incremental ingestion refetch, recreate, or revive a
known Article**. Every recreation/recovery here is EXPLICIT OPERATOR ACTION; the
scheduler never polls or mutates old Articles. Pure decisions live in
`canonical-conflict-policy.ts`; sanitized read models in `canonical-conflict-query.ts`;
the guarded writes in `canonical-conflict-commit.ts`, `deleted-article-recovery.ts`,
and the leaf `candidate-deletion-stamp.ts`. **No schema change was required** — every
field already exists (`CanonicalConflict.status/resolvedAt/resolvedBy`,
`CrawlCandidate.terminalReason/terminalAt/articleDeletedAt`, `Article.takedownState`).

### The read model — conflict queue without content (requirement 1)

`listCanonicalConflicts(filter)` → `CanonicalConflictPage` and
`getCanonicalConflict(id)` → `CanonicalConflictDetailDto` (in
`canonical-conflict-query.ts`) power the operator queue. Each DTO carries the
conflicting **public Article ids**, the normalized identity (`providerKey`,
`identityVersion`, sanitized `canonicalKey`/`challengerKey` HASHES), the controlled
`reason` CATEGORY, timestamps, and `dependentData` **COUNTS ONLY** across eight
reader/learning classes (highlights, readingProgress, readingListItems,
articleMastery, quizAttempts, pronunciationAttempts, tutorMessages,
difficultyFeedback). The detail DTO adds a per-Article count breakdown. No field is
ever a URL, body, secret, or article content — counts come from `groupBy`
aggregates keyed on `articleId`.

### Conflict resolution order (AC1 / AC4)

`resolveCanonicalConflict({ conflictId, survivingArticleId, resolvedBy })` reads the
conflict + its contested Article ids OUTSIDE the transaction, asks the pure
`decideConflictResolution` policy for a decision, then — only for an `apply` —
runs a single guarded, convergence-wrapped `$transaction` in this **critical
order**:

1. **Re-validate + claim the OPEN conflict** — a guarded `updateMany`
   (`WHERE id AND status = OPEN → RESOLVED`, `count === 0 ⇒ throw ⇒ rollback`), so
   concurrent resolvers can never both win.
2. **Validate the survivor is one of the contested identities** (the pure policy
   rejects `survivor-not-a-participant` / `no-participants` before any write).
3. **Migrate or deliberately retain dependent data** per the documented rule below.
4. **Attach aliases + candidate history** to the survivor (a `CANONICAL`
   `UrlAlias`, challenger folded onto the survivor's candidate).
5. **ONLY THEN populate the unique public identity key** — the survivor's candidate
   claims the `@@unique([providerKey, identityVersion, canonicalKey])` slot via
   `upsert` (INSERT … ON CONFLICT), NEVER a catch-P2002-in-tx.
6. **Stamp** `status = RESOLVED`, `resolvedAt`, `resolvedBy`, removing ONLY that
   conflict block.

A unique-key race is handled by a bounded standalone convergence loop AFTER the tx
(mirroring `convergeCanonicalMerge` / `SaveRaceError`); a concurrently-resolved
conflict returns an idempotent `noop` (`already-resolved`) or `stale` (409). Exactly
one public identity owner always remains (AC4).

### Dependent-data rule — retain, don't migrate (AC1)

The losing Articles are **archived, not deleted**: `takedownState = archived`,
`PUBLISHED → DRAFT` (leaving public feeds via the existing content-governance rule),
and a `ContentReview` row records the transition. Because the losers are retained,
**all of their reader/learning data is preserved intact** — this is the "deliberately
retain" branch that satisfies AC1's "preserves required dependent data" without any
data loss. **Actively migrating** the losers' reader data onto the survivor (with
per-constraint unique-collision resolution) is deliberately out of scope — follow-up
#1134.

### Deletion → permanent DELETED outcome (AC2)

Deleting an Article (`deleteArticle` → `DELETE /api/admin/articles/{id}`, gated
`articles.manage`) now stamps the producing candidate(s) INSIDE the same
transaction, BEFORE `tx.article.delete`, via `markArticleCandidatesDeletedInTx`
(leaf module `candidate-deletion-stamp.ts`): a guarded `updateMany`
(`WHERE articleId = id AND articleDeletedAt = null`) sets `articleDeletedAt`,
`terminalReason = "governance:article-deleted"`, and `terminalAt`. The FK is
`SetNull`, so `articleId` clears AFTER the stamp — which is why the stamp runs
first, while the link still resolves. **`articleDeletedAt != null` is the
authoritative permanent DELETED outcome**: ordinary discovery and backfill can never
recreate the identity, and the governing invariant's reactivation guard treats a
deleted candidate as non-runnable. There is **no new `CrawlCandidateStatus` enum
value** — the controlled `terminalReason` + `articleDeletedAt` encode the outcome,
keeping the change dual-engine-free.

### Explicit audited recovery = re-admission, not content restore (AC2)

`recoverDeletedCandidate(candidateId)` →
`POST /api/admin/deleted-articles/{id}/recover` is the ONLY way a deleted identity
re-enters ingestion, and it is an explicit operator action. Eligible **only** when
the candidate is a DELETED outcome (`articleDeletedAt` set AND `articleId` null); a
candidate still linking a live Article is never touched. Inside a guarded
transaction it clears the deleted terminal, resets ingest metadata, sets
`status = DISCOVERED`, **bumps the extractor/processing version** so the enqueued
`ARTICLE_INGEST` Job gets a FRESH dedupe key (the historical terminal Job is left
intact for audit — a re-enqueue on the OLD key would be a no-op `upsert`), and
returns the new Job. This is a re-*admission*, not a content restore: the article
body is permanently gone; recovery lets the provider re-ingest the identity if it is
rediscovered. A second concurrent recovery fails safely (guarded `updateMany`
`count === 0 ⇒` 409 `conflict`), so exactly one re-admission + one Job result (AC4).

### Content governance reuse — withdrawal / takedown (AC3)

Withdrawal, takedown, unpublish, and archive are the **reversible soft states**
served by the EXISTING `applyTakedown` model (`takedownState` ∈
active/unpublished/archived/takedown; non-active forces `DRAFT` out of public feeds;
audited) via the existing `POST /api/admin/articles/{id}/takedown` route (gated
`content.moderate`). Phase 3.5 adds **no new governance route** — it guarantees (and
tests) that these state changes never erase the producing `CrawlCandidate` identity
or its `ContentReview` history, so the discovery ledger stays intact. Upstream
correction/withdrawal signals are treated as operator INPUT only; normal incremental
scheduling never mirrors them.

### Capability-gated endpoints (all `sources.manage`, deny-by-default + CSRF)

All new routes use `createCapabilityHandler(CAPABILITIES.sourcesManage, …)`
(consistent with the Phase 3.1 candidate queue), so Trinity's UI mirrors
`src/app/admin/candidates/page.tsx`:

| Method + path | Body / params | Success | Notes |
| --- | --- | --- | --- |
| `GET /api/admin/canonical-conflicts` | query: `status?`, `providerKey?`, `offset?`, `limit?` | `200` `CanonicalConflictPage` | Defaults to OPEN; RESOLVED/DISMISSED inspectable. |
| `GET /api/admin/canonical-conflicts/{id}` | params: `id` | `200` `CanonicalConflictDetailDto` / `404` | Per-Article dependent-data counts. |
| `POST /api/admin/canonical-conflicts/{id}/resolve` | body: `survivingArticleId`, `reason`, `confirm: true` | `200` applied/noop | `confirm:false` → 400; non-participant → 400; stale → 409. Audited `admin.canonical_conflict.resolve` on `applied` only. |
| `GET /api/admin/deleted-articles` | query: `providerKey?`, `offset?`, `limit?` | `200` `DeletedCandidatePage` | Most-recently-deleted first. |
| `POST /api/admin/deleted-articles/{id}/recover` | body: `reason`, `confirm: true` (`{id}` = candidate id) | `200` recovered | `confirm:false` → 400; ineligible → 409; concurrent → 409 `stale`. Audited `admin.article.recover` on success only. |

Destructive actions REQUIRE both a non-empty `reason` (schema-enforced) and an
explicit `confirm: true` (handler returns 400 otherwise), are idempotent, and write
privacy-safe audit metadata (ids, counts, reason CATEGORY — never a URL, body, or
secret).

### Acceptance evidence

- **AC1** (`tests/db/canonical-conflict-governance.test.ts`) — resolving a conflict
  yields one identity owner + preserves loser data + removes only that block;
  re-resolving is an idempotent no-op; a non-participant survivor is rejected
  without mutating state.
- **AC2** (same file) — deleting an Article stamps the producing candidate DELETED
  and discovery cannot recreate it; explicit recovery re-admits the identity and
  enqueues exactly one ingest Job; a live (non-deleted) candidate cannot be
  recovered. Route + unit coverage in `tests/article-library-admin.test.ts`
  (delete stamps the guarded candidate write) and the two admin-route suites.
- **AC3** (same DB file) — takedown changes Article state without erasing the
  candidate or its review history.
- **AC4** (same DB file) — two concurrent resolutions yield exactly one owner; two
  concurrent recoveries yield exactly one re-admission + one Job.
- Admin-route authorization, required-confirmation, audit-write, and
  capability/audit-constant wiring are covered by
  `tests/admin-canonical-conflicts-routes.test.ts` and
  `tests/admin-deleted-articles-routes.test.ts`.

### Deferred (follow-ups)

- Active migration of reader/learning data onto the surviving Article on conflict
  resolution, with per-constraint unique-collision resolution — follow-up #1134.
- A first-class resolution flow for runtime (Type B) canonical conflicts beyond the
  existing candidate-review approve/reject — follow-up #1135.

## Planned (see issues #1082–#1104)

The following phases build on the Phase 1 ledger and are documented as they land:

- **Phase 1 — discovery correctness in shadow mode** (epic #1078): shadow-mode
  discovery, baseline completion, watermark advance, and observation idempotency
  proving. *(Ledger schema #1081, versioned URL identity #1082, and the baseline
  seed #1083 have landed — see "Data model", "Phase 1.2", and "Phase 1.3" above.
  The discovery fetch seam #1084 has landed — see "Phase 1.4" above. The atomic
  page commit & classification #1085 has landed — see "Phase 1.5" above. The
  watermark / overlap / calibration / gap frontier #1086 has landed — see
  "Phase 1.6" above. Leased discovery-source scheduling in the worker #1087 has
  landed — see "Phase 1.7" above. The baseline & strict shadow lifecycle #1088
  has landed — see "Phase 1.8" above. Source observability, auto-degradation &
  minimal admin controls #1089 have landed — see "Phase 1.9" above. The Phase 1
  canaries + exit gates capstone #1090 has landed — see "Phase 1.10" above and
  the "Phase 1 go/no-go checklist" below.)*
- **Phase 2 — safe ingestion of new provider articles** (epic #1079): atomic
  candidate + Job + checkpoint commit, admission validation, and Article
  creation for genuinely new identities. *(The atomic candidate-based
  `ARTICLE_INGEST` enqueue #1091 has landed — see "Phase 2.1" above. Final
  canonical identity + body fingerprint resolution / convergence #1092 has landed
  — see "Phase 2.2" above. Propagation retries, quarantine & extractor-version
  reactivation #1093 has landed — see "Phase 2.3" above. Hostname budgets,
  provider fairness, priorities & cost budgets #1094 have landed — see
  "Phase 2.4" above. The atomic save of the Article, candidate outcome &
  downstream jobs #1095 has landed — see "Phase 2.5" above; production body-fetch
  dispatch behind the injected `prepareDraft` seam remains a follow-up. Gating
  trusted-provider auto-publication & optional enrichment #1096 has landed — see
  "Phase 2.6" above. Moving admin + CLI triggers to explicit incremental mode
  with active→shadow rollback #1097 has landed — see "Phase 2.7" above; it closes
  the legacy synchronous discover-and-save paths and defines (but defers)
  `backfill`/`force-rescrape`. The measured public-provider rollout gates, batch/
  tier config, acceptance matrix & rollback drill #1098 have landed — see
  "Phase 2.8" above; starting live canaries under load and recording go/no-go
  decisions remain operational follow-ups. credentialRef-based authenticated
  provider ingestion #1099 has landed — see "Phase 2.9" above; it CLOSES epic
  #1079, delivering secret-free authenticated access as a tested resolver seam
  with production body-fetch dispatch remaining the same follow-up as #1095.)*
- **Phase 3 — operator review, backfill, and controlled refresh** (epic #1080):
  canonical-conflict review UI, bounded historical backfill under a separate
  budget, and explicitly operator-triggered refresh. *(Candidate review &
  explicit source trust promotion #1100 has landed — see "Phase 3.1" above:
  capability-gated review-queue + trust endpoints, the `SKIPPED_REVIEW` rejection
  state, idempotent approve/reject/reactivate, and drift auto-demotion that
  preserves candidate history; the admin UI is delivered separately. Bounded
  low-priority historical backfill #1101 has landed — see "Phase 3.2" above: the
  dedicated high-permission `POST /api/admin/backfill` endpoint, the `BackfillRun`
  checkpoint model, dry-run preview, clamped bounds, low-priority pausable jobs
  with hostname reservation, and reactivation that honors the governing invariant;
  `SKIPPED_OUTSIDE_WINDOW` persistence + backfill reactivation has since landed in
  follow-up #1127. Audited
  force-rescrape with Article content versions #1102 has landed — see "Phase 3.3"
  above: the dedicated high-permission `POST /api/admin/articles/{id}/force-rescrape`
  endpoint, the `ArticleContentVersion` ledger with DB-enforced at-most-one
  pending/active slots, validate-before-activate with a deterministic failure
  taxonomy, atomic in-place activation preserving Article identity + reading
  relationships, and the fail-closed annotation-migration gate seam that #1103
  implements. The `force-rescrape` trigger mode stays DEFINED in the Phase 2.7
  taxonomy and rejected by the normal trigger — it is served EXCLUSIVELY by the
  dedicated endpoint. Re-anchoring annotations & regenerating affected derived
  outputs after a refresh #1103 has landed — see "Phase 3.4" above: the real
  annotation migrator (reusing `revalidateAnchor` + ambiguity detection) behind an
  evolved reliability gate, offset migration inside the activation transaction, and
  deduplicated version-scoped regeneration of ONLY content-derived outputs.
  Resolving canonical conflicts & governing deleted / withdrawn / taken-down
  Articles #1104 has landed — see "Phase 3.5" above: the capability-gated
  canonical-conflict queue + `resolve` endpoint (one surviving public identity,
  losers archived with reader data retained), the Article-delete candidate stamp
  (permanent `governance:article-deleted` terminal + `articleDeletedAt`, no new
  enum), explicit audited recovery as re-admission (not content restore), and the
  content-governance reuse (`applyTakedown`) that preserves candidate/review
  history — CLOSING epic #1080. Active reader-data migration to the survivor
  (#1134) and a first-class runtime (Type B) conflict flow (#1135) are follow-ups;
  the admin UI is delivered separately.)*
