# ADR-0010: Subsystem boundaries and phased import contracts

- **Status:** Accepted
- **Date:** 2026-06-26
- **Related:** Follow-up to architecture/backend quality audits on subsystem boundaries, sensitive-data redaction, runtime configuration, import contracts, and route/data-layer ownership.

## Context

ReadWise already has broad subsystem coverage: access and tenancy, AI, analytics,
content ingestion and policy, learning, media, observability, operations,
platform, reader, and security. The current design is not missing a major
functional subsystem. The remaining architecture risk is that production
maintainability depends on boundaries that are documented in multiple places but
not yet consistently enforced.

The key pressure points discussed in the design review were:

- Newer subsystem directories and older flat `src/lib/*.ts` helpers coexist.
- Some high-risk cross-cutting rules are duplicated or scattered: sensitive-data
  redaction, `process.env` reads, AI provider access, telemetry metadata, route
  business logic, Prisma access, and import boundaries.
- Several docs or comments drift from current file paths, for example references
  to `docs/refactoring.md`, `docs/adr/`, or `docs/analytics/analytics.md`.
- The desired definition of "complete subsystem design" is production
  maintainability, not merely a complete feature map.

This ADR records the agreed subsystem ownership model, import contract strategy,
and phased backlog for tightening the design without creating a large, risky
rewrite.

## Decision

ReadWise will treat subsystem completeness as **production maintainability**:
each first-class subsystem should have clear ownership, a public API, private
internals, data/privacy/deletion rules, testing strategy, operational guidance,
and eventually automated boundary enforcement.

The enforcement strategy is intentionally phased:

1. Document the contract and fix obvious documentation drift.
2. Harden the highest-risk security, privacy, configuration, and provider
   boundaries first.
3. Gradually converge cross-cutting subsystems.
4. Move domain code naturally as routes, commands, and data flows are touched.

The goal is **not** to stop feature work with a repository-wide refactor. The
goal is to install road signs and guardrails before moving more furniture.

## Agreed principles

### 1. First-class subsystems are few and hard

Only modules with data ownership, permission implications, external providers,
queues/background execution, security/privacy policy, or cross-page/domain impact
should become first-class subsystems. Small utilities, feature-local helpers, and
pure primitives should remain lightweight.

### 2. Public APIs are preferred over deep imports

External callers should import a subsystem through its public entry point or an
explicitly documented public submodule. Deep imports into provider, registry,
runner, store, internal, or redaction modules are private by default.

### 3. Security, privacy, and configuration boundaries harden first

High-risk boundaries should become hard constraints before broad business-domain
cleanup:

- sensitive-data redaction;
- runtime configuration / environment-variable reads;
- Prisma/client/server import safety;
- raw AI provider access;
- raw storage/provider secret access;
- observability metadata scrubbing.

Business-domain import boundaries can start with warnings and allowlists, then
tighten as existing code migrates.

### 4. ADRs must be executable engineering rules

This contract should not remain a vague architecture statement. It must map to
lint/tests/allowlists, clear public API decisions, migration phases, and review
criteria.

### 5. Route handlers are protocol adapters

API routes should own auth/validation/transport concerns and call domain
commands/queries/services. They should not own complex Prisma queries, access
predicates, AI prompts, multi-model transactions, job state machines, or
redaction policy.

### 6. Prisma is infrastructure, not a business-rule escape hatch

The singleton Prisma client is allowed as infrastructure. Domain data access,
multi-model mutations, ownership predicates, visibility predicates, tenancy
scoping, and transaction boundaries should belong to the relevant subsystem.

## First-class subsystem ownership

