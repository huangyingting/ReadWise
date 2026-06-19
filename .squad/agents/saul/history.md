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

### M3 — Landing Page Redesign (Studio) (2026-06-19) — SHIPPED (committed 2824eea)
Delivered the M3 UX spec and design direction for the landing page: auth-aware hero, 6-section layout (Marketing Header, Hero, Features, How It Works, Social Proof, Final CTA Band), Wordmark/MockReaderCard/FeatureCard/StepCard/Reveal component specs, `text-gradient-brand` + `rw-fade-up` motion spec. Basher PASS (30/30 checks). Committed 2824eea. Non-blocking D3 follow-up: CTA band `Button variant="secondary"` in dark theme — dark surface on gradient (14:1 WCAG AAA ✓); awaiting Saul sign-off before M9 polish pass.

### M4 — Listings & Discovery (2026-06-19) ✅ SHIPPED — committed 7e554c9
Delivered the full M4 UX spec (`saul-m4-listings.md`): redesigned `ArticleCardView` anatomy (CefrBadge top-left, byline, teal progress fill, done-chip "Read", hover/focus lift `-translate-y-0.5`+`shadow-md`+indigo title, `variant="grid"|"rail"` prop); §2.1 responsive grid (1/2/3-col, `listing-container` 1200px max-width); continue-reading rail spec (snap-scroll, `role="region"`, `tabIndex=0`); `EmptyState` and `SkeletonCard`/`SkeletonCardGrid` component specs; `CategoryBrowser` tab-bar (indigo active, NOT teal — accent rule upheld); dashboard/browse/tags/reader-related migration targets. ListingProgressSync DOM contract documented as sacred (5 hooks, zero renames). Linus built exactly to spec; Rusty APPROVE-WITH-NITS; Basher PASS (121 checks).
