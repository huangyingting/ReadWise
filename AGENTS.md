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

## Verification

Before handoff, verify only touched files or nearest behavior when reliable.

- Docs only: check diagnostics plus Markdown links/path references.
- Lint/format modified lintable files only.
- Typecheck with the smallest reliable scope; run full typecheck for shared types, routes, Prisma/generated types, or cross-module contracts.
- Run tests for modified test files or nearest focused tests; broaden only for shared behavior.
- Do not run a production build while the dev server is running.