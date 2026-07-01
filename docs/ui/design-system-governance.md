---
type: "policy"
status: "current"
last_updated: "2026-07-01"
description: "Documents design-system ownership, token/primitive governance, import rules, density variants, and visual regression boundaries. Captures current token usage, shared UI primitives, ESLint drift checks, density rules, focus states, and CI screenshot plan."
---

# Design-System Governance & Visual Regression Plan

> **Related:** [Accessibility baseline](./accessibility.md) (#726) · [Platform primitives](../platform/primitives.md) · `src/app/tokens.css` · `src/components/ui/`

---

## 1. Purpose

ReadWise ships UI across five surfaces — Reader, Admin, Study, Teacher, and
Marketing — each with its own data density and interaction model. Design System
v1 is now the durable product-UI contract; this document is the canonical source
for ongoing rules after the migration, not a migration checklist.

This document gives every contributor a shared, lightweight contract for:

- which tokens to use and how to name new ones,
- when a feature component should delegate to a `src/components/ui/` primitive
  versus encapsulate its own styles,
- how the `data-theme` / `data-reading-mode` theming model works,
- the contribution rules that keep the token graph acyclic and raw values out
  of feature code, and
- a scoped visual regression plan built on top of the existing Playwright
  infrastructure.

No Storybook migration is required. Do not keep one-off refactoring runbooks for
completed UI migrations; promote lasting rules into this document and delete the
temporary plan.

---

## 2. Token System

### 2.1 Source of truth

All design tokens live in a single file:

```
src/app/tokens.css
```

The file is authoritative.  Tokens are CSS custom properties consumed by
Tailwind's `[]` escape syntax and by raw `var()` calls inside component
`className` strings.  Do **not** duplicate token values in `tailwind.config.*`
or any other location.

### 2.2 Token families

| Family | Prefix(es) | Applied on | Notes |
|--------|-----------|-----------|-------|
| **Type scale** | `--text-*`, `--leading-*` | `:root` (invariant) | 1.20 minor-third scale, base 16 px |
| **Spacing** | `--space-*` | `:root` (invariant) | 4 px base; steps 1–12 |
| **Radii** | `--radius-*` | `:root` (invariant) | xs / sm / md / lg / xl / full |
| **Motion** | `--duration-*`, `--ease-*` | `:root` (invariant) | Collapsed to `0.01ms` under `prefers-reduced-motion` |
| **Z-index** | `--z-*` | `:root` (invariant) | Named stacking layers; preserve ascending order |
| **Breakpoints** | `--bp-*` | `:root` (doc-only) | Cannot be used in `@media`; use literal values |
| **Layout constants** | `--header-height`, `--bottom-bar-h`, `--sidebar-w`, etc. | `:root` (invariant) | |
| **Semantic colour** | `--bg`, `--surface`, `--text`, `--primary`, `--danger`, `--success`, `--warning`, etc. | `:root` (light) + `:root[data-theme="dark"]` | See §3 |
| **Elevation** | `--shadow-*` | `:root` / dark override | |
| **Reading surface** | `--reading-*` | `[data-reading-mode="light|sepia|dark"]` | Reader-scoped; never apply to `<html>` |
| **Reading typography** | `--font-reading`, `--reading-line-height`, `--reading-letter-spacing` | `[data-reading-font="…"]`, `[data-reading-spacing="…"]` | |
| **Highlight markers** | `--hl-*` (dot swatches on notes page), `--hl-yellow/green/blue/pink` (reading fills) | Reading-mode blocks | User-authored content; separate from teal (reading-state) and indigo (interactive) |
| **Pronunciation feedback** | `--pron-*` | Reading-mode blocks | Text-decoration use; never tints word glyphs |
| **CEFR badges** | `--cefr-{a1..c2}-{bg,text}` | `:root` (light) + dark override | AA-verified per-level palette |
| **Activity heatmap** | `--heat-{0..4}` | `:root` (light) + dark override | 5 heat levels |
| **Stat accents** | `--stat-vocab`, `--stat-streak`, `--stat-quiz` | `:root` (light) + dark override | Progress page only |
| **Semantic accent aliases** | `--bg-accent`, `--text-accent` | `:root` | Aliases `--teal` / `--teal-text`; reading-state only, never interactive |

### 2.3 Semantic colour intent

| Token | Intended use |
|-------|-------------|
| `--primary` / `--primary-hover` / `--on-primary` | Interactive affordances — buttons, links, active tabs |
| `--teal` / `--teal-hover` / `--teal-text` | Reading-state indicators only (progress fills, active nav underline, CEFR accent) — **never** a clickable affordance |
| `--success` / `--warning` / `--danger` | Status feedback — toasts, alerts, validation |
| `--bg` | Page background |
| `--bg-subtle` | Inset or secondary surfaces (sidebar, table striping) |
| `--surface` | Default card / panel surface |
| `--surface-raised` | Elevated panels (popovers, sheets) |
| `--border` / `--border-strong` | Hairlines and input strokes |
| `--text` / `--text-muted` / `--text-subtle` | Body text hierarchy |
| `--focus-ring` / `--ring-offset` | Focus indicators — consumed by `focusRing` in `src/lib/cn.ts` |
| `--overlay` | Modal / scrim backdrops |

### 2.4 Naming conventions for new tokens

Follow the pattern `--{family}-{modifier}`:

- **Family** is the semantic intent (`surface`, `text`, `border`, `shadow`, `reading-*`).
- **Modifier** is an adjective (`raised`, `muted`, `strong`, `hover`).
- **Never** use raw hex values outside `tokens.css`.
- **Never** add a Tailwind utility class that hard-codes a colour — always use
  `text-[var(--token)]` or `bg-[color-mix(in_srgb,var(--token)_14%,transparent)]`.
- New tokens for a feature (e.g., a new badge palette) belong in `tokens.css`
  in the correct semantic block, with both light and dark values and a WCAG AA
  contrast comment.

### 2.5 Ownership

`tokens.css` is owned by **Design (Saul)** and the **UI platform team**.
Changes that add, rename, or remove semantic colour tokens require a design
review.  Invariant-scale tokens (type, spacing, radii, motion) require design
sign-off and a migration note for any affected component.

---

## 3. Theming Model

### 3.1 Global theme — `data-theme`

The `data-theme` attribute is set on `<html>` (`:root`) by a blocking script
in `layout.tsx` before first paint.  It has three states:

| Value | Description |
|-------|-------------|
| *(absent)* / `"light"` | Default — light semantic tokens from `:root` |
| `"dark"` | Dark semantic tokens from `:root[data-theme="dark"]` |

A `@media (prefers-color-scheme: dark)` fallback in `tokens.css` activates dark
values for the no-JS path when `data-theme="light"` is not explicitly set.
The `[data-theme="dark"]` block is the **canonical source**; the `@media` block
mirrors it exactly — keep them in sync on every dark-token change.

### 3.2 Reader surface — `data-reading-mode`

Applied to the **reader root `<div>`**, not `<html>`.  Allows a dark-chrome
app + light-reading-surface combination.  Three values: `light`, `sepia`,
`dark`.

> Rule: `--reading-*` tokens are scoped to the reader column.  Do not use them
> in non-reader components.

### 3.3 Reading typography

| Attribute | Values | Effect |
|-----------|--------|--------|
| `data-reading-font` | `sans`, `dyslexic` (default = system serif) | Overrides `--font-reading` |
| `data-reading-spacing` | `normal`, `comfortable`, `spacious` | Overrides `--reading-line-height` + `--reading-letter-spacing` (WCAG 1.4.12) |

---

## 4. Primitive Component Catalog

All primitives live in `src/components/ui/` and are re-exported through
`src/components/ui/index.ts`.  Import from the barrel:

```ts
import { Button, Badge, Card } from "@/components/ui";
```

### 4.0 Import contract

`@/components/ui` is the canonical import path for shared product-UI
primitives. Feature code must import `PageShell`, `PageHeader`, `Section`,
`Stack`, `Inline`, `Toolbar`, `TableSurface`, `FormActions`, and `EmptyState`
from that barrel or from their direct `src/components/ui/*` file only when a
low-level import is necessary.

Do **not** add compatibility re-export files such as `src/components/EmptyState.tsx`
or `src/components/shell/PageShell.tsx`. If an old path is superseded, update
callers to the canonical UI primitive and delete the old path in the same change.
Feature-local wrappers are acceptable only when they add feature behavior or
semantics; pure aliases are drift.

### 4.1 Catalog

| Primitive | File | Variants / Props | When to use |
|-----------|------|-----------------|-------------|
| **Button** | `Button.tsx` | `variant`: primary · secondary · ghost · danger · danger-ghost · outline; `size`: sm · md · lg; `loading`, `leadingIcon`, `trailingIcon` | All user-initiated actions |
| **IconButton** | `IconButton.tsx` | `variant`: ghost · outline · primary; `size`: sm · md · lg; `aria-label` required | Icon-only actions (toolbar buttons, close buttons) |
| **Badge** | `Badge.tsx` | `variant`: neutral · primary · success · warning · danger; `uppercase` | Status labels, counts, tag chips |
| **CefrBadge** | `Badge.tsx` | `level`: A1–C2 | Difficulty-level indicators — uses `--cefr-*` palette |
| **CategoryBadge** | `Badge.tsx` | `selected` | Topic/category selection chips |
| **Card** | `Card.tsx` | `interactive` (hover lift) | Content containers; `CardHeader`, `CardTitle`, `CardMeta`, `CardBody`, `CardFooter` sub-components |
| **Input** | `Input.tsx` | `variant`: default · error; `size`: sm · md · lg | Single-line text inputs |
| **Textarea** | `Textarea.tsx` | `variant`: default · error | Multi-line text inputs |
| **Select** | `Select.tsx` | `variant`: default · error | Native `<select>` wrapper |
| **Field** | `Field.tsx` | — | Label + input + error-message grouping |
| **Switch** | `Switch.tsx` | `checked`, `onCheckedChange`, `label`, `description` | Boolean toggles (settings, preferences) |
| **Skeleton** | `Skeleton.tsx` | `shape`: text · block | Loading placeholders — shimmer animation, reduced-motion safe |
| **SkeletonText** | `Skeleton.tsx` | `lines` | Multi-line text loading skeleton |
| **Spinner** | `Spinner.tsx` | `size`: sm · md · lg | Indeterminate progress — inline or centred |
| **Tooltip** | `Tooltip.tsx` | `content`, `side`, `delay` | Supplemental labels for icon buttons and truncated text |
| **Popover** | `Popover.tsx` | `trigger`, `content`, `side` | Anchored floating content (dropdowns, word-lookup panel) |
| **Sheet** | `Sheet.tsx` | `open`, `onClose`, `side` | Side-panel / drawer overlays |
| **SegmentedControl** | `SegmentedControl.tsx` | `options`, `value`, `onChange` | Mutually exclusive view-mode tabs |
| **Avatar** | `Avatar.tsx` | `src`, `name`, `size` | User identity — initials fallback |
| **PageShell** | `PageShell.tsx` | `variant`: listing · narrow · reading · marketing · full; `density`: default · compact · reader · marketing | Standard centred page container |
| **PageHeader** | `PageHeader.tsx` | `density`, `align`, `title`, `description`, `actions`, `level` | Page title/description/action rows |
| **Section** | `Section.tsx` | `surface`: plain · card · subtle; `density`, `title`, `description`, `actions` | Reusable page regions |
| **Stack** | `Stack.tsx` | token gap + alignment variants | Vertical layout rhythm |
| **Inline** | `Inline.tsx` | token gap, alignment, justify, wrap variants | Horizontal layout rhythm |
| **Toolbar** | `Toolbar.tsx` | `density`, `align`, `justify`, `surface` | Related action/filter rows |
| **TableSurface** | `TableSurface.tsx` | `density`: default · compact · reader · marketing | Tokenised scroll surface around semantic tables |
| **FormActions** | `FormActions.tsx` | `density`, `align` | Submit/cancel action rows |
| **EmptyState** | `EmptyState.tsx` | `icon`, `title`, `description`, `action`, `titleAs` | Empty collection/page states |
| **PanelLoading** | `ReaderToolPanelState.tsx` | `message` | Tool/study-panel loading state |
| **PanelError** | `ReaderToolPanelState.tsx` | `message` | Tool/study-panel error state |
| **PanelFallback** | `ReaderToolPanelState.tsx` | `title`, `description` | Unavailable-provider state |
| **PanelEmpty** | `ReaderToolPanelState.tsx` | `title`, `description` | Empty-collection state |

### 4.2 Focus and accessibility contracts

Every interactive primitive embeds the `focusRing` utility from `src/lib/cn.ts`:

```ts
export const focusRing =
  "outline-none focus-visible:[box-shadow:0_0_0_2px_var(--ring-offset),0_0_0_4px_var(--focus-ring)]";
```

Rules:
- Pass `aria-label` on any icon-only interactive element.
- Popovers and Sheets must integrate `useFocusTrap` (see [Accessibility baseline](./accessibility.md)).
- `Spinner` is purely decorative; it must not receive focus.
- `Skeleton` renders with `aria-hidden`.

### 4.3 When to use a primitive vs. feature-local styling

**Use the primitive** when:
- The element is interactive (button, input, toggle, popover, sheet).
- The pattern appears in two or more unrelated features.
- The component encapsulates an accessibility contract (focus ring, focus trap,
  roving tabindex, `aria-*` attributes).

**Feature-local styling is acceptable** when:
- The element is purely presentational (a decorative divider, a specific chart
  annotation) and is not reused outside one feature directory.
- The component is a layout wrapper that composes primitives but adds no
  interactive behaviour.
- The pattern is too feature-specific to generalise without a `prop` explosion.

**Promote a feature component** to `src/components/ui/` when it is imported
from two or more unrelated feature directories and carries an accessibility or
theming contract worth sharing.  Follow the same checklist as adding a new
primitive (§5.2).

### 4.4 Anti-patterns

| Anti-pattern | Correct approach |
|-------------|-----------------|
| `className="bg-indigo-600 text-white rounded-md"` — raw Tailwind colour | `<Button variant="primary">` |
| `style={{ color: "#4f46e5" }}` — inline raw value | `className="text-[var(--primary-text)]"` |
| Custom `<button>` with handwritten focus ring | `<Button variant="ghost">` or `<IconButton>` |
| Separate loading spinner built per-feature | `<Spinner>` or `<PanelLoading>` |
| Empty-state markup duplicated per panel | `<PanelEmpty>` |
| `--reading-bg` used outside the reader column | Use `--bg` / `--surface` instead |
| `--teal` used as a clickable-affordance colour | Use `--primary` for interactive elements |
| New badge with hard-coded hex | Add `--my-badge-*` tokens to `tokens.css`, then use from `Badge` or a new token-driven class |

### 4.5 Density rules

Use explicit density variants instead of per-page one-off sizing. Admin and data
dense UI may be compact, but it must still use shared tokens and primitives.

| Density | Use for | Typical tokens/components |
| --- | --- | --- |
| `default` | Dashboard, settings, study, reader tool panels | `--text-base`, `--text-sm`, `--space-4`, `--space-5`, `Button size="md"` |
| `compact` | Admin tables, filters, bulk actions, dense lists | `--text-sm`, `--text-xs`, `--space-2`, `--space-3`, `Button size="sm"` |
| `reader` | Article prose and reading-specific UI | `--reading-*`, `--font-reading`, `data-reading-*` |
| `marketing` | Landing/display sections | `--text-3xl`, `--text-4xl`, `--space-10..12`, `--gradient-brand` |

Density changes must be explicit primitive props or named variants. Do not tune
raw pixel/rem values per page.

### 4.6 Valid exceptions

Keep exceptions narrow and documented:

- Reader article prose and imported/sanitized article HTML.
- Highlight fills and pronunciation decorations that already use `--hl-*` or
  `--pron-*` reader tokens.
- Data visualisations where SVG/canvas needs domain-specific rendering; colours
  should still resolve through tokens where practical.
- Low-level primitive internals in `src/components/ui/**`.
- PWA/app metadata such as `src/app/manifest.ts`, where colour literals are
  metadata rather than rendered product UI.

---

## 5. Contribution Rules

### 5.1 Token changes

1. All token additions and changes land in `src/app/tokens.css`.
2. New semantic colour tokens require values in **both** `:root` (light),
   `:root[data-theme="dark"]`, and the `@media prefers-color-scheme: dark`
   fallback block.
3. Include a WCAG contrast ratio comment on every colour token pair
   (e.g., `/* #047857 on white: 5.9:1 AA */`).
4. Reading-mode (`--reading-*`) and highlight (`--hl-*`) tokens must be
   provided in all three reading modes: `light`, `sepia`, `dark`.
5. Rename or remove tokens only via a migration PR that updates all call sites.

### 5.2 Adding a new primitive

1. Place the file in `src/components/ui/<Name>.tsx`.
2. Export the component **and** its prop type from the file.
3. Add a named export to `src/components/ui/index.ts`.
4. Use `cn` + `focusRing` from `@/lib/cn` — never reconstruct a focus ring
   inline.
5. Style exclusively with `var(--token)` references — no raw hex or numeric
   colour values in `className` or `style`.
6. Use `cva` (class-variance-authority) for multi-variant components.
7. Add a JSDoc comment to the component documenting: keyboard behaviour, focus
   contract, and at least one usage example.
8. If the component is interactive, note the required `aria-*` attributes.

### 5.3 ESLint enforcement

The custom `readwise/ui-design-system` rule in `eslint-rules/ui-design-system.js`
guards migrated product UI against drift. It reports:

- raw hex/rgb/hsl colour literals,
- raw Tailwind font-size utilities and inline `fontSize`,
- bare `<button>`, `<input>`, `<select>`, and `<textarea>` where a UI primitive
  should be used,
- custom focus-ring classes outside primitive internals,
- feature-local spinner/loading/empty/error patterns when a shared primitive
  exists.

When a UI surface is migrated, add it to the configured enforcement globs in
`eslint.config.mjs`. For broad UI work, also run the drift scan against
`src/app` and `src/components` so hidden drift does not survive outside the
staged ESLint globs.

### 5.4 PR checklist for UI changes

- [ ] No raw colour values in changed files — only `var(--token)` references.
- [ ] No feature code imports from superseded compatibility paths; shared UI
  primitives come from `@/components/ui`.
- [ ] No bare product-UI buttons, inputs, selects, textareas, hand-rolled focus
  rings, spinners, empty states, or error states when a primitive exists.
- [ ] New tokens added to `tokens.css` with light + dark + (if reading-surface)
      sepia values, each with a WCAG contrast comment.
- [ ] Focus behaviour tested with keyboard (Tab, Shift-Tab, Space/Enter, Escape).
- [ ] Relevant loading, empty, and error states were checked when the UI change
  touches those states.
- [ ] `npm run typecheck` passes.
- [ ] No new lint errors in changed files.
- [ ] `npx eslint src/app src/components --rule 'readwise/ui-design-system:error'`
  passes for broad design-system changes.
- [ ] If a new interactive primitive: `aria-label` documented, `focusRing`
      applied, focus-trap wired for floating layers.

---

## 6. Visual Regression Plan

### 6.1 Strategy

ReadWise targets a **lightweight, stable-page screenshot approach** using the
existing Playwright E2E infrastructure.  The goal is to catch unintended
visual regressions in token changes and primitive refactors — not to lock down
every pixel of every page.

No Storybook is required.  Coverage starts small and expands only as the
baseline stabilises.

### 6.2 Tooling

| Tool | Role |
|------|------|
| [Playwright](https://playwright.dev) (`@playwright/test`) | Already in use for `e2e/`; `toHaveScreenshot` built-in |
| `--update-snapshots` flag | Baseline regeneration |
| GitHub Actions artifact upload | Stores baseline PNGs and diffs in CI |

### 6.3 Candidate surfaces (priority order)

The following surfaces are the highest-value targets because they compose the
most primitives and are stable enough to maintain a baseline.

| Priority | Surface | Route | Key tokens / primitives exercised |
|----------|---------|-------|----------------------------------|
| P0 | Sign-in page | `/signin` | Button (primary), Input, Field, Card, `--primary`, `--surface`, `--border` |
| P0 | Dashboard (logged-in) | `/dashboard` | Card (interactive), Badge, Skeleton, Avatar, `--bg`, `--text`, `--shadow-*` |
| P0 | Reader article view | `/reader/:id` | `data-reading-mode` (light/sepia/dark), `--reading-*`, `--hl-*`, SegmentedControl, Tooltip |
| P1 | Admin dashboard | `/admin` | Table, Badge, Button (secondary, danger), Spinner, `--surface`, `--border-strong` |
| P1 | Teacher workspace | `/teacher` | Card, Badge, SegmentedControl, PanelEmpty, PanelLoading |
| P1 | Settings / preferences | `/settings` | Switch, Field, Input, Select, Sheet |
| P2 | Study flashcard view | `/study` | Button (primary/ghost), Badge (CEFR), `--cefr-*`, Skeleton |
| P2 | Notes / highlights page | `/notes` | `--hl-dot-*`, Badge, Card, Avatar |

### 6.4 Spec file location

```
e2e/visual-regression.spec.ts
```

This file does not yet exist.  Create it following the pattern of
`e2e/accessibility.spec.ts`.

### 6.5 Test anatomy

```ts
// e2e/visual-regression.spec.ts (proposed structure)
import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

for (const vp of VIEWPORTS) {
  test.describe(`Visual — ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("sign-in page", async ({ page }) => {
      await page.goto("/signin");
      await expect(page).toHaveScreenshot(`signin-${vp.name}.png`, {
        maxDiffPixelRatio: 0.01,
      });
    });

    test("dashboard", async ({ page }) => {
      // authenticate via storageState fixture
      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");
      await expect(page).toHaveScreenshot(`dashboard-${vp.name}.png`, {
        maxDiffPixelRatio: 0.01,
      });
    });

    // Reader: three reading modes
    for (const mode of ["light", "sepia", "dark"] as const) {
      test(`reader — reading-mode ${mode}`, async ({ page }) => {
        await page.goto("/reader/sample");
        await page.evaluate(
          (m) => document.querySelector("[data-reading-mode]")?.setAttribute("data-reading-mode", m),
          mode,
        );
        await expect(page.locator(".reader-column")).toHaveScreenshot(
          `reader-${mode}-${vp.name}.png`,
          { maxDiffPixelRatio: 0.01 },
        );
      });
    }
  });
}
```

### 6.6 Baseline management

| Action | Command |
|--------|---------|
| Generate / regenerate baseline | `npx playwright test e2e/visual-regression.spec.ts --update-snapshots` |
| Run against existing baseline | `npx playwright test e2e/visual-regression.spec.ts` |
| Inspect diffs | `npx playwright show-report` (HTML report with side-by-side diff) |

Baseline PNG files are committed to the repository under
`e2e/visual-regression.spec.ts-snapshots/`.  They are updated intentionally
via a PR that includes the diff image as a PR comment or artifact.

#### Updating the baseline

1. Make the intentional visual change (token update, primitive refactor).
2. Run `--update-snapshots` locally.
3. Commit the new baseline PNGs alongside the code change.
4. Add a "Visual diff" section to the PR description with before/after
   screenshots (attach from Playwright HTML report).
5. A second reviewer must approve the visual delta before merge.

### 6.7 CI integration

Add a `visual-regression` job to the existing Playwright CI workflow:

```yaml
# .github/workflows/e2e.yml (addition — do not add until baseline is stable)
- name: Run visual regression
  run: npx playwright test e2e/visual-regression.spec.ts
