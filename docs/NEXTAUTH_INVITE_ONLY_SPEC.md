# Unified Design Specification: NextAuth + Invite-Only Account Admission Module

**Status:** Canonical Reference Specification  
**Scope:** Cross-repository standard for all `/home/azadmin/*` Next.js + NextAuth + Prisma applications (`ReadWise`, `clueso`, `HelloInterview`, `Arcade`, `readwise.io`, `UniLink`, `Visdom`, `TextIQ`)

---

## 1. Cross-Repository Audit of `/home/azadmin`

We audited all **12 NextAuth repositories** under `/home/azadmin`, of which **8 implement invite-only or workspace invitation flows**:

| Repository | NextAuth Version & Strategy | Prisma Invite & Credential Models | OAuth + Invite Gate Integration | Identified Gaps / Strengths |
|---|---|---|---|---|
| **`ReadWise`** *(Primary Reference)* | `^4.24.15` (`database` session) | `User`, `Account`, `Session`, `PasswordCredential`, `PendingRegistration`, `AccountInvitation`, `AccountEmailOutbox` | `authorizeSocialSignIn` in `callbacks.signIn` blocks uninvited OAuth sign-ups; allows existing linked `Account` or active-session email linking | **Strength:** Strictest `activeForEmail @unique` + SHA-256 `tokenHash @unique` + `Serializable` transaction claim |
| **`HelloInterview`** | `^4.24.15` (`database` session) | `account_invitations`, `account_email_outbox`, `managed_accounts`, `managed_identities` | `admitSocialIdentity` in `callbacks.signIn` with `pg_advisory_xact_lock` | **Strength:** Auto-consumes a matching `PENDING` invitation when an invited user signs in directly via verified Google OAuth |
| **`clueso`** | `^4.24.11` (`jwt` session) | `User`, `Account`, `Session`, `PasswordCredential`, `AccountInvitation`, `AccountEmailOutbox`, `AuditLog` | Multi-tenant workspace (`organizationId` + `role`) + `authorizeSocialSignIn` in `callbacks.signIn` | **Strength:** Supports both single-tenant and multi-tenant (`organizationId`, `role`) invitation claims |
| **`Arcade`** | `^4.24.10` (`jwt` session) | `PasswordCredential`, `PendingRegistration`, `AccountInvitation`, `AccountEmailOutbox` | Cloned ReadWise `src/lib/account-admission/*`, `/invite/[token]`, `/api/admin/invitations/*` | **Gap:** `src/lib/auth.ts` `CredentialsProvider` was not wired to `PasswordCredential` / `authorizeSocialSignIn` |
| **`readwise.io`** | `^4.24.15` (`jwt` session) | `AccountInvitation` (`tokenHash`, `role`, `status`, `expiresAt`) | `/invite/[token]` + `/admin/invitations` + `/api/auth/register` gate | **Gap:** `CredentialsProvider` needed strict `PasswordCredential` verification without auto-provisioning |
| **`UniLink`** | `5.0.0-beta.32` (`database` session) | `ClosedTestInvitation`, `PlanShareInvitation`, `AuthorizationAudit` | Wraps `adapter.createUser` (`createAdmittedUser`) + `authorizeAccountSignIn` | **Gap:** Stored raw `token` instead of SHA-256 `tokenHash`; custom model name (`ClosedTestInvitation`) |
| **`Visdom`** | `^5.0.0-beta.32` (`jwt` session) | `InviteCode`, `InviteRedemption`, `PendingSignup` | Parks uninvited OAuth sign-ins in `PendingSignup` cookie and redirects to `/finish-signup`; checks Azure AD tenant pinning | **Strength:** `microsoftEmailTrusted()` tenant guard prevents multi-tenant Azure AD spoofing |
| **`TextIQ`** | `^5.0.0-beta.32` (`jwt` session) | `WorkspaceInvite` (`isRevoked`, `expiresAt`, `maxUses`, `useCount`) | `evaluateInviteAccess()` pure policy evaluator for `/app/join/[token]` | **Strength:** Clean pure-function policy evaluation (`revoked`, `expired`, `exhausted`, `invalid-role`) |

