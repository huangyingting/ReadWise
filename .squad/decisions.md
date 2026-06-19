# Squad Decisions

## Active Decisions

### DECIDED — Design Direction: B "Studio"
_Chosen by Yingting · 2026-06-19_
**Direction B "Studio" is LOCKED** for the redesign — modern learning-app aesthetic: vivid indigo/violet primary (+ teal/amber accents), Inter/Geist via `next/font`, soft elevated cards, Lucide icons, light + dark themes. Touchstones: Linear / Duolingo / Vercel. All design-system and UI work follows this direction.
Alternatives not chosen: A "Broadsheet" (editorial/serif), C "Focus" (minimal/monochrome).

### Redesign Roadmap — 8 Milestones (proposed, sequential)
_Proposed by Rusty · 2026-06-19_
Scope: ~70% elevate existing / ~30% net-new. Design-system-first. Each milestone leaves `main` runnable, typecheck-clean, lint-clean.
- **M1** Design system foundation — token layer + base components (Button/Card/Pill/Input/Select/Skeleton). Refactor `globals.css`. _(Saul lead, Linus)_
- **M2** Global app shell — shared responsive header/nav/footer + user menu + mobile drawer. _(Linus, Saul)_
- **M3** Landing/marketing redesign — hero, feature showcase, CTA, auth-aware states. _(Saul, Linus)_
- **M4** Browse & discovery — hero thumbnails, skeleton loaders, empty states, global search (net-new). _(Linus, Livingston for search endpoint)_
- **M5** Reader redesign (crown jewel) — reading-optimized layout, font/theme controls (net-new), AI tools as sticky tabbed panel instead of vertical stack. _(Saul, Linus)_
- **M6** Dashboard & Study — progress visualization, reading streaks/daily goal + flashcard review (net-new spaced repetition). _(Linus, Livingston)_
- **M7** Admin polish — apply design system to `/admin`. _(Linus)_
- **M8** Motion, a11y, responsive & loading-state QA pass. _(Basher, Linus)_
Recommended first: **M1** (lowest risk, unblocks everything).

### Design Token Foundation (direction-agnostic, ready to implement)
_Proposed by Saul · 2026-06-19_
CSS custom properties on `:root` + `[data-theme="dark"]` + `@media (prefers-color-scheme)`. Semantic color tokens (bg/surface/border/text/primary/accent/success/warning/danger/focus-ring); 1.20 minor-third type scale (`--text-xs` → `--text-4xl`); 4px-base spacing scale (`--space-1..12`); radii (`--radius-sm/md/lg/xl/full`); elevation/shadow (`--shadow-sm/md/lg/xl`); motion durations + easings wrapped in `prefers-reduced-motion`. Fonts via `next/font`.

### Frontend Inventory — Key Refactor Targets
_Proposed by Linus · 2026-06-19_
Current state: 957-line `globals.css`, 6 CSS vars, dark-only, system font, no global nav. High-priority consolidation targets:
1. Extract `Button`, `Input`, `Select`, `Card`, `Badge/Pill`, `Spinner/Skeleton` primitives.
2. Create shared `LazyPanel` (unifies the 4 identical AI-panel open/fetch patterns).
3. Create shared `ConfirmAction` (currently copy-pasted in `AdminArticleActions`, `AdminMemberActions`, `AdminTagActions`).
4. Add shared `<Header>/<Nav>` for reader-facing app (currently missing entirely).
5. Replace scattered inline `style={{}}` props with layout utilities.
6. Introduce `next/font` and a proper modular type scale.

### Net-New Features Greenlit (in roadmap)
_Proposed by Rusty · 2026-06-19_
- **Reader font/theme controls** (M5): font-size steps + light/sepia/dark theme persisted to localStorage.
- **Saved-word flashcard review** (M6): spaced repetition over existing `SavedWord` model.
- **Reading streaks / daily goal** (M6): new dashboard widget.
- **Global article search** (M4): new search endpoint (Livingston) + search UI.

