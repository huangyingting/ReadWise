# Project Context

- **Owner:** Ralph Agent
- **Project:** ReadWise
- **Stack:** Next.js, TypeScript, Prisma, SQLite default, PostgreSQL parity via Docker Compose, optional Azure OpenAI, Azure Speech, Web Push, object storage, and OpenTelemetry providers
- **Created:** 2026-07-01T10:12:10.549+00:00

ReadWise is an AI-assisted English learning reader for long-form news and educational articles. Scribe maintains decisions, logs, and cross-agent context without doing domain work.

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

- 2026-07-01T10:12:10.549+00:00 — Squad roster initialized for ReadWise: Morpheus (Lead), Trinity (Frontend Dev), Tank (Backend Dev), Mouse (Data/AI Pipeline), Switch (Tester), Scribe (Session Logger), Ralph (Work Monitor), Rai (RAI Reviewer). Static roster/routing/charter config was updated; mutable state remains owned by runtime state tools.


- 2026-07-01T20:03:33.362+00:00 — Scribe merged the coverage strategy decision, cleared the inbox item, wrote coverage session/orchestration logs, and propagated cross-agent history updates.
- 2026-07-02T00:30:07.481+00:00 — Scribe logged PR #874 modular refactor cleanup, confirmed an empty decision inbox, wrote orchestration/session logs, and propagated cross-agent history updates.

- 2026-07-05T22:05:44.651+00:00 — Scribe logged the release gate recovery, merged Tank's release workflow decision inbox note into `decisions.md`, cleared the inbox note, and recorded validation/state without committing repository changes.
- 2026-07-05T23:02:20.863+00:00 — Scribe logged the semantic UI audit split, merged Trinity's decision inbox note, cleared the inbox note, and recorded Switch's validation without committing repository changes.

- 2026-07-07T07:54:41.474+00:00 — Logged Mouse/Tank/Switch difficulty-scoring findings, wrote per-agent orchestration logs plus a session summary, and recorded the CEFR/Lexile-like calibration recommendation in `decisions.md` without committing repository changes.

- 2026-07-07T08:02:46.354+00:00 — Recorded a correction to the CEFR/Lexile-like difficulty evaluation: provider DBs under `prisma/provider-dbs/*` supersede the earlier `prisma/e2e.db` empirical result for this analysis; wrote correction logs and appended the supersession note to `decisions.md` without committing repository changes.


- 2026-07-07T09:08:07.205+00:00 — Logged CEFR calibration v2 session/orchestration state, recorded the NC-licensed temporary calibration-source caveat in `decisions.md`, and propagated Mouse/Tank/Switch history updates without committing repository changes or modifying non-`.squad` files.


- 2026-07-07T10:06:10.688+00:00 — Logged OneStopEnglish v3 calibration state, recorded accepted CC BY-SA 4.0 ordinal-anchor caveats in `decisions.md`, cleared Tank's accepted inbox note, and propagated Mouse/Tank/Morpheus/Switch history updates without committing or modifying non-`.squad` files.