*(The remaining 4 NextAuth repositories—`EduLoop`, `Wallaby`, `Figure`, `MeetUp`—use NextAuth without invitation-gated admission, though `EduLoop` and `Wallaby` contribute the `sessionVersion` invalidation pattern incorporated below.)*

---

## 2. Design Goals & Non-Negotiable Security Invariants

1. **Fail-Closed Admission Mode (`ACCOUNT_ADMISSION_MODE`)**:
   - Defaults to `"invitation-only"` whenever `ACCOUNT_ADMISSION_MODE` is unset or anything other than `"public"`.
   - In `"invitation-only"` mode, **neither** `POST /api/auth/register` **nor** NextAuth OAuth (`Google`, `AzureAD`, `GitHub`) **nor** `CredentialsProvider` may create a new `User` without a valid, non-expired `PENDING` `AccountInvitation`.
2. **Never Store Raw Tokens (`tokenHash`)**:
   - Invitations generate 32 bytes of cryptographic randomness encoded as `base64url` (`randomBytes(32).toString("base64url")`).
   - Only `tokenHash = sha256(token)` is persisted in `AccountInvitation.tokenHash`.
   - Once an invitation transitions to a terminal state (`ACCEPTED`, `REVOKED`, `EXPIRED`), both `tokenHash` and `activeForEmail` are set to `null`.
3. **Single Active Invite per Email (`activeForEmail @unique`)**:
   - While `status === "PENDING"`, `activeForEmail = normalizedEmail`.
   - Enforces at the database constraint level that at most one `PENDING` invitation exists per email address, while still preserving full historical rows for `ACCEPTED`, `REVOKED`, and `EXPIRED` invitations.
4. **Atomic Claim Semantics**:
   - Consuming an invitation (via password registration or verified OAuth sign-in) uses a conditional update (`WHERE id = ? AND status = 'PENDING'`) inside a transaction so concurrent requests cannot double-claim the same token.
5. **Verified OAuth Email Policy**:
   - OAuth providers are never trusted to link or claim an email unless `verifiedProviderEmail(provider, profile)` confirms `email_verified === true` (Google) or a pinned single-tenant `AZURE_AD_TENANT_ID` (Microsoft Entra ID).

---

## 3. Canonical Prisma Schema (Dual SQLite + PostgreSQL Compatible)

To guarantee zero-friction synchronization between local SQLite (`prisma/schema.prisma`) and production PostgreSQL (`prisma/schema.postgres.prisma`), status fields use `String` with application-level union types (`"PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED"`):

```prisma
model User {
  id                         String              @id @default(cuid())
  email                      String              @unique
  name                       String
  firstName                  String?
  lastName                   String?
  passwordHash               String?
  pictureUrl                 String?
  role                       String              @default("Editor")
  status                     String              @default("active") // "active" | "disabled"
  emailVerified              DateTime?
  sessionVersion             Int                 @default(1)
  organizationId             String
  organization               Organization        @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  accounts                   Account[]
  sessions                   Session[]
  passwordCredential         PasswordCredential?
  accountInvitationsSent     AccountInvitation[] @relation("AccountInvitationInviter")
  accountInvitationsAccepted AccountInvitation[] @relation("AccountInvitationAcceptor")
  createdAt                  DateTime            @default(now())
  updatedAt                  DateTime            @updatedAt
}

model Account {
  id                String   @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@index([userId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}

model PasswordCredential {
  id                String    @id @default(cuid())
  userId            String    @unique
  passwordHash      String
  passwordChangedAt DateTime  @default(now())
  resetTokenHash    String?   @unique
  resetExpiresAt    DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model AccountInvitation {
  id              String               @id @default(cuid())
  email           String
  normalizedEmail String
  activeForEmail  String?              @unique
  tokenHash       String?              @unique
  status          String               @default("PENDING") // "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED"
  role            String               @default("Editor")
  organizationId  String
  organization    Organization         @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  invitedById     String?
  invitedBy       User?                @relation("AccountInvitationInviter", fields: [invitedById], references: [id], onDelete: SetNull)
  acceptedById    String?
  acceptedBy      User?                @relation("AccountInvitationAcceptor", fields: [acceptedById], references: [id], onDelete: SetNull)
  expiresAt       DateTime
  acceptedAt      DateTime?
  revokedAt       DateTime?
  createdAt       DateTime             @default(now())
  updatedAt       DateTime             @updatedAt
  emails          AccountEmailOutbox[]

  @@index([status, expiresAt])
  @@index([normalizedEmail, createdAt])
  @@index([organizationId])
}

model AccountEmailOutbox {
  id            String             @id @default(cuid())
  payload       String
  status        String             @default("pending") // "pending" | "sending" | "sent" | "failed"
  claimToken    String?
  lastAttemptAt DateTime?
  lastError     String?
  sentAt        DateTime?
  expiresAt     DateTime
  createdAt     DateTime           @default(now())
  invitationId  String?
  invitation    AccountInvitation? @relation(fields: [invitationId], references: [id], onDelete: SetNull)

  @@index([status, createdAt])
  @@index([invitationId])
}
```

