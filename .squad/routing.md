# Work Routing

How to decide who handles what.

## Routing Table

| Work Type | Route To | Examples |
|-----------|----------|----------|
| Scope, architecture, cross-cutting tradeoffs | Morpheus | Milestone planning, schema/API/UI contracts, reviewer gates, architectural decisions |
| Reader UI, design system, classroom/admin UX | Trinity | Next.js pages, React components, design tokens, accessibility, keyboard/focus behavior |
| Backend, APIs, database, optional providers | Tank | API routes, Prisma, SQLite/PostgreSQL parity, provider fallbacks, runtime configuration |
| Content ingestion, AI enrichment, study data | Mouse | Scrapers, article cleanup, enrichment pipelines, vocabulary/study workflows, data imports |
| Testing and quality | Switch | Focused tests, regression coverage, edge cases, graceful-degradation verification |
| Code review | Morpheus | Review PRs, check quality, suggest revisions |
| Session logging | Scribe | Automatic — never needs routing |
| Work monitoring | Ralph | Backlog scanning, issue keep-alive, work queue status |
| RAI review | Rai | Content safety, privacy, bias checks, credential detection, ethical review |

## Issue Routing

| Label | Action | Who |
|-------|--------|-----|
| `squad` | Triage: analyze issue, assign `squad:{member}` label | Morpheus |
| `squad:morpheus` | Pick up scope, architecture, review, or planning work | Morpheus |
| `squad:trinity` | Pick up frontend, UI, accessibility, classroom/admin UX work | Trinity |
| `squad:tank` | Pick up backend, API, database, provider, or runtime-config work | Tank |
| `squad:mouse` | Pick up scraper, ingestion, AI enrichment, or study-data work | Mouse |
| `squad:switch` | Pick up test, QA, regression, or verification work | Switch |
| `squad:rai` | Pick up RAI/content-safety/privacy review work | Rai |

### How Issue Assignment Works

1. When a GitHub issue gets the `squad` label, **Morpheus** triages it — analyzing content, assigning the right `squad:{member}` label, and commenting with triage notes.
2. When a `squad:{member}` label is applied, that member picks up the issue in their next session.
3. Members can reassign by removing their label and adding another member's label.
4. The `squad` label is the inbox — untriaged issues waiting for Lead review.

## Rules

1. **Eager by default** — spawn all agents who could usefully start work, including anticipatory downstream work.
2. **Scribe always runs** after substantial work, always as `mode: "background"`. Never blocks.
3. **Quick facts → coordinator answers directly.** Don't spawn an agent for "what port does the server run on?"
4. **When two agents could handle it**, pick the one whose domain is the primary concern.
5. **"Team, ..." → fan-out.** Spawn all relevant agents in parallel as `mode: "background"`.
6. **Anticipate downstream work.** If a feature is being built, spawn Switch to write test cases from requirements simultaneously.
7. **Issue-labeled work** — when a `squad:{member}` label is applied to an issue, route to that member. Morpheus handles all `squad` base-label triage.