| Subsystem | Owns | Does not own | Boundary rule |
| --- | --- | --- | --- |
| Access & Tenancy | Account lifecycle, export/delete, RBAC/capabilities, organizations, memberships, classrooms, assignments, tenant-aware cache/privacy rules. | Article visibility predicates, product analytics event stream, admin UI layout. | Provides identity, capability, and scope context; resource subsystems apply it to their own resources. |
| Article Library | Article visibility/status/ownership/org scope semantics, readable/editable/admin predicates, listing read models, moderation/rights/takedown, article collections/bookmarks/list membership. | Scraper extraction, reader UI, background processing state machine. | Reader/search/recommendations/processing must consume Article Library access boundaries instead of rewriting them. |
| Content Ingestion | Scraper provider registry, discovery/extraction/dedupe, SSRF/robots/max-byte controls, source health, URL/text intake until draft/private article creation. | Article access policy, reader experience, processing retries. | Import/scrape flows must create articles through the documented article lifecycle semantics. |
| AI | Provider abstraction, chat facade, provider registry/runner internals, budgets/quotas, ledger, prompt registry, evals, model error normalization. | Feature-specific learning UX or route transport. | Provider/runner/registry/budget enforcement are private; feature-level AI services consume the public AI facade. |
| Security | Redaction policy, CSRF, trusted IP, security events, audit metadata safety, rate-limit security posture. | Observability sinks, product analytics semantics, AI ledger business meaning. | One security-owned redaction policy must be reused by observability, analytics, audit, security events, and AI ledger. |
| Runtime Config | Business configuration and environment-variable parsing/validation, readiness config report, typed feature configs. | Framework-only runtime constants such as narrowly allowed `NODE_ENV` / `NEXT_RUNTIME` uses. | Business modules consume typed config; direct `process.env` reads require allowlist justification. |
| Operations / Background Processing | Durable job queue, worker loop, claim/lock/retry/dead-letter lifecycle, processing-step timeline, backfill/rebuild/repair orchestration, operator runbooks. | The domain-specific work performed by AI, Article Library, Media, or Learning. | Operations owns scheduling/recovery/observability; domains own the work semantics. |
| Observability | Structured logging, request context/correlation, tracing, error capture/alert hooks, metrics registry/exporter, SLI/SLO catalog, investigation workflow. | AuditLog business meaning, AiInvocation ledger contract, Job state machine, AnalyticsEvent stream. | Observability exports and correlates signals but does not own business fact tables. |
| Analytics | Product analytics event catalog, event sanitizer/writer/retention, product funnel/activation/retention/feature-usage queries and export contract. | Learner mastery, tenant reporting, AI usage ledger, job health, domain read-model ownership. | Analytics may aggregate reporting, but source facts remain owned by their domains. |
| Media / Storage / Speech | Media assets, storage keys/checksum/mime/size/duration, database/filesystem/Azure storage lifecycle, storage migration/rollback/readiness; speech owns TTS provider and word-boundary generation. | Reader playback UX and background job scheduling. | Media owns asset lifecycle, Speech owns generation, Reader owns playback, Operations owns retries/scheduling. |
| Reader | Reader page composition, display preferences, annotations UI, offline sync UX, playback UX, in-reader tools, search/recommendation presentation. | Article visibility source of truth, storage lifecycle, AI provider internals. | Reader-facing capabilities must use Article Library readable boundaries and feature services. |
| Search / Recommendations | Provider seams, query normalization, ranking, candidate caps, pagination/performance contract, personalized scoring/diversity/explanations. | Article access policy and reader UI placement. | Not first-class initially; treated as Reader-facing capabilities whose candidates must come from Article Library readable policy. |
| Platform | API handler wrappers, authentication/session foundation, database workflows, CI, dependency injection conventions, health/readiness, static assets, primitives. | Domain business behavior. | Platform provides common infrastructure; domains own decisions. |

## Import contract

### Default public import rule

External code should prefer stable subsystem entry points, for example:

- `@/lib/ai`
- `@/lib/security`
- `@/lib/runtime-config`
- `@/lib/article-library`
- `@/lib/analytics`
- `@/lib/observability`
- `@/lib/jobs` / documented Operations APIs
- `@/lib/org`, `@/lib/classroom`, `@/lib/account-lifecycle`, and `@/lib/rbac`
  as public modules under the Access & Tenancy boundary.

Some documented submodules can remain public when they are intentionally stable,
such as prompt registry or schema modules. Public submodules must be called out
in subsystem docs or barrels.

### Default private deep-import rule

External code should not import internals such as:

