# ReadWise — QA + Accessibility Review (Basher)

Live review of `http://localhost:3000` (Admin, onboarded, seeded). Browser-driven
(Playwright/dev-browser) across mobile (390px), tablet (1000px) and desktop (1440px).
Focus: redesign PRs #155–#163 (Sheet/Popover/SegmentedControl, sidebar, chrome header,
bottom tab bar + More sheet, reader slim toolbar + Aa panel + responsive Tools surface).
**Review only — no code changed.**

Legend: S0 blocker · S1 major · S2 minor · S3 nit.

---

## F1 — Modal Sheet focus trap LEAKS with roving-tabindex content (Aa panel, Tools sheet)
**Severity: S1** · Surface: `Sheet` primitive + reader Aa/Tools sheets · Breakpoint: mobile <640px (Aa) and <1280px (Tools)

**What's wrong.** The focus trap in both sheet implementations does not contain Tab when the
panel holds a roving-tabindex widget (any `SegmentedControl`, or the study tabs in `ReaderTools`).
Verified: opening **Aa** on mobile and tabbing through the Display panel, focus escaped after the
last tabbable radio straight into the page behind the sheet:

```
Aa TAB trail: IN:Increase → IN:Light → IN:Serif → IN:Normal → OUT:Practice tools →
              OUT:Save to reading list → OUT:Add to list → OUT:Download for offline …
```

Same leak on the **tablet Tools bottom sheet** (1000px) — focus left the dialog after one Tab and
walked the skip-link, header and sidebar links behind the scrim.

**Root cause (confirmed).** `FOCUSABLE_SELECTOR` includes `button:not([disabled])`, which matches
the *inactive* roving radios even though they carry `tabindex="-1"`. Dumped the list the trap sees
inside the open Aa sheet:

```
[Decrease, Increase, Light(-1), Sepia(0), Dark(-1), Serif(0), Sans(-1), Dyslexic(-1),
 Normal(0), Comfortable(-1), Spacious(-1)]   → lastEl = "Spacious" (tabindex=-1, UNREACHABLE)
```

So `lastEl` is a non-tabbable element. When focus is on the genuinely-last tabbable radio
("Normal"), `active !== lastEl`, the wrap never fires, and native Tab leaves the dialog. This is a
WCAG 2.4.3 (Focus Order) / modal-containment failure for keyboard + screen-reader users; the modal
is defeated.

**Proposed fix.** In both trap implementations, filter the focusable list to *effectively tabbable*
elements before computing first/last, e.g. `Array.from(panel.querySelectorAll(SEL)).filter(el =>
el.tabIndex >= 0 && el.offsetParent !== null)` (`el.tabIndex` returns `-1` for roving-inactive
items). Apply identically in:
- `src/components/ui/Sheet.tsx` (lines ~64–84, the Tab branch)
- `src/components/ReaderToolsSurface.tsx` (lines ~66–83, the Tab branch)

(Optionally hoist a shared `getTabbable(panel)` helper so both stay in sync.)

---

## F2 — Reader Tools bottom sheet advertises `aria-modal="false"` while modal
**Severity: S1** · Surface: `ReaderToolsSurface` · Breakpoint: <1280px (sheet mode)

**What's wrong.** `ReaderToolsSurface` renders one element for both layouts and hard-codes
`aria-modal="false"`. Below xl it becomes a `position:fixed` **modal** bottom sheet with a scrim +
focus trap, but it still reports `aria-modal="false"` (verified: `data-open="true"`,
`position:fixed`, `aria-modal:"false"` at 1000px). Screen readers are told the dialog is non-modal,
so they keep exposing the obscured background — compounding F1.

**Proposed fix.** Drive `aria-modal` from the active layout: track the sheet/rail breakpoint (the
component already calls `matchMedia(SHEET_MAX_WIDTH)` in the effect — lift it into state) and set
`aria-modal={isSheet ? "true" : "false"}` on the `<aside>` in
`src/components/ReaderToolsSurface.tsx` (line ~111). Keep `aria-hidden` logic as-is.

---

## F3 — Reader slim toolbar touch targets below 44px on mobile
**Severity: S2** · Surface: `ReaderControls` / `.reader-tool-btn` · Breakpoint: mobile

**What's wrong.** Measured the sticky reading toolbar at 390px:

| Control | size |
|---|---|
| Back | 117 × **30** |
| Listen | **30** × **32** |
| Aa (Display) | **34** × **32** |
| Tools | **32** × **32** |

All are ~30–32px tall — below the 44×44 comfortable target (WCAG 2.5.5 AAA / mobile best practice;
they clear the 24px AA floor only). The redesign got the bottom tab bar right (78×55) but the reader
toolbar regressed. The icon-only Listen/Aa/Tools are the hardest to hit.

**Proposed fix.** Bump `.reader-tool-btn` to `height: 2.75rem; min-width: 2.75rem;` (or add an
invisible hit-area) and raise the Back button / `.reader-controls-actions` row height to 44px on
small screens in `src/app/globals.css` (`.reader-tool-btn` ~line 1527, `.reader-back-btn` ~line
1493). Keep the compact 32px visual on `sm+` via a media query if desktop density matters.

---

## F4 — Keyboard Shortcuts dialog has no accessible name
**Severity: S2** · Surface: `KeyboardShortcutsModal` · Breakpoint: all

**What's wrong.** Opening "Keyboard shortcuts" from the More sheet yields a second
`role="dialog" aria-modal="true"` whose accessible name is **null** (verified: `{label:null,
modal:"true"}`). A dialog with no name violates WCAG 4.1.2 — screen readers announce just "dialog".

