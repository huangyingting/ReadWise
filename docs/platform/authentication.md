# Authentication architecture

ReadWise uses NextAuth v4 with database sessions. Authentication is intentionally
small at the framework boundary and capability-based everywhere else.

## Code map

| Area | Code | Purpose |
| --- | --- | --- |
| NextAuth config | `src/lib/auth.ts` | Adapter, providers, database-session strategy, cookies, callbacks, first-user event. |
| Provider registry | `src/lib/auth-providers.ts` | Env-driven Google/Azure AD provider construction and sign-in metadata. |
| Bootstrap | `src/lib/auth-bootstrap.ts` | Promote the first user to global `Admin`. |
| Shared core | `src/lib/auth-core.ts` | Load session and check capabilities with no redirects/responses. |
| Page guards | `src/lib/session.ts` | Redirect missing sessions to `/signin` and unauthorized users to `/forbidden`. |
| API guards | `src/lib/api-auth.ts` | Return `401`/`403` responses for route handlers. |
| Auth route | `src/app/api/auth/[...nextauth]/route.ts` | NextAuth-owned route handler. |

## Provider configuration

`buildProviders()` constructs providers only when their required env vars are
complete:

| Provider | Required env |
| --- | --- |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Azure AD | `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, `AZURE_AD_TENANT_ID` |

Missing provider config is normal in local/test environments. The provider is
omitted rather than throwing. `getConfiguredProviders()` returns only provider id
and display name for server-rendered sign-in UI; it never exposes secrets.

## Session strategy and cookies

`authOptions` uses the Prisma adapter and database sessions:

- `session.strategy = "database"`,
- `maxAge = 30 days`,
- `updateAge = 24 hours`.

Session cookies are explicit:

- HttpOnly,
- `SameSite=Lax`,
- `Secure` and `__Secure-` prefixed in production,
- path `/`.

Cookie names come from `SESSION_COOKIES` in `src/lib/route-policy.ts` so
middleware and NextAuth agree.

## First-user bootstrap

The NextAuth `createUser` event calls `bootstrapFirstUser(user.id)`. If the new
user is the only user in the database, they are promoted to global `Admin`.
Subsequent users remain `Reader` unless an authorized admin changes their role.

Last-admin deletion/demotion protections are documented in
[`../access/account-lifecycle.md`](../access/account-lifecycle.md).

## Guard layering

Do not import framework-heavy auth helpers into client code. Use the narrowest
server-side guard for the surface:

| Surface | Helper | Failure behavior |
| --- | --- | --- |
| Pure/service code with loaded session | `sessionHasCapability(session, capability)` | Boolean deny-by-default. |
| Server components/pages | `requireSession`, `requireOnboardedSession`, `requireCapability` | Redirects to `/signin`, `/onboarding`, or `/forbidden`. |
| API routes | `requireSessionApi`, `requireCapabilityApi`, shared handler wrappers | Returns `401`/`403`. |
| Tenant/classroom routes | `src/lib/org/guards.ts`, `src/lib/classroom/guards.ts`, route helpers | Membership/capability-aware. |

Most API routes should use `createHandler`, `createAdminHandler`,
`createCapabilityHandler`, or `createPublicHandler` from
`src/lib/api-handler.ts` so validation, CSRF, logging, metrics, tracing, and
error aggregation remain centralized.

## Authorization is not authentication

Authentication establishes `session.user.id` and global `session.user.role`.
Authorization must still be enforced server-side through capabilities, article
access predicates, org/classroom guards, or owner checks. Middleware and hidden
UI are not security boundaries.

## Readiness and required env

Runtime config validation treats `NEXTAUTH_SECRET` and `NEXTAUTH_URL` as
required auth config. Optional OAuth providers report configured/degraded/
unconfigured independently in `/api/ready`; see
[`health-readiness.md`](./health-readiness.md).

## Tests

Relevant tests include `tests/auth-core.test.ts`, `tests/auth-providers.test.ts`,
`tests/auth-bootstrap.test.ts`, `tests/api-handler.test.ts`, `tests/rbac.test.ts`,
and admin/tenant route tests.
