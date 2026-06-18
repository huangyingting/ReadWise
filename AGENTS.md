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
- `User.role` defaults to `Reader` (enum `Role { Admin, Reader }`). The first user to
  sign in becomes `Admin` via the `events.createUser` hook in `src/lib/auth.ts`
  (counts users after creation; if it's the only one, promotes to Admin).
- Admin enforcement: pages call `requireAdmin(callbackUrl)` from `@/lib/session`
  (redirects non-admins to `/forbidden`); API routes call `requireAdminApi()` from
  `@/lib/api-auth` (returns 401 if unauthed, 403 if non-admin). Hide admin-only UI
  by checking `session.user.role === "Admin"`.
- Migrations are committed under `prisma/migrations/`. `dev.db` is gitignored.
- Shared news categories live in `src/lib/categories.ts` (`CATEGORIES`, `CATEGORY_SLUGS`,
  `isValidCategorySlug`). Reuse this set everywhere (onboarding topics, category browsing,
  picks) instead of redefining the list.
- User onboarding: 1-1 `Profile` model (ageRange?, gender?, englishLevel, topics JSON string,
  completedAt). SQLite has no scalar lists, so `topics` is a JSON-stringified `string[]`
  (parse via `parseTopics` in `src/lib/profile.ts`). `completedAt != null` means onboarded.
  Gate pages that need a finished profile with `requireOnboardedSession(callbackUrl)` from
  `@/lib/session` (redirects to `/onboarding`). The onboarding page itself uses plain
  `requireSession` and redirects completed users to `/dashboard`.
- Auth UI actions (`signIn`/`signOut` from `next-auth/react`) must run in a `"use client"`
  component. Reusable client auth controls live in `src/components/` (e.g. `SignOutButton.tsx`).
  With the DB session strategy, `signOut` deletes the `Session` row server-side (not just the
  cookie). Session lifetime is set via `session.maxAge`/`updateAge` in `authOptions`.

## Browser verification
- Playwright is installed. Run scripts from the project root (so `@playwright/test`
  resolves). Chromium at `/home/agent/.cache/ms-playwright/chromium-1208/chrome-linux/chrome`,
  launch with `--no-sandbox`.
