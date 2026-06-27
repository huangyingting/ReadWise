# AGENTS.md

Project rules for AI coding agents.

## Rules

- Source code, tests, Prisma schemas, and scripts are authoritative; docs are background and must describe current behavior only.
- Treat uncommitted changes as intentional; never revert or overwrite user work unless asked.
- Keep edits scoped; prefer existing local helpers, seams, and patterns over new abstractions.
- Read nearby implementation and tests before changing behavior.
- Do not add runtime compatibility layers for superseded payload shapes unless explicitly requested.
- Preserve graceful fallback for optional providers: AI, Speech, Push, OAuth, and storage.
- Never log or persist secrets, credentials, tokens, cookies, prompts, article text, selected text, definitions, translations, or user-private content in metadata.
- When schemas change, keep SQLite/PostgreSQL intent, migrations, fixtures, tests, and docs aligned; consider cascades, visibility, and retention.
- Do not run destructive git commands, commit, or create branches unless asked.
- If editing docs, keep them in flat `docs/<subsystem>/` directories and update `docs/README.md` when coverage changes.

## UI / Design System v1

- Follow `docs/ui/design-system-governance.md` and the coding-agent runbook in `docs/ui/design-system-v1-refactoring.md` for all UI work.
- Reuse the existing Studio design direction in `src/app/tokens.css`; do not introduce a parallel theme, palette, type scale, spacing scale, or brand direction.
- Product UI must use design tokens for typography, colour, spacing, radius, shadow, and focus states. Do not add raw hex/rgb/hsl colours, raw `font-size`, or inline `style={{ fontSize: ... }}` outside documented low-level exceptions.
- Reader article prose, imported article HTML, reading modes, highlights, and pronunciation decorations are the main visual exceptions; keep them on `--reading-*`, `--hl-*`, and `--pron-*` tokens.
- Interactive UI must be composed from `src/components/ui/*` primitives (`Button`, `IconButton`, `Field` + form controls, `Switch`, `Badge`, `Card`, `Popover`, `Sheet`, loading/empty/error primitives). Do not hand-roll business buttons, inputs, focus rings, spinners, empty states, or error states in feature code when a primitive exists.
- Add or extend shared primitives before duplicating recurring page structure. Page-level wrappers such as `PageShell`, `PageHeader`, `Section`, `Stack`, `Inline`, `Toolbar`, `TableSurface`, `FormActions`, and `EmptyState` belong in `src/components/ui/` when introduced.
- Use explicit density variants (`default`, `compact`, `reader`, `marketing`) instead of per-page one-off sizes. Admin/data-dense UI may be compact, but must still use the shared token and primitive system.
- UI unification may change visual details, but must not change business logic, routes, API calls, form fields, information architecture, Reader selection/highlight behavior, or keyboard/focus semantics unless explicitly requested.
- Marketing/landing surfaces are included in the design system and may use display/spacious variants, but still must be token-driven and use shared interactive primitives.
- For UI migrations, verify light/dark/mobile smoke, keyboard focus, and relevant loading/empty/error states in addition to lint/tests.

## Verification

Before handoff, verify only touched files or nearest behavior when reliable.

- Docs only: check diagnostics plus Markdown links/path references.
- Lint/format modified lintable files only.
- Typecheck with the smallest reliable scope; run full typecheck for shared types, routes, Prisma/generated types, or cross-module contracts.
- Run tests for modified test files or nearest focused tests; broaden only for shared behavior.
- Do not run a production build while the dev server is running.
