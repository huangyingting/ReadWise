# Squad Decisions

## Active Decisions

### 2026-07-01 — Coverage strategy ownership and verification

**Source:** Morpheus inbox (`decisions/inbox/morpheus-coverage-strategy.md`)

Treat the 98% coverage request as a coordinated, staged coverage program rather than a blind loop over files. Establish an explicit denominator and baseline first, split ownership by domain, and prevent shared-file churn.

**Evidence from repo inspection (2026-07-01):**
- `package.json` has `npm test` on Node's built-in runner with `--experimental-strip-types` and module mocks; no coverage script or third-party coverage runner is configured.
- Source inventory is large: about 876 `src/**/*.{ts,tsx}` files (583 TS, 293 TSX), plus 22 scripts; there are 281 Node tests and 10 Playwright specs.
- Next/API/backend surface is broad: 104 `src/app/api/**/route.ts`; rough static scan found 81 route module imports in tests and about 23 route files not directly imported.
- UI surface is the biggest tooling risk: about 293 TSX files, about 166 rough `"use client"` modules, 37 pages, and 3 layouts.
- Probe: native Node coverage with `--test-coverage-include='src/lib/result.ts' --test-coverage-include='src/lib/backoff.ts' --test tests/result.test.ts` reported only imported `result.ts`; unimported code did not enter the denominator.
- Probe: importing `src/components/ui/Button.tsx` under the current Node strip-types hook failed with `ERR_UNKNOWN_FILE_EXTENSION`, confirming TSX/runtime UI files are not directly covered by the current Node test command.

**Decision / strategy:**
1. Define the coverage denominator before implementation: include handwritten `src/**/*.{ts,tsx}` and selected `scripts/**/*.ts`; exclude generated artifacts, `.next`, Prisma generated client, test/e2e files, declarations, and config-only files only by written policy.
2. Add a coverage inventory gate separate from Node's native percentage gate. Native coverage can validate imported files, but a repo manifest must fail files that are never imported/covered; otherwise 98% can be falsely satisfied.
3. Prioritize high-risk pure logic and server seams first. Do not inflate coverage with import-only tests unless the file is intentionally a barrel/config contract.
4. For TSX/UI files, prefer extracting behavior into small TS helpers/hooks that Node tests can exercise, while using Playwright for interaction/page smoke. If strict per-file TSX coverage remains mandatory, adopt an explicit TSX-capable coverage runner/harness as a separate tooling decision; native node:test alone is insufficient.
5. Avoid shared-file conflicts by freezing shared helpers/tooling ownership: Switch owns coverage harness/manifest and final validation; implementers add domain tests without editing the harness unless coordinated.

**Ownership:**
- Switch: coverage denominator, baseline report, inventory/fail-fast mechanics, final validation loop, and review of import-only tests.
- Tank: backend/API route/service coverage, auth/RBAC, runtime config, Prisma SQLite/PostgreSQL parity, provider fallback tests.
- Mouse: scraper/import/content pipeline, AI enrichment, vocabulary/study-data transforms, privacy-safe fixtures and degraded-provider tests.
- Trinity: UI/client behavior, page/component seams, accessibility/focus/loading/empty/error states, TSX tooling recommendation or pure-helper extraction plan.

**Validation recommendation:**
Start with `npm test` plus a project-local coverage run; for DB-sensitive work add `npm run test:db` with PostgreSQL; for UI behavior keep Playwright smoke separate. Run `npm run typecheck` when shared types/routes/contracts move. Do not rely on Playwright for source line coverage unless source-map collection is intentionally designed.

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction