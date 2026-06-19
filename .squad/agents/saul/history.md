# Project Context

- **Owner:** Yingting Huang
- **Project:** ReadWise — AI-assisted English learning reader. Articles are scraped from the internet; goal is a redesign into a modern, attractive, feature-rich website.
- **Stack:** Next.js 15 (App Router, TypeScript), React 19, Prisma + SQLite, NextAuth v4 (database sessions), Azure OpenAI / Azure Speech, Playwright.
- **Created:** 2026-06-19

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### M2 — Global App Shell (2026-06-19) ✅ SHIPPED — committed 385de06
OPT-A resolved FINAL: `--accent` stays indigo. `--bg-accent: var(--teal)` / `--text-accent: var(--teal-text)` aliases added in tokens.css. Indigo = interactive; teal = reading-state (active nav underline, progress bars, CEFR badges). Nit N2: AppFooter correctly client (usePathname); Saul's "server" label in impl checklist was stale.
- Delivered the full Studio token spec: Inter/Space Grotesk/Literata font trio, 35 semantic color tokens (light+dark, WCAG AA verified), type/spacing/radii/shadow/motion scales, per-primitive visual specs. All values wired by Linus exactly as specced.
- **Pending at M2 kickoff (OPT-A):** `--accent` CSS var was kept as indigo (`var(--primary)`) for legacy continuity; Saul's teal exposed as `--teal*` tokens + Tailwind `accent` utility for new components. Confirm or flip at M2 kickoff before teal is used in new components.
- **Pending at M2 kickoff (N5):** Linus added `--text-inverted: var(--bg)` (not in Saul's original table). Confirm this is the right value.
