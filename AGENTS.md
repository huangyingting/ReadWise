# ReadWise — Agent Guide

Code is the single source of truth. Before changing behavior, inspect the
relevant source, schema, tests, and scripts directly. Keep this file short: only
record durable rules that are easy to miss and costly to violate.

## Hard rules

- Use `@/*` imports for project code.
- Use the Prisma singleton from `@/lib/prisma`; never instantiate another
  `PrismaClient` in app code.
- Build API routes with the shared handler wrappers in `src/lib/api-handler.ts`
  unless a framework integration owns the route.
- Validate all params, query strings, and bodies before use.
- Enforce authorization server-side. Middleware and hidden UI are not security
  boundaries.
- In Next.js 15 server components, `params` and `searchParams` are promises;
  await them.
- Never render stored or scraped article HTML unless it has gone through
  `sanitizeArticleHtml`.
- Never log or persist secrets, tokens, cookies, prompts, article text, selected
  text, credentials, or user-private content in observability/audit/analytics
  metadata.
- Optional providers must degrade gracefully. Missing AI, Speech, Push, OAuth or
  storage config is normal in local and test environments.
- Use `createLogger(scope)` for server logs; avoid raw `console.*` outside CLI
  presentation code.
- Keep generated media behind the storage abstraction; database base64 is only a
  fallback.
- Do not run a production build while the dev server is running; both write to
  `.next/`.

## When editing

1. Read the relevant implementation first.
2. Make the smallest behavior-preserving change that solves the task.
3. Update tests when behavior changes.
4. Update user/operator documentation when scripts, env vars, schema, runtime
   behavior, or operational workflows change.
5. Validate with the narrowest useful check, then broaden if the change warrants
   it.
6. Review the diff for accidental rewrites or unrelated formatting.

## Schema changes

- Keep SQLite and PostgreSQL schema intent aligned when a model change affects
  production parity.
- Commit migrations with schema changes.
- Think through cascades, private/org visibility, audit retention, analytics
  retention, and seed/test data.

## Auth and tenancy

- Prefer capability and tenant guards over raw role checks.
- A global admin and an organization/classroom role are different concepts.
- Student/user identifiers for protected mutations must come from the session,
  not from request bodies.

## AI and content pipeline

- Preserve cache-first, idempotent processing behavior.
- Do not cache failed or placeholder AI output unless the implementation
  explicitly says that is intended.
- Keep scraper/provider behavior source-governed and idempotent.
- Record or preserve audit/security/processing state for privileged or
  operator-visible mutations.

## Tests

- Prefer focused tests with mocked database, network, AI, and storage seams.
- Route tests should call handlers with `Request` and promised `params` where
  needed.
- Keep noisy route tests at `LOG_LEVEL=error`.

## Do not add here

- Feature inventories.
- API catalogs.
- Environment variable tables.
- Command lists copied from package scripts.
- Explanations that can be recovered from source code.