- `*/provider`;
- `*/azure-provider` or raw external-provider clients;
- `*/registry`;
- `*/runner`;
- `*/store`;
- `*/internal`;
- raw redaction/scrubbing implementations outside the security-owned policy;
- modules that directly handle secrets, provider credentials, or raw request
  payloads.

### Allowlist rule

Existing deep imports can be temporarily allowlisted when migration would be too
risky for the current ticket. Every allowlist entry should include:

- importer path or glob;
- imported private module;
- reason;
- owner;
- expected migration phase or removal condition.

The allowlist should shrink over time. New allowlist entries require explicit
review justification.

## Data and transaction contract

Domain commands and repositories own data access semantics. The following rules
apply to new work and should guide migration of existing code:

- Multi-model writes belong in subsystem command/repository modules, not route
  handlers.
- Visibility, tenancy, ownership, and capability predicates must be centralized
  in their owning subsystem.
- Cross-subsystem side effects should prefer best-effort writes, outbox/jobs, or
  explicit orchestration over broad transactions.
- If a transaction crosses subsystem boundaries, the owning command must be
  documented and tested.
- Route handlers should validate input, call commands/queries, map domain
  results to HTTP, and set transport-level headers/cache behavior.

## Enforcement strategy

### Immediate hard boundaries

The following should move toward hard checks first:

- client/server import safety;
- `@/lib/prisma` in client bundles;
- `@/lib/runtime-config` in client bundles;
- direct access to AI provider/runner/registry internals;
- direct access to storage/provider secrets;
- divergent sensitive-data redaction rules;
- direct business configuration reads from `process.env` outside allowlisted
  framework/runtime/test locations.

### Gradual business-domain boundaries

Business-domain deep imports should start with documented contracts, warnings,
and allowlists. They should become hard checks only after public APIs are stable
and high-churn existing imports have migration paths.

## Phased backlog

### Phase 0 — Contract and documentation drift repair

**Goal:** create the shared map before changing behavior.

**Scope of changes:** documentation and comments only.

**Required modifications:**

1. Add or finalize this ADR as
   `docs/architecture/0010-subsystem-boundaries-and-import-contracts.md`.
2. Update `docs/architecture/README.md` to include ADR-0010 once accepted.
3. Update `docs/README.md` with a short description of first-class subsystem
   ownership and cross-subsystem import principles.
4. Fix known path drift:
   - references to missing `docs/refactoring.md` should be redirected to an
     existing durable doc or replaced by a small redirect/index document;
   - `docs/adr/` references should become `docs/architecture/`;
   - `docs/analytics/analytics.md` references should become
     `docs/analytics/product-analytics.md` unless a new analytics overview is
     created.
5. Record the Phase 1/2/3 backlog in the relevant docs or issues.

**Non-goals:**

- No runtime behavior changes.
- No route/service/schema refactors.
- No new lint failures.
- No broad import rewrites.

**Definition of done:**

- ADR-0010 exists and captures subsystem ownership, public API rules, private
  import rules, allowlist strategy, and phased enforcement.
- Documentation index points to the new ADR after acceptance.
- Known broken doc paths no longer appear in comments/docs, or a deliberate
  redirect/index doc exists.
- A reviewer can tell exactly what Phase 1 should implement.
- Markdown diagnostics show no new problems.

**Suggested verification:**

- Search for the known bad paths.
- Check Markdown diagnostics.
- Manually inspect links touched by the ticket.

### Phase 1 — Highest-risk guardrails

**Goal:** harden privacy/security/config/provider boundaries before broad domain
cleanup.

**Required modifications:**

1. **Security-owned redaction primitive**
   - Add a stable security-owned redaction policy module, for example
     `src/lib/security/redaction.ts`.
   - Export safe public helpers via `src/lib/security/index.ts`.
   - Candidate helpers:
     - `isSensitiveMetadataKey`;
     - `redactSensitiveValue`;
     - `redactSensitiveObject`;
     - `safeMetadataForPersistence`.
   - Update observability, client error reporting, security events, audit logs,
     analytics event sanitation, and AI ledger metadata handling to consume the
     same policy.
   - Keep prompts, article text, selected text, tokens, cookies, credentials,
     authorization headers, and private content out of persisted metadata.

