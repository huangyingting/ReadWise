---
type: "template"
status: "template"
last_updated: "2026-07-19"
description: "Template for durable architecture decision records. Defines the expected ADR structure for context, decision, consequences, and follow-up."
---

# ADR-NNNN: Title

- **Status:** Proposed | Accepted | Superseded by ADR-NNNN
- **Date:** YYYY-MM-DD
- **Related:** #issue, #epic

## ADR structure

```mermaid
flowchart TD
    n0["Context"] --> n1["Decision"]
    n1["Decision"] --> n2["Alternatives considered"]
    n2["Alternatives considered"] --> n3["Consequences"]
    n3["Consequences"] --> n4["Follow-up work"]
```
## Context

What pressure, constraint, or product requirement made this decision necessary?

## Decision

What will ReadWise do?

## Alternatives considered

- **Option:** Why it was not chosen.
- **Option:** Why it was not chosen.

## Consequences

- Positive outcome.
- Trade-off or operational cost.
- Risk that must be watched.

## Follow-up work

- [ ] Issue or task needed to complete or revisit the decision.

