# Design System v1 full-surface refactoring runbook

This document is an executable runbook for coding agents. It turns the UI
standardisation decisions into a repeatable migration plan. Use it together with
[`design-system-governance.md`](./design-system-governance.md), which remains the
authoritative token/component reference.

## Outcome

Unify ReadWise product UI around the existing Studio design system:

- keep the current Studio visual direction in `src/app/tokens.css`,
- standardise typography, spacing, colour, radius, elevation, and focus states,
- force interactive UI through `src/components/ui/*` primitives,
- add missing page/layout primitives before migrating pages,
- migrate all product chrome and interactive controls in one coordinated effort,
- preserve Reader prose and imported article HTML as reading-system exceptions,
- preserve existing business flows, route structure, data shape, and information
  architecture.

## Non-goals

Do not use this refactor to redesign product behaviour.

- Do not change routes, API calls, Prisma models, access rules, analytics, or
  workflow semantics.
- Do not reorder form fields, admin columns, reader controls, or page sections
  unless a primitive requires a minimal wrapper.
- Do not rewrite Reader article prose, imported article HTML, highlight mark
  rendering, text-selection logic, or TTS word-highlight anchoring.
- Do not introduce a new brand direction, new colour palette, or parallel token
  system.

## Locked decisions

| Area | Decision |
| --- | --- |
| Rollout | Goal is full-site UI unification; implementation may be split into batches/PRs. |
| Visual direction | Reuse existing Studio tokens; do not redesign brand visuals. |
| Typography | Product UI uses `--text-*` tokens only; Reader prose uses `--reading-*` tokens. |
| Components | Interactive UI must use `src/components/ui/*` primitives. |
| Enforcement | Docs + `AGENTS.md` + ESLint/CI should enforce the rules. |
| DOM changes | Keep DOM/information architecture stable; only minimal wrappers for primitives. |
| Density | Use `default`, `compact`, and `reader` density modes, all token-driven. |
| Marketing | Included in the system; may use spacious/display variants, still token-driven. |
| Verification | Lint/tests are required; visual smoke is part of acceptance. |

## Source-of-truth files

Read these before editing UI:

- `src/app/tokens.css` — design-token source of truth.
- `src/components/ui/index.ts` — primitive export surface.
- `src/components/ui/*` — implementation patterns for primitives.
- `docs/ui/design-system-governance.md` — full governance and visual-regression
  reference.
- `docs/ui/accessibility.md` — focus, keyboard, contrast, and screen-reader
  baseline.
- `AGENTS.md` — always-on project rules for coding agents.

## Execution order

Do not start by editing random pages. Follow this order.

### 1. Foundation

1. Update docs and agent rules first:
   - `docs/ui/design-system-governance.md` when token/component contracts change,
   - this runbook when migration sequencing changes,
   - `AGENTS.md` when long-lived UI rules change.
2. Add missing reusable layout primitives in `src/components/ui/`:
   - `PageShell`,
   - `PageHeader`,
   - `Section`,
   - `Stack`,
   - `Inline`,
   - `Toolbar`,
   - `TableSurface`,
   - `FormActions`,
   - `EmptyState`.
3. Export new primitives from `src/components/ui/index.ts`.
4. Each primitive must use token values, `cn`, and `focusRing` where interactive.
5. Add JSDoc for keyboard/focus/accessibility expectations on new interactive
   primitives.

### 2. Enforcement

Add or extend ESLint rules so CI can block future drift. Start with changed/new
UI code and tighten allowlists as migration completes.

Current rollout: `readwise/ui-design-system` is enforced for
`src/components/ui/**` plus the migrated sign-in/onboarding/import/welcome,
settings, study/words/flashcard, teacher, offline, legal/static, app-shell,
dashboard/listing/list controls, Reader chrome/tools/popovers, selected
marketing chrome, and admin dashboard/sources/reports/table-wrapper surfaces.
Broaden the configured globs after each remaining legacy surface is migrated so
older UI can be converted intentionally.

Rules to enforce:

- no raw hex/rgb/hsl colour values outside `src/app/tokens.css`,
- no inline `fontSize`/raw font-size in product UI,
- no feature-owned business buttons (`<button>`) outside primitives or explicit
  low-level exceptions,
- no bare `<input>`, `<select>`, or `<textarea>` in product feature code,
- no custom focus rings outside primitives,
- no feature-local spinner/empty/error components when a primitive exists.

Allowlist intentionally narrow places:

- `src/components/ui/**` primitive internals,
- Reader prose and imported article HTML rendering paths,
- chart/canvas/SVG internals when token-driven styling is impossible,
- PWA/app metadata such as `src/app/manifest.ts` where colour literals are not
   rendered product UI,
- tests and fixtures where markup is not user-facing UI.

### 3. Migration waves

Migrate by surface. Within each surface, keep business logic and data flow intact.

1. **Core app surfaces**
   - sign-in,
   - dashboard,
   - settings/preferences,
   - app shell and navigation chrome.