2. **Runtime-config ownership and env allowlist**
   - Define the allowed direct `process.env` exceptions:
     - `NODE_ENV`;
     - `NEXT_RUNTIME`;
     - public `NEXT_PUBLIC_*` metadata/display uses;
     - testing/CI guard modules;
     - thin framework adapters for Prisma/NextAuth/Next.js when unavoidable.
   - Move business configuration reads toward `src/lib/runtime-config/*` typed
     helpers.
   - Keep `.env.example`, README env tables, and readiness checks aligned.

3. **Import-boundary enforcement for high-risk internals**
   - Extend existing import-boundary lint/tests or introduce a focused rule.
   - Initially block only the highest-risk internal imports for new code:
     - AI provider/runner/registry internals;
     - security redaction internals outside public security exports;
     - runtime-config in client bundles;
     - Prisma in client bundles;
     - raw provider/storage secret modules.
   - Add an allowlist for known existing exceptions with owner/reason/phase.

4. **Tests and documentation**
   - Add focused tests for redaction behavior and boundary rules.
   - Update security, observability, runtime-config, and architecture docs to
     point to the new contract.

**Non-goals:**

- Do not refactor every route or AI feature yet.
- Do not convert all top-level `src/lib/*.ts` files.
- Do not block safe primitives or feature-local helpers.

**Definition of done:**

- One redaction policy is the source of truth.
- High-risk direct imports are either blocked or explicitly allowlisted.
- New business config reads outside runtime-config are blocked or flagged.
- Existing optional-provider graceful fallback behavior remains intact.

**Suggested verification:**

- Focused unit tests for redaction edge cases.
- Import-boundary tests.
- Typecheck for touched modules.
- Grep for direct high-risk imports and `process.env` exceptions.

### Phase 2 — Cross-cutting subsystem convergence

**Goal:** make the large cross-cutting systems coherent without forcing every
business route to change at once.

**Required modifications:**

1. **AI boundary convergence**
   - Keep provider/runner/registry/budget enforcement internal to `src/lib/ai`.
   - Prefer feature-level AI services for translation, quiz, vocabulary,
     grammar, tutor, difficulty, and sentence translation.
   - Feature services should own prompt version, validation, cache key,
     fallback, moderation, and ledger metadata for that feature.
   - Route handlers should not directly build provider payloads or handle raw
     provider errors.

2. **Operations / Background Processing consolidation**
   - Document `src/lib/jobs`, `src/lib/worker`, `src/lib/processing`, scripts,
     backfill, rebuild, and support repair under one Operations boundary.
   - Unify state vocabulary and retry/failure classification where duplicated.
   - Clarify that scripts are CLI adapters and do not own business rules.
   - Expand `docs/operations/admin-operations.md` with worker lifecycle,
     support actions, backfill/rebuild, and operator checklists.

3. **Observability + Metrics integration**
   - Treat `src/lib/observability` and `src/lib/metrics` as one Observability
     subsystem.
   - Add or expand docs for metrics registry/exporter, SLI/SLO catalog, alert
     hooks, request correlation, and investigation workflow.
   - Preserve domain ownership of AuditLog, AiInvocation, Job, AnalyticsEvent,
     and ArticleProcessingStep.

4. **Analytics vs reporting clarification**
   - Keep `AnalyticsEvent` catalog/writer/sanitizer/retention under Analytics.
   - Document that learner analytics, tenant reporting, AI usage, and job health
     read models are owned by their source domains.
   - Admin dashboards may compose read models but should not claim ownership of
     every fact table.

5. **Media / Speech / Reader boundary clarification**
   - Media owns asset lifecycle and storage migration/readiness.
   - Speech owns TTS provider seam and word-boundary generation.
   - Reader owns playback UX and controls.
   - Operations owns TTS job scheduling/retry/status.

**Non-goals:**

- Do not rewrite all feature helpers at once.
- Do not replace the database job queue with an external queue.
- Do not introduce new providers merely for architecture symmetry.