**Proposed fix.** Add `aria-labelledby` pointing at the modal's heading (or `aria-label="Keyboard
shortcuts"`) on the dialog container in `src/components/KeyboardShortcutsModal.tsx`. Ensure the
visible title has the referenced `id`.

---

## F5 — Esc on stacked modals closes the wrong (background) sheet
**Severity: S3** · Surface: `MoreSheet` + `KeyboardShortcutsModal` · Breakpoint: mobile

**What's wrong.** More sheet → open Keyboard shortcuts (now two stacked modals) → press Esc once:
the **background More sheet closes** while the foreground shortcuts modal stays open (verified:
remaining visible dialog after Esc = the unlabeled shortcuts modal). Both attach document-level
`keydown` listeners, so Esc resolves the lower sheet instead of the topmost dialog. Minor (edge
path), but surprising.

**Proposed fix.** Give the topmost overlay precedence: either have `KeyboardShortcutsModal`
`stopPropagation()` on its Esc handler, or have the More `Sheet` ignore Esc while a child modal is
open (e.g. pass `shortcutsOpen` to suppress close). Files: `src/components/MoreSheet.tsx`,
`src/components/KeyboardShortcutsModal.tsx`.

---

## F6 — Popover does not restore focus to its anchor on outside-click
**Severity: S3** · Surface: `Popover` (reader Aa on desktop) · Breakpoint: ≥640px

**What's wrong.** `Popover` returns focus to the anchor on **Esc** (good) but on outside
**pointer-down** it just closes; focus lands wherever the user clicked (verified: after an
outside click, `activeElement` = the `<article>`). For a click this is largely acceptable, but a
keyboard user who triggers a programmatic close has no focus anchor. Low impact.

**Proposed fix (optional).** In `src/components/ui/Popover.tsx` `onPointerDown` (lines ~51–60),
when the close is not the result of focusing another interactive control, call
`anchorRef.current?.focus()` after `onClose()` — or document the intentional behavior.

---

## F7 — Two navigation landmarks share the accessible name "Primary"
**Severity: S3** · Surface: `AppSidebar` + `BottomTabBar` · Breakpoint: all (DOM), one visible per breakpoint

**What's wrong.** Both the desktop sidebar `<nav aria-label="Primary">` and the mobile
`BottomTabBar` `<nav aria-label="Primary">` exist in the DOM at once. In practice only one is
rendered per breakpoint (the other's ancestor is `display:none`, so it's out of the a11y tree —
verified: only one visible "Primary" landmark at 390px and at 1440px), so this is not a live
defect. But the identical names are fragile if the hiding CSS ever regresses.

**Proposed fix (nit).** Differentiate the names, e.g. sidebar `aria-label="Primary"` and bottom bar
`aria-label="Primary (mobile)"`, or render only the active one. Files:
`src/components/shell/AppSidebar.tsx` (line ~131), `src/components/shell/BottomTabBar.tsx` (line ~53).

---

## Regression checks — redesign acceptance criteria that HOLD ✅
- **Sidebar (#158/#157):** collapse toggle labeled + `aria-expanded` correct; `aria-current="page"`
  on the active item (Dashboard on /dashboard); no nav item lit on /reader (correct).
- **Chrome header (#159):** wordmark + search + theme + user only, no primary nav; theme toggle is
  icon-only **with** `aria-label` ("Switch to light mode"); search/user controls labeled.
- **Bottom tab bar (#160):** 4 tabs + More; `aria-current` on active; 78×55 touch targets;
  correctly returns `null` (hidden) inside `/reader/*`; `aria-haspopup="dialog"` + `aria-expanded`
  on More.
- **More sheet (#160):** focus moves in, **Tab is trapped**, Esc + scrim both close, focus
  **returns** to the More button. (Plain links/buttons — unaffected by F1.)
- **Aa Popover desktop (#161):** opens anchored, SegmentedControl roving works (ArrowRight
  Light→Sepia moves selection + focus), live region announces "Reading theme: Sepia", Esc closes +
  returns focus to Aa.
- **Responsive Tools surface (#162):** at xl it's a docked rail (x=1056) that does **not** overlap
  the Aa popover (ends x=1032) — the "both open on desktop" overlap risk is handled.
- **Contrast:** muted text / category badges / nav labels sampled at 6.9–7.6:1 (well above AA 4.5:1).
- **Skip link** ("Skip to main content") present.

---

## Top 5 (high-signal)
1. **F1 (S1)** Sheet focus trap leaks to the page whenever the panel uses roving tabindex — breaks
   the Aa display sheet (mobile) and the Tools bottom sheet (<xl). Root cause: focusable selector
   counts `tabindex="-1"` roving radios, so `lastEl` is unreachable and the Tab wrap never fires.
2. **F2 (S1)** Reader Tools bottom sheet is modal but hard-codes `aria-modal="false"`, so AT keeps
   exposing the obscured background (compounds F1).
3. **F3 (S2)** Reader slim toolbar buttons are 30–32px tall on mobile (Back/Listen/Aa/Tools) — below
   the 44px comfortable touch target the bottom bar already meets.
4. **F4 (S2)** The Keyboard Shortcuts modal has no accessible name (`aria-label`/`aria-labelledby`
   missing) — WCAG 4.1.2.
5. **F5 (S3)** Esc with stacked modals (Shortcuts opened from More) closes the background More sheet
   instead of the topmost dialog.
