# Project Context

- **Owner:** Yingting Huang
- **Project:** ReadWise — AI-assisted English learning reader. Articles are scraped from the internet; goal is a redesign into a modern, attractive, feature-rich website.
- **Stack:** Next.js 15 (App Router, TypeScript), React 19, Prisma + SQLite, NextAuth v4 (database sessions), Azure OpenAI / Azure Speech, Playwright.
- **Created:** 2026-06-19

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### M2 — Global App Shell (2026-06-19) ✅ SHIPPED — committed 385de06
Route group `src/app/(app)/` pattern confirmed: URL-transparent, zero middleware churn, single layout ownership. Admin untouched (own layout). Root layout untouched (fonts + no-flash + Providers). Nit N1 resolved: Admin link belongs in UserMenu/MobileDrawer (not AppNav) per Saul's finalized spec.