**Definition of done:**

- Cross-cutting subsystem docs describe ownership and public/private boundaries.
- New work has a clear place to put provider access, retries, metrics, reporting,
  and operational runbooks.
- Existing tests continue to pass for touched behavior.

**Suggested verification:**

- Focused tests for changed AI/operations/observability modules.
- Grep for newly prohibited deep imports.
- Typecheck for touched modules.

### Phase 3 — Domain migrations during natural feature work

**Goal:** reduce legacy coupling as code is touched, without a repository-wide
rewrite.

**Required modifications:**

1. **Route handler slimming**
   - Move complex route business logic into domain commands/queries/services.
   - Prioritize routes touching auth, visibility, tenancy, AI, or multi-model
     mutations.
   - Keep simple read routes eligible for opportunistic cleanup.

2. **Data access and transaction ownership**
   - Move multi-model mutations into owning subsystems.
   - Centralize visibility, ownership, tenant, and capability predicates.
   - Avoid cross-subsystem transactions unless explicitly owned and tested.

3. **Article Library / Content Ingestion / Reader boundary cleanup**
   - Reader should use Article Library for readable access and page data
     constraints.
   - Content ingestion should not bypass article lifecycle semantics.
   - Processing should update derived state and processing steps without owning
     article access policy.

4. **Search and recommendations contract hardening**
   - Keep Search/Recommendations as Reader-facing capabilities for now.
   - Ensure candidate sets are derived from Article Library readable policy.
   - Document candidate caps, pagination, ranking, external index constraints,
     and private/org article safety.

5. **Access & Tenancy usage cleanup**
   - Replace ad-hoc `role === "Admin"`, membership checks, or owner predicates
     with capability/context/helper calls where practical.
   - Preserve resource-specific authorization inside owning resource subsystems.

6. **Primitives and helper hygiene**
   - Keep pure/client/server primitives lightweight and documented.
   - Avoid turning single-feature helpers into first-class subsystems.
   - Remove obsolete compatibility wrappers instead of expanding them.

**Non-goals:**

- Do not chase perfect folder symmetry.
- Do not migrate every direct Prisma import immediately.
- Do not change public API shapes unless the feature work requires it.

**Definition of done:**

- Newly touched complex routes call domain services rather than owning behavior.
- Business predicates are centralized for the touched domain.
- Boundary tests or focused regression tests cover risky moves.
- Allowlist entries decrease over time.

**Suggested verification:**

- Focused route/domain tests for changed flows.
- Import-boundary checks.
- Typecheck for touched modules.
- For shared contracts, run nearest affected tests and broaden only when needed.

## Phase 0 first ticket shape

The first implementation ticket should be intentionally small and reviewable.

**Title:** Add subsystem boundary ADR and repair documentation path drift.

**Scope:**

- Add/finalize ADR-0010.
- Update documentation indexes after ADR acceptance.
- Fix known path drift in docs/comments.
- Record Phase 1/2/3 follow-up tasks.

**Explicit non-scope:**

- No runtime code behavior changes.
- No new lint rule behavior.
- No broad import rewrites.
- No provider/storage/AI/data-layer refactors.

**Reviewer checklist:**

- Can a reviewer identify every first-class subsystem and its owner?
- Are private import categories clear enough to encode in lint later?
- Are direct `process.env` exceptions explicit?
- Is redaction ownership clearly assigned to Security?
- Are Analytics vs reporting, Observability vs business facts, Media/Speech/
  Reader, and Operations vs domain work clearly separated?
- Are Phase 1/2/3 tasks concrete enough to become tickets?

## Open follow-up decisions

These are deliberately deferred until implementation tickets need them:

- Exact file format for the deep-import allowlist.
- Whether to extend the existing client/server import rule or add a separate
  subsystem-boundary lint rule.
- Whether `docs/refactoring.md` should be recreated as a redirect/index or all
  references should move to more specific current docs.
- Which feature-level AI services should be extracted first.
- Whether Search/Recommendations eventually deserve a first-class subsystem if
  external search, semantic ranking, or large-scale personalization grows.
