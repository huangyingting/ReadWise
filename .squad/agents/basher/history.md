# Project Context

- **Owner:** Yingting Huang
- **Project:** ReadWise — AI-assisted English learning reader. Articles are scraped from the internet; goal is a redesign into a modern, attractive, feature-rich website.
- **Stack:** Next.js 15 (App Router, TypeScript), React 19, Prisma + SQLite, NextAuth v4 (database sessions), Azure OpenAI / Azure Speech, Playwright.
- **Created:** 2026-06-19

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### M2 — Global App Shell (2026-06-19) ✅ SHIPPED — committed 385de06
Basher verified: CONDITIONAL PASS → D1 (inactive nav links indigo instead of gray; root cause: unlayered `a { color: var(--accent) }` in globals.css beats `@layer utilities`) → Linus fixed by wrapping in `@layer base`. Final: all shell checks pass. Open: N3 (UserMenu aria-label redundancy) → M8 a11y.
A full redesign roadmap (8 milestones) was produced by Rusty. Basher is engaged in:
- **M8 (Motion, a11y, responsive & loading-state QA pass):** Playwright sweep + WCAG AA contrast/focus-ring/keyboard a11y audit across all redesigned surfaces.
No active work yet — standby until M3–M7 are complete.
