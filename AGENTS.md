# ReadWise — Agent Notes

AI-assisted English learning reader. Full feature replication of "ReadingX".

## Stack
- Next.js 15 (App Router, TypeScript), React 19
- Prisma ORM + SQLite (`DATABASE_URL=file:./dev.db`)
- NextAuth v4 with `@auth/prisma-adapter` (database session strategy)
- Azure OpenAI / Azure Speech for AI tools (see `.env.local`)

## Commands
- `npm run dev` — dev server (port 3000). Load env first: `set -a && . ./.env.local && set +a`
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — `next lint`
- `npm run build` — production build (also runs type/lint checks)
- `npx prisma migrate dev --name <n>` — create + apply a migration (run with env loaded)

## Conventions & Gotchas
- Path alias `@/*` → `./src/*`.
- DB access: import the singleton `prisma` from `@/lib/prisma` (never `new PrismaClient()`).
- Auth config lives in `src/lib/auth.ts` (`authOptions`). Providers are added
  conditionally based on env vars so missing OAuth creds don't crash (graceful fallback).
- Session strategy is **database** (not JWT). Role + id are attached in the
  `session` callback from the `user` arg. `Session.user` type is augmented in
  `src/types/next-auth.d.ts` to include `id` and `role`.
- Protected routes: listed in `middleware.ts` (`PROTECTED_PREFIXES` + `config.matcher`).
  Middleware only checks session-cookie presence and redirects to
  `/signin?callbackUrl=<path>`. Real enforcement is server-side via
  `requireSession(callbackUrl)` from `@/lib/session`. When adding a new protected
  area, update BOTH the middleware matcher and call `requireSession` in the page.
- Server components in Next 15: `searchParams`/`params` are Promises — `await` them.
- `User.role` defaults to `Reader` (enum `Role { Admin, Reader }`). First-user-Admin
  logic is US-002 (not yet implemented).
- Migrations are committed under `prisma/migrations/`. `dev.db` is gitignored.

## Browser verification
- Playwright is installed. Run scripts from the project root (so `@playwright/test`
  resolves). Chromium at `/home/agent/.cache/ms-playwright/chromium-1208/chrome-linux/chrome`,
  launch with `--no-sandbox`.