- name: Upload diff report on failure
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: playwright-visual-report
    path: playwright-report/
```

> **Phased rollout:** Enable this job in CI only after the initial baseline has
> been reviewed and merged.  Run it as a non-blocking check (`continue-on-error:
> true`) for the first two weeks to gather noise data before enforcing.

### 6.8 Scope limits

| Out of scope (at baseline) | Reason |
|---------------------------|--------|
| Full-page screenshots of every route | Too noisy; increases maintenance burden |
| Component-level isolation (Storybook) | Not required by #728 |
| Animation / motion regression | Playwright `toHaveScreenshot` is static; use `prefers-reduced-motion` fixture |
| IE / Safari cross-browser pixel-perfect matching | `maxDiffPixelRatio` tolerates sub-pixel AA differences |

### 6.9 Dark-mode regression

The global dark theme is tested by setting `data-theme="dark"` on `<html>` via
Playwright's `page.evaluate` or a dedicated `storageState` fixture:

```ts
test("dashboard — dark theme", async ({ page }) => {
  await page.goto("/dashboard");
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dark"),
  );
  await expect(page).toHaveScreenshot("dashboard-dark-desktop.png", {
    maxDiffPixelRatio: 0.01,
  });
});
```

This catches regressions in `--bg`, `--surface`, `--text`, shadow, and border
tokens in dark mode without requiring a separate browser profile.

### 6.10 Review process

1. **Author** runs `--update-snapshots`, commits PNGs, attaches diff images to PR.
2. **Reviewer** confirms the visual delta matches the stated code change (no
   unintended colour drift or layout shift).
3. On approval, the baseline PNGs are merged and become the new canonical
   baseline for CI.
4. Regressions in CI (unexpected diff) are treated as **blocking** — the PR
   author must either fix the regression or follow the baseline-update process.

---

## 7. Relationship to Accessibility Baseline (#726)

The visual regression plan is complementary to the axe-core accessibility
checks documented in [accessibility.md](./accessibility.md).  Both use
Playwright; they are separate spec files and separate CI jobs.

- Accessibility checks catch WCAG violations (contrast ratios, ARIA labels,
  focus order) that are invisible to screenshot diffing.
- Visual regression catches unintended colour drift, layout shifts, and spacing
  regressions that axe cannot detect.

Running both suites on every PR that touches `tokens.css`, `src/components/ui/`,
or `src/app/*.css` is the recommended policy once the visual baseline is
established.

---

## 8. Quick reference

### Do

- Always import primitives from `@/components/ui`.
- Always use `var(--token)` for colours, spacing, radii, and shadows.
- Keep durable UI rules here; delete completed refactoring/runbook documents.
- Always provide both light **and** dark token values when adding to
  `tokens.css`.
- Always apply `focusRing` to new interactive primitives.
- Always add `aria-label` to icon-only buttons.
- Use `--teal` for reading-state indicators; use `--primary` for interactive
  affordances.

### Don't

- Hard-code hex values or Tailwind colour utilities in feature components.
- Use `--reading-*` tokens outside the reader column.
- Use `--teal` for interactive affordances (buttons, links).
- Recreate old compatibility import paths for shared UI primitives.
- Skip the WCAG contrast comment when adding colour tokens.
- Merge a visual baseline update without a second reviewer approving the diff.
