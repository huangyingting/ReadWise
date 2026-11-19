---
type: "index"
status: "current"
last_updated: "2026-11-19"
description: "Design-system governance, accessibility baseline, and mobile reader and PWA behavior."
---

# UI

Tokens, shared primitives, density variants, accessibility, and mobile and PWA conventions. All UI work follows [`design-system-governance.md`](./design-system-governance.md).

Add a document here when the change affects shared UI primitives, tokens, accessibility rules, or mobile/PWA behavior.

## Code ownership

- `src/components/ui/`, `src/app/tokens.css`, `src/lib/cn.ts`
- `eslint-rules/ui-design-system.js`
- `src/lib/pwa/`, `public/sw.js`

## Documents

<!-- BEGIN GENERATED: docs-index (npm run docs:index) -->

| Document | Type | Status | Description |
| --- | --- | --- | --- |
| [Accessibility baseline](./accessibility.md) | testing | current | Documents UI accessibility baseline, automated checks, manual verification gaps, and component responsibilities. Captures current axe/Playwright checks, keyboard/focus expectations, semantic patterns, and outstanding manual checks. |
| [Design-System Governance & Visual Regression Plan](./design-system-governance.md) | policy | current | Design-system governance: token and primitive ownership, typography roles, borderless surfaces, layout patterns, density variants, import rules, ESLint drift checks, focus states, and visual regression boundaries. |
| [Mobile Reader and PWA experience baseline](./mobile-reader-pwa.md) | design | current | Documents the mobile Reader/PWA baseline across shell and Reader safe areas, floating text actions, service-worker caching, the offline library, and touch interactions. Captures current layout, viewport reflow, offline/install behavior, known gaps, and test coverage. |

<!-- END GENERATED: docs-index -->