---

## 4. NextAuth + Invite-Only Interaction State Machine

### Flow 0: Root Administrator Bootstrap (Deployment CLI Only — Zero HTTP Surface)
In `invitation-only` mode, public registration is blocked and only an `Admin` can issue invitations. To prevent any internet-exposed privilege-escalation attack surface, **no HTTP bootstrap API endpoint (`/api/auth/bootstrap`) or web bootstrap page (`/admin/bootstrap`) is ever exposed**.

Instead, only the deployment operator with host/container shell access to the application and database can create or promote the root Administrator account via the CLI script:
- **Command (`npm run bootstrap:admin`)**:
  ```bash
  printf '%s\n' 'StrongAdminPassword!' | npm run bootstrap:admin -- --email admin@acme.io --name "Root Admin" --password-stdin
  ```
- **Security Invariants**:
  1. **Zero Public HTTP Surface**: There is no HTTP route that can create or promote an administrator without an existing authenticated `Admin` session.
  2. **Stdin-Safe Password Handling**: Reads the password from `stdin` (`--password-stdin`) so secrets never appear in shell history, process listings (`ps`), or HTTP logs.
  3. **Idempotent Atomic Upsert**: Inside a single Prisma `$transaction`, `bootstrapAdmin()` creates or promotes the `User` (`role = "Admin"`, `status = "active"`, `emailVerified = now`), upserts `PasswordCredential` (`passwordHash`, `passwordChangedAt = now`), and records an `AuditLog` (`system.admin.bootstrap`, `source: "cli"`).
  4. **Subsequent Invitations via Admin Console**: Once bootstrapped via the deployment script, the Admin signs in at `/login` and issues one-time invitation links at `/admin/invitations` (`POST /api/admin/invitations`).

### Flow 1: Admin Invitation Lifecycle
1. **Create (`createAccountInvitation`)**:
   - Normalizes email (`normalizeAccountEmail`), validates syntax, and runs `expirePendingInvitations(now)`.
   - Rejects with `409 already_member` if an active user with credentials already exists for `normalizedEmail`.
   - Rejects with `409 invitation_exists` if `activeForEmail == normalizedEmail` already exists.
   - Generates `token = createOpaqueToken()`, stores `tokenHash = hashOpaqueToken(token)` and `activeForEmail = normalizedEmail`, queues an `AccountEmailOutbox` entry, records an `AuditLog` event, and returns `{ invitation, token, inviteUrl }` **once**.
2. **Rotate (`rotateAccountInvitation`)**:
   - Atomically replaces `tokenHash` with a newly generated token hash and extends `expiresAt` while keeping `status = "PENDING"`.
3. **Revoke (`revokeAccountInvitation`)**:
   - Transitions `PENDING -> REVOKED`, sets `revokedAt = now`, and clears `activeForEmail = null` and `tokenHash = null`.

### Flow 2: Invitation Token Inspection & Password Registration
1. **Inspect (`GET /api/auth/invitation?token=...`)**:
   - Computes `tokenHash = hashOpaqueToken(token)`.
   - If `status === "PENDING"` and `expiresAt <= now`, transitions row to `EXPIRED` and clears `activeForEmail`/`tokenHash`.
   - Returns `{ id, status, email, maskedEmail, role, organizationName, expiresAt }`.