### Must-Not-Break Constraints (all milestones)
_Proposed by Rusty · 2026-06-19_
Prisma schema & committed migrations; AI graceful degradation (`fallback:true`); NextAuth DB-session + role attach; `middleware.ts` matcher paired with `requireSession`/`requireOnboardedSession`/`requireAdmin`; `sanitizeArticleHtml` always wraps `dangerouslySetInnerHTML`; `ListingProgressSync` DOM contract (`js-progress-bar/label/done`, `data-article-id`); US-030 cache tag invalidation; cached fns prisma-only/date-safe.

---

## M1 — Design System Foundation: COMPLETE
_2026-06-19 · Yingting Huang (requester) · Rusty, Saul, Linus, Basher_

**Status: LANDED** — typecheck 0 errors · lint 0 errors · build green (27 routes) · both themes verified · working tree clean (DEFECT-1 fixed).

### What shipped
- **Tailwind CSS v4** (`tailwindcss@4.3.1` + `@tailwindcss/postcss@4.3.1`, CSS-first, no `tailwind.config.js`) layered non-destructively over `src/app/globals.css`.
- **`src/app/tokens.css`** — single source of truth: theme-invariant scales (type/spacing/radii/motion + `prefers-reduced-motion`) on `:root`; semantic color + elevation tokens with light as `:root` default, dark via `:root[data-theme="dark"]` + `@media (prefers-color-scheme: dark)` no-JS fallback. Saul's exact hex values (WCAG AA verified).
- **Legacy aliases preserved** (`--panel→--surface`, `--muted→--text-muted`, `--accent→--primary`; `--bg/--text/--border` kept first-class). 957-line `globals.css` fully intact below the new header.
- **Theme mechanism:** blocking inline `<head>` script sets `data-theme` pre-paint (no FOUC). Storage key: `readwise:theme` (`"light"|"dark"`). Visible toggle deferred to M2.
- **3 `next/font/google` families:** Inter (`--font-sans`), Space Grotesk (`--font-display`), Literata (`--font-reading`).
- **8 UI primitives** in `src/components/ui/*` + `src/lib/cn.ts` (clsx + tailwind-merge + shared `focusRing`): Button, Card (+sub), Input, Select, Field/Label, Badge (+CefrBadge A1–C2, CategoryBadge), Skeleton (+SkeletonText), Spinner. All cva-variant, token-driven, zero `"use client"`, RSC-compatible. Exported via barrel; feature pages NOT yet migrated.
- **New deps:** `lucide-react@1.21.0`, `clsx@2.1.1`, `tailwind-merge@3.6.0`, `class-variance-authority@0.7.1`.

### Review & verify verdicts
- **Rusty (code-review gate):** APPROVE-WITH-NITS — no blockers; 5 nits tracked below.
- **Basher (independent verify):** CONDITIONAL PASS — 1 defect (DEFECT-1) found and fixed; theme/focus/primitives/regressions all pass.
- **DEFECT-1 (fixed):** `suppressHydrationWarning` was missing on `<html>` in `layout.tsx`; added by Linus before landing.

### Open / deferred items
| ID | Item | Owner | When |
|---|---|---|---|
| OPT-A | `--accent` split: CSS var = indigo (legacy continuity); teal exposed as `--teal*` + Tailwind `accent` utility for new components. Confirm or flip (one-line change in `tokens.css`). | Saul + Yingting | M2 kickoff |
| N2 | Global `:focus-visible` CSS rule (currently only on primitives via `focusRing`; legacy pages use browser defaults) | Linus | M8 a11y pass |
| N3 | Spinner track: `strokeOpacity="0.2"` vs `color-mix(…, var(--border))` per Saul spec | Linus | M8 a11y pass |
| N4 | Create `src/lib/theme.ts` `setTheme()` helper for M2 to consume | Linus | Before M2 theme toggle |
| N5 | `--text-inverted` added as `var(--bg)` — Saul to confirm value | Saul | M2 kickoff |

---

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
