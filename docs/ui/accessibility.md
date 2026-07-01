---
type: "testing"
status: "current"
last_updated: "2026-07-01"
description: "Documents UI accessibility baseline, automated checks, manual verification gaps, and component responsibilities. Captures current axe/Playwright checks, keyboard/focus expectations, semantic patterns, and outstanding manual checks."
---

# Accessibility baseline

This document describes the accessibility baseline for ReadWise, what is
checked automatically, how checks are run and extended, and which gaps remain
as manual verification follow-ups.

## Why this matters

ReadWise is a reading and learning product.  Keyboard navigation, focus
management, screen-reader labelling, colour contrast, reduced-motion support,
and touch-target size directly affect learner success.  This document captures
the current baseline as a durable contract so regressions are caught early.

---

## Automated checks

### Tool

Automated checks use [`@axe-core/playwright`](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright)
(Deque axe-core integrated with Playwright).  Axe is a rule-based accessibility
engine that runs in-browser and reports WCAG violations.

### Spec file

`e2e/accessibility.spec.ts`

Run with the E2E suite:

```sh
npm run test:e2e:smoke
```

### Surfaces covered

| Surface | Route | Role |
|---------|-------|------|
| Sign-in / landing | `/signin` | Unauthenticated |
| Dashboard | `/dashboard` | Reader |
| Reader (article view) | `/reader/:id` | Reader |
| Admin dashboard | `/admin` | Admin |
| Teacher workspace | `/teacher` | Reader |

Each surface is scanned with the **WCAG 2.1 AA** tag set
(`wcag2a`, `wcag2aa`, `wcag21aa`).

### Severity policy

Only **serious** and **critical** impact violations fail CI.  Lower-severity
violations (`moderate`, `minor`) are surfaced in the axe report and reviewed
manually but do not block builds at the baseline.

This threshold will be tightened over time as known lower-severity issues are
resolved.

### Keyboard-focus smoke check

In addition to the full axe scan, the reader surface includes a targeted
keyboard-focus test: the **Display settings** toolbar button must be
programmatically focusable, confirming that focus management in the reader
toolbar is intact.

### Known-issue allowlist

Violations that are accepted as baseline gaps are listed in the
`ALLOWLISTED_RULES` constant at the top of `e2e/accessibility.spec.ts`.  Each
entry must include:

- The axe rule ID (e.g. `color-contrast`)
- A comment explaining why it is allowed
- A link to the follow-up issue

The allowlist is **empty at the initial baseline**.  Add entries sparingly and
always file a remediation issue.

---

## What is checked automatically

| Category | Mechanism |
|----------|-----------|
| ARIA landmarks present | axe `region`, `landmark-*` rules |
| Buttons / links have accessible names | axe `button-name`, `link-name` |
| Images have alt text | axe `image-alt` |
| Form fields have labels | axe `label` |
| Heading order is logical | axe `heading-order` |
| Colour contrast (WCAG AA) | axe `color-contrast` |
| Interactive elements keyboard-accessible | axe `keyboard` |
| Focus order matches visual order | axe `focus-order-semantics` |
| Reader toolbar button focusable | `element.focus()` + `expect(element).toBeFocused()` |

---

## High-risk surfaces (manual verification required)

The following surfaces contain complex interaction patterns that axe alone
cannot fully verify.  Manual testing is required on each release.

| Surface | Risk area | Manual check |
|---------|-----------|--------------|
| Reader toolbar | Focus ring visible on all buttons; correct `aria-label` | Tab through toolbar; verify ring + VoiceOver/NVDA reads labels |
| Word lookup popover | Focus trapped inside popover when open | Open lookup; Tab must not leave the popover |
| Highlights / notes panel | Focus moves to panel on open; returns on close | Open panel; close; confirm focus returns to trigger |
| Audio mini-player | Play/pause/skip controls keyboard-operable | Tab to each control; press Space/Enter |
| Flashcards / cloze | Card flip / reveal keyboard-operable; screen-reader announces state | Tab to card; press Space; verify ARIA state change |
| Command palette | Focus trapped; Escape closes and returns focus | Open palette; Tab; Escape; confirm focus return |
| Admin tables | Column sort controls labelled; pagination keyboard-accessible | Tab through table headers; verify sort buttons announced |
| Admin / teacher forms | Error messages associated with fields via `aria-describedby` | Submit invalid form; verify error read by screen reader |
| Offline sync indicator | State change announced to screen readers | Toggle offline; verify `aria-live` region announces change |

---

## Focus management contracts

ReadWise uses two focus utilities in `src/lib/`:

| Utility | Path | Purpose |
|---------|------|---------|
| `useFocusTrap` | `src/lib/focus-trap.ts` | Traps keyboard focus inside modals, popovers, and command palette |
| `useRovingTabindex` | `src/lib/use-roving-tabindex.ts` | Implements roving `tabindex` for toolbar / tab-list navigation |

Any component that opens a floating layer (dialog, popover, sheet, command
palette) **must** use `useFocusTrap` or a library that provides equivalent
containment.  PRs that remove or bypass this contract require a focused
accessibility review.

---

## Keyboard navigation expectations

- All interactive elements are reachable by Tab / Shift-Tab.
- Toolbars and tab lists use roving `tabindex` (Arrow keys move focus; Tab
  leaves the group).
- Dialogs and popovers trap focus while open; Escape closes them and returns
  focus to the trigger element.
- The command palette (`/`) opens on keyboard shortcut; Escape closes it.
- Skip-to-content link is the first focusable element on every page.

---

## Colour contrast

ReadWise targets WCAG 2.1 AA:

- Normal text: ≥ 4.5:1
- Large text (≥ 18 pt or 14 pt bold): ≥ 3:1
- UI component boundaries (input borders, focus rings): ≥ 3:1

Contrast is partially verified by axe `color-contrast`.  Manual spot-checks
with a contrast analyser are required for custom colours, gradients, and
component states (hover, disabled, error).

---

## Reduced-motion support

Components that use CSS animations or transitions must respect the
`prefers-reduced-motion: reduce` media query.  Check the reader page, the
flashcard flip, and the audio mini-player under reduced-motion settings.

---

## How to extend automated checks

1. **Add a new surface scan** — follow the pattern of an existing `test.describe`
   block in `e2e/accessibility.spec.ts`.  Use `new AxeBuilder({ page }).withTags([...]).analyze()`.
2. **Tighten the severity threshold** — change `BLOCKING_IMPACTS` to include
   `"moderate"` once serious/critical issues are resolved.
3. **Add a targeted keyboard test** — use Playwright's `element.focus()` and
   `expect(element).toBeFocused()` for fine-grained focus assertions.
4. **Add to the allowlist sparingly** — only when a violation is confirmed by
   manual review and a remediation issue is filed.  Include the issue URL.

---

## Current automated-coverage gaps

The following areas are not yet covered by automated accessibility checks:

- Word lookup popover focus-trap assertion.
- Flashcard keyboard-operability and ARIA state announcement.
- Command palette focus-trap and Escape-return assertion.
- Admin table column sort ARIA label verification.
- Offline sync indicator `aria-live` region check.
- Reduced-motion smoke test for reader and flashcard animations.
- Colour contrast manual audit for custom colour tokens.