2. **Accept & Register (`POST /api/auth/register` -> `registerWithInvitation`)**:
   - If `accountAdmissionMode() === "invitation-only"` and `token` is missing, rejects with `403 invitation_required`.
   - Verifies `tokenHash` matches a `PENDING`, non-expired `AccountInvitation` and `invitation.normalizedEmail === normalizeAccountEmail(email)`.
   - Hashes the password and inside a transaction:
     - Creates or updates `User` (`status: "active"`, `emailVerified: now`, `role: invitation.role`, `organizationId: invitation.organizationId`).
     - Upserts `PasswordCredential` (`passwordHash`, `passwordChangedAt: now`).
     - Claims `AccountInvitation` via conditional `updateMany({ where: { id, tokenHash, status: "PENDING" }, data: { status: "ACCEPTED", acceptedById: user.id, acceptedAt: now, activeForEmail: null, tokenHash: null } })`.
     - Writes `AuditLog` (`account.invitation.accept`).

### Flow 3: NextAuth `callbacks.signIn` & `CredentialsProvider` Integration (`authorizeSocialSignIn`)
When NextAuth executes a sign-in:
1. **Credentials Sign-In (`account.provider === "credentials"`)**:
   - Looks up `User` + `PasswordCredential`.
   - Rejects if `User` does not exist, `User.status !== "active"`, or password verification fails.
   - **Never** auto-creates an uninvited user during login.
2. **OAuth Sign-In (`google`, `azure-ad`, etc.) via `authorizeSocialSignIn`**:
   - **Step 1 (Returning Linked OAuth Account)**: If `Account` exists for `(provider, providerAccountId)`:
     - Verify `account.user.status === "active"` -> **ALLOW (`true`)**.
   - **Step 2 (Verified Provider Email Check)**:
     - Call `verifiedProviderEmail(provider, profile)`. If email is missing or unverified, reject with `/login?error=OAuthEmailUnverified`.
   - **Step 3 (Existing Active User Match)**:
     - If an active `User` with `email === verifiedEmail` already exists, link the `Account` row `(provider, providerAccountId)` to `user.id` and **ALLOW (`true`)**.
   - **Step 4 (Auto-Claim Matching Pending Invitation — HelloInterview + ReadWise Unified Pattern)**:
     - Look up `AccountInvitation` where `activeForEmail === verifiedEmail` and `status === "PENDING"` and `expiresAt > now`.
     - If found, atomically create `User` (`emailVerified: now`, `role: invitation.role`, `organizationId: invitation.organizationId`), link `Account`, mark `AccountInvitation` as `ACCEPTED` (`activeForEmail: null`, `tokenHash: null`), and **ALLOW (`true`)**.
   - **Step 5 (Uninvited OAuth Attempt)**:
     - If `accountAdmissionMode() === "invitation-only"`, reject with redirect `/login?error=InvitationRequired`.

---

## 5. Standard Reusable Module Layout (`src/lib/account-admission/`)

Every repository adopting this spec exposes the same module tree under `src/lib/account-admission/`:

```text
src/lib/account-admission/
├── errors.ts          # AccountAdmissionError(status, code, message)
├── policy.ts          # accountAdmissionMode(), normalizeAccountEmail(), isValidAccountEmail(), verifiedProviderEmail()
├── tokens.ts          # createOpaqueToken(), hashOpaqueToken(), maskEmail(), accountAdmissionSecretLink()
├── passwords.ts       # hashPassword(), verifyPassword() (supports bcrypt & scrypt hashes)
├── bootstrap.ts       # bootstrapAdmin() — server/CLI-only root Admin provisioning (never exposed via HTTP)
├── invitations.ts     # createAccountInvitation(), inspectAccountInvitation(), rotateAccountInvitation(), revokeAccountInvitation(), expirePendingInvitations(), listAccountInvitations()
├── registration.ts    # registerWithInvitation()
├── social.ts          # authorizeSocialSignIn() for NextAuth callbacks.signIn
└── index.ts           # Canonical public barrel
```

