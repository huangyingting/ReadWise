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
  dispatch behind the injected `prepareDraft` seam remains a follow-up.)*
- **Phase 3 — operator review, backfill, and controlled refresh** (epic #1080):
  canonical-conflict review UI, bounded historical backfill under a separate
  budget, and explicitly operator-triggered refresh.
