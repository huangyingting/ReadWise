---
type: "design"
status: "current"
last_updated: "2026-07-19"
description: "Design for stateful incremental provider ingestion: the governing invariant, the durable discovery ledger data model (DiscoverySource, CrawlCandidate, UrlAlias, DiscoveryObservation, CanonicalConflict), its enums, uniqueness constraints, cascade/retention decisions, and versioned URL normalization / public article identity (Phase 1.2). Later phases are stubbed."
---

# Incremental provider scraping design

This document records the agreed design for **stateful incremental provider
ingestion** (program epic #1077). It replaces stateless provider rescans with a
durable, source-aware model that discovers and saves genuinely new public
articles without automatically refreshing known ones. It complements the current
scraper reference in [`scrapers.md`](./scrapers.md) and the source governance in
[`content-policy.md`](./content-policy.md).

The document is filled in phase by phase as implementation lands. The data model
(#1081) and URL normalization / public article identity (Phase 1.2, #1082) are
**current** below; later phases are **planned** stubs.

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

## Planned (see issues #1082–#1104)

The following phases build on the Phase 1 ledger and are documented as they land:

- **Phase 1 — discovery correctness in shadow mode** (epic #1078): shadow-mode
  discovery, baseline completion, watermark advance, and observation idempotency
  proving. *(Ledger schema #1081 and versioned URL identity #1082 have landed —
  see "Data model" and "Phase 1.2" above.)*
- **Phase 2 — safe ingestion of new provider articles** (epic #1079): atomic
  candidate + Job + checkpoint commit, admission validation, and Article
  creation for genuinely new identities.
- **Phase 3 — operator review, backfill, and controlled refresh** (epic #1080):
  canonical-conflict review UI, bounded historical backfill under a separate
  budget, and explicitly operator-triggered refresh.
