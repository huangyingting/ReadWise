# Project Context

- **Owner:** Yingting Huang
- **Project:** ReadWise — AI-assisted English learning reader. Articles are scraped from the internet; goal is a redesign into a modern, attractive, feature-rich website.
- **Stack:** Next.js 15 (App Router, TypeScript), React 19, Prisma + SQLite, NextAuth v4 (database sessions), Azure OpenAI / Azure Speech, Playwright.
- **Created:** 2026-06-19

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### M1 — Design System Foundation (2026-06-19) ✅ SHIPPED
- **Adopted Tailwind CSS v4** (CSS-first, `@tailwindcss/postcss`, NO `tailwind.config.js`) layered over a CSS-custom-property token system. Non-destructive: the 957-line `globals.css` keeps working unchanged.
- **Token layer = `src/app/tokens.css`** (single source of truth): theme-invariant scales (type/space/radii/motion) on `:root`; semantic colours + elevation with LIGHT as `:root` default, dark via `:root[data-theme="dark"]` + a `@media (prefers-color-scheme: dark)` no-JS fallback. Legacy 6 vars preserved/aliased: `--panel→--surface`, `--muted→--text-muted`, `--accent→--primary`; `--bg/--text/--border` kept.
- **`--accent` collision resolved:** Rusty's doc and Saul's doc disagreed (brand-indigo vs teal). Kept the CSS var `--accent` = indigo `--primary` for legacy brand/link continuity; exposed Saul's teal as `--teal*` tokens mapped to the Tailwind `accent` utility for NEW components. No M1 primitive uses teal.
- **`@theme inline` gotcha:** only the `--color-*` namespace is collision-free. Mapping `--font-*`/`--radius-*`/`--shadow-*`/`--text-*` in `@theme` to same-named tokens is circular — so primitives reference those via arbitrary values (`rounded-[var(--radius-md)]`, `text-[length:var(--text-sm)]`, `shadow-[var(--shadow-sm)]`). Skeleton shimmer is registered as `--animate-shimmer` + a top-level `@keyframes`.
- **Theme mechanism:** blocking inline `<head>` script reads `localStorage["readwise:theme"]` (or system) and sets `data-theme` pre-paint (no FOUC). Visible toggle is M2. Three `next/font/google` families (Inter `--font-sans-src`, Space Grotesk `--font-display-src`, Literata `--font-reading-src`) → composed with fallbacks in tokens.css.
- **Primitives in `src/components/ui/*`** (cva + `src/lib/cn.ts` = clsx+tailwind-merge, plus shared `focusRing`): Button, Card(+sub), Input, Select, Field/Label, Badge (+CefrBadge A1–C2, CategoryBadge), Skeleton(+SkeletonText), Spinner. Built/exported only — feature pages NOT refactored (per-feature milestones).
- **Reusable patterns for later milestones:** import primitives from `@/components/ui`; use `focusRing` from `@/lib/cn` for any new interactive element; CEFR colour map lives in `Badge.tsx` (`CEFR_LEVELS`/`CefrBadge`).
- **TODO before M2:** Create `src/lib/theme.ts` exposing a `setTheme(value: "light"|"dark")` helper (write `localStorage["readwise:theme"]` + set `document.documentElement.dataset.theme`) for the M2 visible theme toggle to consume (N4 from Rusty's review).