2. **Reader + tools**
   - Reader toolbar and chrome,
   - dictionary popover,
   - vocabulary / quiz / translation / grammar panels,
   - mini-player and tool-panel states.
3. **Study + learning**
   - flashcards,
   - words/study list,
   - vocabulary journal,
   - progress/analytics UI.
4. **Admin + Teacher**
   - admin tables and filters,
   - moderation/job/member pages,
   - teacher workspace and classroom surfaces.
5. **Marketing + public/edge states**
   - landing/marketing cards,
   - offline page,
   - error/fallback pages.
6. **Final enforcement**
   - remove leftover custom styles,
   - tighten ESLint allowlists,
   - update visual smoke coverage,
   - update this runbook with any proven exceptions.

## Per-file migration checklist

For every migrated file:

1. Classify the surface:
   - `default` — dashboard/settings/study/reader tool panels,
   - `compact` — admin tables, bulk actions, dense data lists,
   - `reader` — article prose and reading-specific overlays,
   - `marketing` — public landing/display sections.
2. Replace interactive elements:
   - buttons → `Button` or `IconButton`,
   - inputs/selects/textareas → `Field` + `Input`/`Select`/`Textarea`,
   - switches → `Switch`,
   - floating UI → `Popover`/`Sheet`,
   - loading/empty/error → `Spinner`/`Skeleton`/`Panel*`/`EmptyState`.
3. Replace repeated page structure:
   - page wrapper → `PageShell`,
   - title/action row → `PageHeader`,
   - page region → `Section`,
   - dense action/filter row → `Toolbar`,
   - admin table wrapper → `TableSurface`,
   - form button row → `FormActions`.
4. Replace typography with token classes:
   - use `text-[length:var(--text-sm)]` style token references,
   - use `font-[family-name:var(--font-display)]` for display/title text when
     needed,
   - do not introduce `style={{ fontSize: ... }}` or arbitrary pixel/rem sizes.
5. Replace colours, borders, shadows, and radii with tokens:
   - `--bg`, `--surface`, `--surface-raised`,
   - `--text`, `--text-muted`, `--text-subtle`,
   - `--primary`, `--danger`, `--success`, `--warning`,
   - `--border`, `--border-strong`,
   - `--radius-*`, `--shadow-*`.
6. Keep DOM stable:
   - avoid changing order, nesting, IDs, names, route links, test hooks, and
     focus order unless required by a primitive,
   - for Reader, do not disturb `WordLookup`, highlight marks, prose selection,
     or audio word-boundary anchoring.
7. Run nearest reliable verification before moving on.

## Density rules

| Density | Use for | Typical tokens/components |
| --- | --- | --- |
| `default` | dashboard, settings, study, reader panels | `--text-base`, `--text-sm`, `--space-4`, `--space-5`, `Button size="md"` |
| `compact` | admin tables, filters, bulk actions, dense lists | `--text-sm`, `--text-xs`, `--space-2`, `--space-3`, `Button size="sm"` |
| `reader` | article prose and reading-specific UI | `--reading-*`, `--font-reading`, `data-reading-*` |
| `marketing` | landing/display sections | `--text-3xl`, `--text-4xl`, `--space-10..12`, `--gradient-brand` |

Density changes must be explicit props or named variants. Do not hand-tune raw
pixel/rem values per page.

## Required exceptions

The following are valid exceptions, but keep them narrow:

- Reader article prose and imported/sanitized HTML content.
- Highlight fills and pronunciation decorations that already use `--hl-*` or
  `--pron-*` reader tokens.
- Data visualisations where SVG/canvas needs domain-specific rendering; colours
  still should resolve through tokens where practical.
- Low-level primitive internals in `src/components/ui/**`.

## Visual smoke acceptance

At the end of each migration wave, spot-check at least:

- light theme,
- dark theme,
- mobile width,
- keyboard focus ring,
- loading state where feasible,
- empty state where feasible,
- error/fallback state where feasible.

High-value smoke surfaces:

- `/signin`,
- `/dashboard`,
- a Reader article page,
- Reader dictionary/vocabulary/quiz/translation/grammar surfaces,
- `/settings`,
- study/words pages,
- `/admin`,
- `/teacher`,
- landing/marketing page,
- offline/error pages.

## Verification commands

Use the smallest reliable scope first:

- docs-only: diagnostics plus Markdown link/path review,
- lint modified lintable files,
- run focused tests for modified behavior,
- run focused Playwright smoke for migrated UI surfaces,
- run full typecheck only when shared types, route contracts, generated types, or
  broad component APIs change.

Do not run a production build while the dev server is running.

## Definition of done

A migration wave is complete only when:

- no migrated product UI contains raw colour/font-size values,
- no migrated product UI hand-rolls interactive controls that primitives cover,
- relevant primitives are exported from `src/components/ui/index.ts`,
- light/dark/mobile smoke passes for migrated surfaces,
- keyboard focus remains visible and logical,
- Reader prose and selection behavior remain intact,
- docs and AGENTS rules still describe current behavior.