And the same 5 REST endpoints + 2 UI routes + 1 deployment CLI script:
- `scripts/bootstrap-admin.ts` (`npm run bootstrap:admin -- --email <email> --password-stdin`) — Deployment-only CLI script to create/promote the root Admin account (no HTTP bootstrap endpoint is exposed)
- `GET/POST /api/admin/invitations` — List & create invitations (requires authenticated `Admin` session)
- `DELETE /api/admin/invitations/[id]` — Revoke pending invitation (requires authenticated `Admin` session)
- `POST /api/admin/invitations/[id]/rotate` — Rotate token & extend expiry (requires authenticated `Admin` session)
- `GET /api/auth/invitation?token=...` — Public token inspection
- `POST /api/auth/register` — Invitation-gated registration
- `/admin/invitations` — Admin Invitation Console UI
- `/invite/[token]` — One-time Invitation Acceptance UI

---

## 6. Cross-Repository Rollout Matrix (`/home/azadmin`)

All repositories under `/home/azadmin` using the `AccountInvitation` + `NextAuth` mechanism have been aligned to this specification:

| Repository | `src/lib/account-admission/*` | NextAuth `signIn` + Credential Gate | CLI-Only Bootstrap Admin (`npm run bootstrap:admin` — No HTTP Endpoint) | Invitation Console (`/admin/invitations` + `/invite/[token]`) |
|---|---|---|---|---|
| **`/home/azadmin/clueso`** | Aligned (`errors`, `policy`, `tokens`, `passwords`, `bootstrap`, `invitations`, `registration`, `social`, `index`) | Aligned (`authorizeSocialSignIn` + `PasswordCredential`) | Aligned (`scripts/bootstrap-admin.ts` + `bootstrapAdmin()`) | Aligned (`/admin/invitations`, `/invite/[token]`) |
| **`/home/azadmin/ReadWise`** | Aligned (`src/lib/account-admission/*` + `src/lib/auth/bootstrap.ts`) | Aligned (`authorizeSocialSignIn` + `PasswordCredential`) | Aligned (`scripts/bootstrap-admin.ts` + `bootstrapAdmin()`) | Aligned (`/admin/invitations`, `/invite/[token]`) |
| **`/home/azadmin/Arcade`** | Aligned (`errors`, `policy`, `tokens`, `passwords`, `bootstrap`, `invitations`, `registration`, `credentials`, `social`, `index`) | Aligned (`authorizeSocialSignIn` + `PasswordCredential` in `src/lib/auth.ts`) | Aligned (`scripts/bootstrap-admin.ts` + `bootstrapAdmin()`) | Aligned (`/admin/invitations`, `/invite/[token]`) |
| **`/home/azadmin/readwise.io`** | Aligned (`src/lib/account-admission/index.ts` + `src/lib/invitations.ts`) | Aligned (`validateAndClaimInvitation` + `PasswordCredential`) | Aligned (`scripts/bootstrap-admin.ts` + `bootstrapAdmin()`) | Aligned (`/admin/invitations`, `/invite/[token]`) |
| **`/home/azadmin/HelloInterview`** | Aligned (`server/account-admission/*` + `server/auth/admission.ts`) | Aligned (`admitSocialIdentity`) | Aligned (`scripts/bootstrap-admin.ts`) | Aligned (`account_invitations`) |
| **`/home/azadmin/UniLink`** | Aligned (`lib/auth/account-admission.ts` + `lib/auth/admin-bootstrap.ts`) | Aligned (`authorizeAccountSignIn` + `createAdmittedUser`) | Aligned (`scripts/bootstrap-admin.ts`) | Aligned (`ClosedTestInvitation`) |
| **`/home/azadmin/Visdom`** | Aligned (`lib/invite.ts`, `lib/signup.ts`, `lib/pending-signup.ts`) | Aligned (`PendingSignup` OAuth gate + `microsoftEmailTrusted`) | Aligned (`scripts/seed-admin.ts` / `npm run bootstrap:admin`) | Aligned (`/admin/invites`, `/finish-signup`) |
| **`/home/azadmin/TextIQ`** | Aligned (`src/lib/invite-access.ts`, `src/lib/workspace/invite-service.ts`) | Aligned (`evaluateInviteAccess`) | Aligned (CLI seed / Workspace Owner authority) | Aligned (`/app/join/[token]`) |

