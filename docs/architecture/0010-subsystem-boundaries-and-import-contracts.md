---
title: "ADR-0010: Subsystem boundaries and import contracts"
category: "Architecture"
architecture: "Architecture decision record for subsystem ownership, public APIs, private imports, and import-boundary enforcement."
design: "Captures current subsystem boundary contract, allowlist strategy, and phased enforcement expectations."
plan: "Supersede with a new ADR if subsystem/import architecture changes; update allowlists and docs together."
updated: "2026-07-01"
rename: "none"
---

# ADR-0010: Subsystem boundaries and import contracts

- **Status:** Accepted
- **Date:** 2026-06-26
- **Related:** #668, #669, #673

## Context

ReadWise is organized around a small set of first-class subsystems: Access and
Tenancy, Article Library, Content Ingestion, AI, Security, Runtime Config,
Operations, Observability, Analytics, Media/Storage/Speech, Reader, Search and
Recommendations, and Platform.

The main architecture risk is not a missing functional area; it is boundary
drift. Older flat `src/lib/*.ts` helpers coexist with newer subsystem
directories, and high-risk cross-cutting concerns such as redaction,
environment-variable parsing, provider access, route business logic, Prisma
access, and telemetry metadata must stay owned by the right subsystem.

This ADR records the agreed subsystem ownership model and import contract strategy.

## Decision

ReadWise treats subsystem completeness as **production maintainability**. A
first-class subsystem has a clear owner, documented public API, private
internals, data/privacy/deletion rules, testing expectations, and operational
guidance where relevant.

The contract is intentionally pragmatic:

- treat security, privacy, configuration, provider, and client/server safety
  boundaries as the highest-risk contracts;
- keep business-domain cleanup incremental and tied to touched code;
- prefer local public APIs and barrels over deep imports;
- document exceptions explicitly rather than hiding them in comments.

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

High-risk boundaries are stricter than broad business-domain cleanup:

- sensitive-data redaction;
- runtime configuration / environment-variable reads;
- Prisma/client/server import safety;
- raw AI provider access;
- raw storage/provider secret access;
- observability metadata scrubbing.

Business-domain import boundaries are documented and reviewed, then tightened
when stable public APIs exist.

### 4. ADRs must be enforceable engineering rules

This contract should not remain a vague architecture statement. It must map to
lint/tests/allowlists, clear public API decisions, and review criteria.

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
| Search / Recommendations | Provider seams, query normalization, ranking, candidate caps, pagination/performance contract, personalized scoring/diversity/explanations. | Article access policy and reader UI placement. | Reader-facing capability whose candidates must come from Article Library readable policy. |
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
- removal condition.

The allowlist should shrink over time. New allowlist entries require explicit
review justification.

### How to add an allowlist entry

1. Open `eslint-rules/import-boundary-allowlist.json`.
2. Append an object to the `allowlist` array with **all five required fields**:

   ```json
   {
     "importer": "src/path/to/your-file.tsx",
     "privateModule": "@/lib/some-private-module",
     "reason": "Why this specific file needs the deep import and why it cannot use the public API.",
     "owner": "@your-github-handle",
    "removalCondition": "Remove once <subsystem> exposes <functionality> through its public API."
   }
   ```

   - `importer` is matched with a **suffix check** against the absolute path of
     the linted file (i.e. the absolute path must end with the `importer` value
     after path normalization). A relative path like
     `src/components/SomeWidget.tsx` will match any absolute path ending with
     that suffix.
   - `privateModule` is the exact `@/...` import path that would otherwise be
     blocked by the rule.
   - `reason` must explain the specific business constraint that makes the
     direct import necessary today.
   - `owner` is the GitHub handle responsible for tracking and removing the
     entry.
  - `removalCondition` must name a concrete public-API or code-state milestone
    that, when complete, makes the entry unnecessary.

3. Commit the JSON change in the same PR as the code that introduces the import.
   Never add an allowlist entry in a separate follow-up PR — the PR diff must
   show both the violation and the justification.

### How to remove an allowlist entry

1. Verify that the underlying violation no longer exists (the direct import has
   been replaced by a public-API call, or the file has been deleted).
2. Delete the entry object from `allowlist` in
   `eslint-rules/import-boundary-allowlist.json`.
3. Run `npm run lint` and `npm test` to confirm no regressions.
4. Commit the removal in the same PR as the code change that made it possible.
   Add a note in the PR description: "Removes allowlist entry for \`<importer>\`
   now that \`<privateModule>\` is accessible through the public API."

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

## Enforcement

### Current hard boundaries

The following are high-risk and are either lint-enforced, explicitly allowlisted,
or reviewed as hard boundaries:

- client/server import safety;
- `@/lib/prisma` in client bundles;
- `@/lib/runtime-config` in client bundles;
- direct access to AI provider/runner/registry internals;
- direct access to storage/provider secrets;
- divergent sensitive-data redaction rules;
- direct business configuration reads from `process.env` outside allowlisted
  framework/runtime/test locations.

### Business-domain boundaries

Business-domain deep imports are governed by documented contracts, tests,
reviews, and allowlists. They become stricter where public APIs are stable and
the relevant code is already being touched.

## Current enforcement

The repository currently enforces the highest-risk client/server boundary with
`eslint-rules/no-server-imports-in-client.js`. In files with an explicit
`"use client"` directive, the rule blocks imports of server-only modules such
as Prisma, auth/session guards, runtime config, observability/security modules,
server storage adapters, and AI provider/runner/registry internals unless an
allowlist entry exists.

Design-system drift is enforced separately by
`eslint-rules/ui-design-system.js`; it is related governance, not a subsystem
import boundary.

Business-domain boundaries are enforced by documented ownership, public APIs,
tests, and code review. They should be tightened when relevant code is touched,
without repository-wide churn for its own sake.

## Review checklist

When adding or changing subsystem code, reviewers should check:

- Does the change use a public subsystem API instead of a private deep import?
- If it adds a private import, is the allowlist entry justified and removable?
- Are route handlers thin adapters, with business rules in domain modules?
- Are privacy-sensitive fields kept out of logs, analytics properties, audit
  metadata, AI ledger records, and error context?
- Are direct `process.env` reads limited to framework/runtime exceptions or
  typed runtime-config modules?
- Are Prisma writes and cross-model transactions owned by the domain that owns
  the business rule?

## Related docs

- [`../security/overview.md`](../security/overview.md) — security-owned
  redaction and request safety.
- [`../platform/runtime-config.md`](../platform/runtime-config.md) — typed
  runtime configuration and feature flags.
- [`../observability/overview.md`](../observability/overview.md) and
  [`../observability/metrics.md`](../observability/metrics.md) — telemetry
  boundaries.
- [`../analytics/product-analytics.md`](../analytics/product-analytics.md) and
  [`../analytics/domain-reporting.md`](../analytics/domain-reporting.md) — event
  stream vs. domain read-model ownership.
- [`../platform/ci.md`](../platform/ci.md) — lint/test gates.
