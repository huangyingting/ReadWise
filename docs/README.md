---
type: "index"
status: "current"
last_updated: "2026-11-19"
description: "Entry point for ReadWise documentation: how docs are organized by subsystem, where to start, the generated subsystem index, and the checklist for adding or changing docs."
---

# ReadWise documentation

Durable reference documentation for the current ReadWise codebase. Source code,
tests, Prisma schemas, and scripts are authoritative; these docs explain current
behavior, decisions, and operations around them.

## Start here

| Document | Why |
| --- | --- |
| [`../README.md`](../README.md) | Project overview, local setup, scripts, and deployment. |
| [`architecture/README.md`](./architecture/README.md) | Architecture decision records, including the [subsystem boundary contract](./architecture/0010-subsystem-boundaries-and-import-contracts.md). |
| [`platform/database.md`](./platform/database.md) | SQLite and PostgreSQL workflows and migration testing. |
| [`platform/ci.md`](./platform/ci.md) | CI quality gates and failure diagnosis. |
| [`platform/documentation-governance.md`](./platform/documentation-governance.md) | The rules this tree follows. |

## How the docs are organized

```text
docs/
├── README.md                 ← this index (subsystem table is generated)
└── <subsystem>/              ← one flat folder per subsystem, no nesting
    ├── README.md             ← scope, code ownership, generated document table
    └── <topic>.md            ← one document per durable topic
```

- **Subsystems** follow the ownership model in ADR 0010. Each subsystem
  `README.md` says what it covers, when a new document belongs there, and which
  code it owns.
- **Every document** starts with frontmatter (`type`, `status`, `last_updated`,
  `description`) and a `# Title`. The indexes are generated from those fields, so
  a document describes itself and no index needs hand-editing.
- **Status is explicit.** `current`/`accepted` documents describe how the code
  works today; `proposed` designs and `plan` documents are labelled as such in
  every index.

## Subsystems

<!-- BEGIN GENERATED: docs-index (npm run docs:index) -->

| Subsystem | Scope | Docs |
| --- | --- | --- |
| [Access and tenancy](./access/README.md) | Who may use ReadWise and with what authority: account admission and lifecycle, capability-based RBAC, organizations, memberships, classrooms, and tenant privacy. | 5 |
| [AI](./ai/README.md) | AI provider abstraction, prompt registry and versions, safety and structured output, evaluations, and the invocation ledger with budgets. | 6 |
| [Analytics](./analytics/README.md) | Product analytics event stream and retention, domain reporting read models, and tenant reporting privacy bounds. | 3 |
| [Architecture Decision Records](./architecture/README.md) | Architecture decision records: durable choices for the database, article access, audit logs, rate limiting, jobs, the AI ledger, media storage, tenancy, capabilities, and subsystem boundaries, with context and consequences. | 11 |
| [Content ingestion and policy](./content/README.md) | How articles enter and are governed: scraper providers and incremental discovery, extraction quality, the article library access policy, content policy, reporting, and legal content. | 8 |
| [Learning](./learning/README.md) | Learner experience and evidence: Today sessions, mastery and SRS, placement and levels, study plans, gamification, reading series, and teacher and classroom learning tools. | 16 |
| [Media](./media/README.md) | Media asset ownership and lifecycle, and local or Azure object storage. | 2 |
| [Observability](./observability/README.md) | Structured logging, tracing, metrics, SLOs, client error reporting, and the investigation workflow. | 3 |
| [Operations](./operations/README.md) | Running ReadWise: the job queue and worker, admin operations, releases and VM deployment, incident response, capacity, provider operations, and performance tuning. | 9 |
| [Platform](./platform/README.md) | Shared infrastructure: API handler and catalog, authentication foundation, database and runbooks, CI, runtime config, health, push, i18n, primitives, testing data, and supply chain. | 16 |
| [Reader](./reader/README.md) | The reading experience: annotations, bookmarks and lists, imports, dictionary, translation, playback, reading levels, reader tools, offline sync, search, recommendations, and citations. | 12 |
| [Security](./security/README.md) | Request protections, abuse prevention, and the data classification and retention matrix. | 3 |
| [Speech](./speech/README.md) | Narration generation (cloud TTS and on-device), word timing, and pronunciation practice. | 3 |
| [UI](./ui/README.md) | Design-system governance, accessibility baseline, and mobile reader and PWA behavior. | 3 |

<!-- END GENERATED: docs-index -->

## Adding or changing documentation

1. **Pick the subsystem** whose code owns the behavior (see each subsystem
   README's "Code ownership"). Prefer updating an existing document over adding a
   new one.
2. **Write or update the document** with the required frontmatter; keep
   `description` to one or two sentences (300 characters max) and put detail in
   the body. Feature docs include a `Code map`.
3. **Run `npm run docs:index`** to refresh the generated tables, then
   **`npm run docs:check`** (also enforced by `tests/docs-structure.test.ts`) to
   validate frontmatter, layout, titles, links, and index freshness.
4. **Adding a subsystem** is rare: create `docs/<subsystem>/README.md` with
   `type: "index"`, a scope paragraph, "Code ownership", and the generated block
   markers, then run `npm run docs:index`.

See [`platform/documentation-governance.md`](./platform/documentation-governance.md)
for document types, statuses, and the rename/merge/delete decision table.

## Maintenance rules

- Keep environment-variable tables consistent with `.env.example` and
  `src/lib/runtime-config/`.
- Keep script examples consistent with `package.json` and `scripts/*.ts` help
  output.
- Keep schema and model descriptions consistent with both
  `prisma/schema.prisma` and `prisma/postgresql/schema.prisma`.
- Generated documents (`platform/api-catalog.*`) are updated by their generator,
  never by hand.
