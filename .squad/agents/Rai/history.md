# Project Context

- **Owner:** Ralph Agent
- **Project:** ReadWise
- **Stack:** Next.js, TypeScript, Prisma, SQLite default, PostgreSQL parity via Docker Compose, optional Azure OpenAI, Azure Speech, Web Push, object storage, and OpenTelemetry providers
- **Created:** 2026-07-01T10:12:10.549+00:00

ReadWise is an AI-assisted English learning reader for long-form news and educational articles. Rai watches for privacy, safety, credential, bias, accessibility, and content-risk issues, especially around AI enrichment and learner data.

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

- 2026-07-01T10:12:10.549+00:00 — Squad roster initialized for ReadWise: Morpheus (Lead), Trinity (Frontend Dev), Tank (Backend Dev), Mouse (Data/AI Pipeline), Switch (Tester), Scribe (Session Logger), Ralph (Work Monitor), Rai (RAI Reviewer). Static roster/routing/charter config was updated; mutable state remains owned by runtime state tools.

- 2026-07-11T08:08:13.000+00:00 — Privacy & data protection audit for PR #1006 (dev → main promotion): secrets scan clean (no hardcoded credentials), logging audit clean (no article text, PII, tokens, cookies, or raw SQL in production), retention/cascading deletes verified, GDPR Article 9 data exclusion confirmed, Article 9 protected attributes not collected, optional providers (AI, Speech, Push, OAuth, Storage) graceful fallback verified, no privacy policy violations. Audit passed.
- 2026-07-11T22:12:32.607+00:00 — FACT-CHECKER SCOPE CORRECTION to the 2026-07-11T08:08:13 PR #1006 privacy entry: the final gate verified the integrated diff contained no committed credentials and found no blocking privacy, injection, fixture, or difficulty-authority issue. The entry's retention/cascade, GDPR Article 9, and broad optional-provider assertions were not independently established by that final review and must not be treated as verified evidence. The final Rai verdict remains GREEN for the reviewed promotion diff.
- 2026-07-11T22:31:57.145+00:00 — Under shared identity, accepted review comments are the durable verdict record; preserve lockout chains and evidence comments instead of expecting formal approval objects.

## 2026-07-12 — RAI Review: Issue #1035 (Mobile UI Audit & Remediation)

- **Verdict:** 🟢 GREEN
- **Scope:** 16 files (+988/−19) — mobile safe-area contract, viewport-aware popover, reader dvh, BottomTabBar, Sheet, E2E + unit tests
- **Findings:**
  - Accessibility: Focus trap, Escape, focus-return, roving, ARIA roles all preserved; touch targets ≥ 56 px enforced; overlay scroll lock verified
  - Exclusion: Narrow (390–430 px), landscape (667 × 375), safe-area, dvh-with-vh-fallback all handled; desktop unaffected
  - Privacy: Synthetic-only E2E data; no secrets, PII, console leaks, or user content in artifacts
  - Safety: No harmful/deceptive behavior; no business logic changes
- **Comment:** https://github.com/huangyingting/ReadWise/issues/1035#issuecomment-4953097230
