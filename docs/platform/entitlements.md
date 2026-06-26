# Entitlements and plan-aware feature gate design

> **Status:** Design (not implemented). This document defines the intended
> model. No production entitlement runtime exists yet. References to helpers
> such as `canUseFeature` and `getFeatureAllowance` describe the proposed
> interface, not current code.
>
> Parent epic: #728 · Issue: #730

---

## 1. Why entitlements, and how they differ from what already exists

ReadWise already has four distinct gating mechanisms. Entitlements are a fifth,
filling a gap none of the existing ones covers.

| Mechanism | Question it answers | Where it lives | Failure mode |
| --- | --- | --- | --- |
| **RBAC / capabilities** (`src/lib/rbac.ts`) | _Does your role permit this operation?_ | `User.role`, `Membership.role`, `ClassroomMembership.role` | 403 Forbidden |
| **Rate limiter** (`src/lib/security/rate-limit/`) | _Are you sending too many requests per time window?_ | Fixed-window counters; env-configured per scope (`ai`, `import`, …) | 429 Too Many Requests |
| **AI budget** (`src/lib/ai/budget.ts`) | _Have you or has this feature consumed too many AI tokens this window?_ | Per-user / per-feature / global fixed-window counters | 429 (interactive) / silent skip (background) |
| **Provider availability** (`src/lib/runtime-config/ai.ts`, speech, push …) | _Is the backing provider configured in this deployment?_ | Env-var presence; graceful fallback to `null` | Silent fallback / feature disabled |
| **Entitlement** _(this document)_ | _Does your plan or subscription include this feature at all?_ | Plan metadata + subject override table | 402 / feature hidden |

### Worked examples

- A `Reader` asking to use AI Tutor is **not** a capability question (all
  authenticated users carry `articles.read` and the tutor is not gated by RBAC
  today). It is **not** a rate-limit question (the window is not exhausted). It
  **is** an entitlement question: _is the AI Tutor feature included in this
  user's plan?_
- A classroom on the **Free** plan trying to add a 31st student is not a
  capabilities problem (the teacher has `classroom.students.manage`). It is an
  entitlement _allowance_ question: _does the Free plan permit more than 30
  classroom seats?_
- A user requesting TTS when the speech provider is not deployed is a
  **provider-availability** problem, not an entitlement problem. The entitlement
  layer should never try to duplicate that check.

---

## 2. Concept vocabulary

| Term | Definition |
| --- | --- |
| **Feature key** | A stable, namespaced string identifying a product capability subject to plan gating (`ai.tutor`, `import.daily_cap`, `tts.generation`, …). Distinct from RBAC capability strings. |
| **Plan** | A named tier that bundles a set of feature entitlements (`free`, `pro`, `classroom`, `school`, `internal`). Plans are configuration, not runtime DB rows, for the initial phase. |
| **Entitlement** | The record that a given plan includes a given feature, optionally with an allowance (numeric limit) or a boolean gate (enabled/disabled). |
| **Allowance** | A numeric ceiling within an entitlement: e.g. `import.daily_cap = 5` for Free vs `50` for Pro. `null` means unlimited. |
| **Subject** | The entity whose plan is being evaluated: a `User`, an `Organization`, or a `Classroom`. A subject can hold at most one plan at a time. |
| **Scope** | The level at which the subject's plan applies: `user`, `org`, or `classroom`. Classroom and org subjects may carry plans separate from their members' individual plans. |
| **Override** | An explicit per-subject record that adds, removes, or adjusts an entitlement outside the subject's current plan (e.g. beta access, penalized account, internal allowlist). |
| **Denial reason** | A structured code returned when a feature is not available, allowing the product to render the right UX (upgrade prompt vs. quota message vs. "not in your plan"). |
| **Entitlement context** | The runtime value containing the resolved subject, scope, and plan used by the `canUseFeature` / `getFeatureAllowance` helpers. |

---

## 3. Feature key catalogue

Feature keys follow the pattern `<domain>.<noun>` or `<domain>.<verb>`. The
list below is the initial candidate set. Keys are deliberately separate from
RBAC capability strings; they belong in a dedicated registry
(`src/lib/entitlements/features.ts`).

| Feature key | Domain | Owner subsystem | Notes |
| --- | --- | --- | --- |
| `ai.tutor` | AI | `src/lib/ai/tutor.ts` | Conversational tutor |
| `ai.translation` | AI | `src/lib/translation.ts` | Per-article translation |
| `ai.quiz` | AI | `src/lib/quiz-grading.ts` | Quiz / vocab generation |
| `ai.definitions` | AI | `src/lib/lexical/` | Inline word definitions |
| `import.daily_cap` | Reader | `src/lib/import/quota.ts` | Daily article import limit (allowance) |
| `tts.generation` | Speech | `src/lib/speech/` (planned) | Text-to-speech generation |
| `tts.listening` | Speech | `src/lib/speech/` (planned) | TTS playback access |
| `push.reminders` | Push | `src/lib/push/` | Push notification reminders |
| `offline.downloads` | Reader | future | Offline reading download |
| `classroom.seats` | Classroom | `src/lib/classroom/` | Max enrolled students (allowance) |
| `classroom.assignments` | Classroom | `src/lib/classroom/` | Assignment feature availability |
| `analytics.export` | Analytics | `src/lib/analytics/` | Org/classroom analytics export |
| `admin.sources` | Admin | `src/lib/admin/` | Custom content source management |

---

## 4. Denial reason vocabulary

The `canUseFeature` response includes a denial reason code so callers can
distinguish upgrade prompts from quota messages.

| Code | Meaning | Suggested UX |
| --- | --- | --- |
| `plan.not_included` | Feature is absent from the subject's plan | Show upgrade CTA |
| `plan.allowance_exceeded` | Numeric allowance exhausted for the current period | Show usage + reset time |
| `override.denied` | An explicit per-subject override blocks this feature | Show admin contact |
| `subject.no_plan` | Subject has no plan assigned (misconfiguration) | Default to `free` plan permissive fallback |
| `provider.unavailable` | Provider not configured in this deployment (orthogonal; returned for completeness) | Feature disabled silently |

---

## 5. Proposed plan definitions

Plans are initially static configuration (a TypeScript constant or JSON file),
not a database table. This matches the codebase's existing pattern for provider
and rate-limit config via `src/lib/runtime-config/`.

```
free:
  ai.tutor            → disabled
  ai.translation      → disabled
  ai.quiz             → disabled
  ai.definitions      → enabled
  import.daily_cap    → allowance: 5        (matches current hard-coded limit)
  tts.generation      → disabled
  tts.listening       → disabled
  push.reminders      → enabled
  offline.downloads   → disabled
  classroom.seats     → allowance: 30
  classroom.assignments → enabled
  analytics.export    → disabled
  admin.sources       → disabled

pro:
  ai.tutor            → enabled
  ai.translation      → enabled
  ai.quiz             → enabled
  ai.definitions      → enabled
  import.daily_cap    → allowance: 50
  tts.generation      → enabled
  tts.listening       → enabled
  push.reminders      → enabled
  offline.downloads   → enabled
  classroom.seats     → allowance: null     (unlimited)
  classroom.assignments → enabled
  analytics.export    → enabled
  admin.sources       → disabled

classroom:
  ai.tutor            → enabled
  ai.translation      → enabled
  ai.quiz             → enabled
  ai.definitions      → enabled
  import.daily_cap    → allowance: 20
  tts.generation      → enabled
  tts.listening       → enabled
  push.reminders      → enabled
  offline.downloads   → disabled
  classroom.seats     → allowance: null
  classroom.assignments → enabled
  analytics.export    → enabled
  admin.sources       → disabled

school / internal:
  All features enabled; allowances null (unlimited).
```

The plan config is pure TypeScript so it can be imported anywhere without I/O,
matching `src/lib/rbac.ts`'s intentional design.

---

## 6. Data model

### Phase 1 — config-only (no new DB table)

Plans and their entitlements live in a static config constant. Subjects are
identified by a `planKey` string stored on an existing model column:

| Subject type | Plan storage | Example value |
| --- | --- | --- |
| `User` | `User.plan String? @default("free")` | `"free"`, `"pro"` |
| `Organization` | `Organization.plan String? @default("free")` | `"classroom"`, `"school"` |
| `Classroom` | inherits from `Organization` | — |

Adding a single nullable `plan` string column to `User` and `Organization` is
non-destructive. Existing rows default to `"free"`, so no row has different
behavior than today (the free plan mirrors current defaults). **This is the only
schema change proposed for Phase 1.**

### Phase 2 — override table (small additive migration)

A lightweight override table enables per-subject adjustments without changing
the plan:

```
model EntitlementOverride {
  id          String   @id @default(cuid())
  subjectType String   // "user" | "org" | "classroom"
  subjectId   String
  featureKey  String
  enabled     Boolean? // null = inherit from plan
  allowance   Int?     // null = inherit from plan; -1 = deny
  reason      String?  // admin note
  expiresAt   DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([subjectType, subjectId, featureKey])
  @@index([subjectType, subjectId])
}
```

Overrides are looked up before plan defaults. An `enabled: false` override
results in `override.denied` regardless of plan. An `allowance: -1` override
means the feature is completely denied even if the plan normally allows it.

### Phase 3 — billing integration (out of scope for this issue)

Phase 3 would add a `Subscription` model (with Stripe or another payment
provider) that controls which `planKey` is active and handles metered usage
webhooks. This is explicitly out of scope and requires its own issue.

---

## 7. Proposed public API

```typescript
// src/lib/entitlements/index.ts

export type EntitlementContext = {
  /** Authenticated user id or null (anonymous). */
  userId: string | null;
  /** User's plan key (resolved from DB or session). */
  userPlan: string;
  /** Organization the subject belongs to, if applicable. */
  orgId?: string | null;
  /** Organization's plan key (resolved from DB or Org model). */
  orgPlan?: string | null;
};

export type FeatureResult =
  | { granted: true; allowance: number | null }
  | { granted: false; reason: DenialReason; allowance?: never };

export type DenialReason =
  | "plan.not_included"
  | "plan.allowance_exceeded"
  | "override.denied"
  | "subject.no_plan"
  | "provider.unavailable";

/**
 * Returns whether the subject in `ctx` is entitled to `featureKey`.
 * This is the primary gate. It is PURE and synchronous for phase 1
 * (config-backed); it becomes async in phase 2 when override rows are
 * consulted.
 *
 * Start permissive: unknown feature keys return granted=true so that new
 * features are not accidentally blocked before their entitlement record
 * is written.
 */
export function canUseFeature(
  ctx: EntitlementContext,
  featureKey: string,
): FeatureResult { /* … */ }

/**
 * Returns the numeric allowance for `featureKey` (e.g. import.daily_cap).
 * Returns null for unlimited. Returns 0 when the feature is denied.
 * Prefer `canUseFeature` for boolean gates; use `getFeatureAllowance` only
 * when the allowance value itself is needed (e.g. to display quota to user).
 */
export function getFeatureAllowance(
  ctx: EntitlementContext,
  featureKey: string,
): number | null { /* … */ }
```

Both functions are **pure** in phase 1: they take a fully resolved context and
consult only in-memory config. The context object is assembled once per request
in the API handler or server component, keeping I/O out of the entitlement
logic.

---

## 8. Entitlement context resolution

Resolving the context requires at most two DB reads (user row, org row):

```typescript
// src/lib/entitlements/context.ts

/**
 * Resolves an EntitlementContext from the current session and, optionally, the
 * active organization. Should be called once per request boundary and passed
 * down — not called deep inside helper functions.
 */
export async function resolveEntitlementContext(
  session: Session | null,
  orgId?: string | null,
): Promise<EntitlementContext> { /* … */ }
```

In server components and route handlers this fits naturally alongside the
existing `loadSession()` call from `src/lib/auth-core.ts`. The resolved context
can be passed as a prop or included in an API handler's initialization block.

---

## 9. Relationship to existing gating layers

The entitlement layer sits **above** provider availability and **orthogonal to**
RBAC and rate limits. All four layers can coexist on the same endpoint:

```
Request
  └── 1. RBAC / capabilities  (does your role allow the operation?)
  └── 2. Entitlement gate     (does your plan include this feature?)
  └── 3. Rate limiter         (are you sending too many requests?)
  └── 4. AI budget            (have you or your feature consumed enough tokens?)
  └── 5. Provider availability (is the backing service configured?)
  └── Handler logic
```

A feature that passes the entitlement gate can still be rate-limited or
budget-blocked. A feature that fails the entitlement gate does not reach the
rate-limiter and does not consume budget counters — this prevents quota
"wasting" on denied features.

### Import quota alignment

`src/lib/import/quota.ts` currently hard-codes `DAILY_IMPORT_LIMIT = 5`.
In the entitlement model this becomes the `import.daily_cap` allowance for the
`free` plan (set to `5`). The existing `assertWithinDailyQuota` function stays
as the enforcement mechanism but reads its cap from `getFeatureAllowance(ctx,
"import.daily_cap")` instead of the constant, allowing Pro users to have a
higher daily cap without a code change.

### AI budget alignment

The AI budget system (`src/lib/ai/budget.ts`) enforces per-window counters and
is orthogonal to plan gating. The entitlement check (`canUseFeature(ctx,
"ai.tutor")`) fires before the AI budget check (`assertAiQuota`) so a Free user
is denied at the entitlement layer and never consumes a budget slot.

---

## 10. Enforcement points

| Feature key | Enforcement file | Phase 1 change |
| --- | --- | --- |
| `import.daily_cap` | `src/lib/import/quota.ts` · `assertWithinDailyQuota` | Read allowance from `getFeatureAllowance(ctx, "import.daily_cap")` instead of constant |
| `ai.tutor` | `src/app/api/tutor/route.ts` | Add `canUseFeature(ctx, "ai.tutor")` before `assertAiQuota` |
| `ai.translation` | `src/app/api/translate/route.ts` (or similar) | Same pattern |
| `ai.quiz` | Quiz generation API route | Same pattern |
| `ai.definitions` | `src/lib/lexical/` lookup route | Same pattern |
| `tts.generation` | TTS API route (when added) | Same pattern |
| `classroom.seats` | `src/lib/classroom/commands.ts` · add-student path | Check `getFeatureAllowance(ctx, "classroom.seats")` before insert |
| `analytics.export` | analytics export API route (when added) | `canUseFeature(ctx, "analytics.export")` |

All enforcement points should return a structured error with the denial reason so
the client can render the appropriate UX (upgrade modal vs. quota tooltip).
Return HTTP 402 Payment Required for `plan.not_included` and
`plan.allowance_exceeded` so clients can distinguish feature denials from
auth/rate errors.

---

## 11. Denial and fallback behavior

| Feature type | User-facing behavior when denied |
| --- | --- |
| **Interactive AI features** (tutor, translation, quiz) | API returns 402 with `{ error: "plan.not_included", featureKey: "ai.tutor" }`. Client shows an upgrade prompt. |
| **Import cap** | API returns 402 with `{ error: "plan.allowance_exceeded", featureKey: "import.daily_cap", allowance: 5 }`. Client shows quota message and reset time. |
| **TTS** | TTS button is hidden or disabled in the UI when `canUseFeature` returns false (pre-check on page load). API also enforces. |
| **Classroom seats** | Teacher UI shows remaining seat count from `getFeatureAllowance`; the add-student API returns 402 when allowance exhausted. |
| **Analytics export** | Export button is hidden; API returns 402. |
| **Provider unavailable** | Existing graceful fallback is unchanged. The entitlement layer does not re-implement this check; providers surface their own `null` / disabled state. |

Start permissive: **unknown feature keys return `granted: true`** so that a
missing entitlement record does not accidentally block features during
migration.

---

## 12. Phased adoption path

### Phase 0 — Now (no code change required)

This document is the deliverable. No runtime entitlements code exists. All
existing gating behavior is unchanged.

### Phase 1 — Config-backed entitlements (first implementation)

1. Add `plan String? @default("free")` to `User` and `Organization` (additive,
   nullable migration).
2. Implement `src/lib/entitlements/features.ts` (feature key registry), `plans.ts`
   (static plan config), and `index.ts` (`canUseFeature` / `getFeatureAllowance`
   pure helpers).
3. Implement `src/lib/entitlements/context.ts` (`resolveEntitlementContext`).
4. Wire `import.daily_cap` into `assertWithinDailyQuota` as the first enforced
   entitlement (lowest risk: same allowance as today for free users).
5. Expose the resolved entitlement context in the API handler initialization
   block so subsequent phases can add checks without touching request plumbing.
6. Add focused unit tests for the pure helpers (no DB required for phase 1
   tests).

### Phase 2 — Override table and admin UI (next increment)

1. Add the `EntitlementOverride` model (small additive migration).
2. Make `canUseFeature` / `getFeatureAllowance` consult overrides (single indexed
   query by `subjectType + subjectId`).
3. Wire remaining feature keys (AI tutor, TTS, classroom seats, analytics
   export) as product features ship.
4. Add an admin UI section for viewing/editing overrides (per-user and per-org).

### Phase 3 — Billing integration (future, separate issue)

1. Introduce a `Subscription` model with a `planKey` field controlled by a
   payment provider webhook.
2. `resolveEntitlementContext` reads the active plan from the `Subscription` row
   rather than the plain `User.plan` string.
3. No changes to `canUseFeature` / `getFeatureAllowance` — the plan key is still
   a string; the resolver absorbs the billing complexity.

---

## 13. What is NOT in scope for this issue

- No Stripe or billing provider integration.
- No pricing table UI.
- No destructive migration.
- No changes to existing RBAC capabilities or rate-limit logic.
- No provider configuration changes.

---

## 14. Related documents

- [`docs/access/rbac.md`](../access/rbac.md) — capabilities and role model
- [`docs/access/multi-tenancy.md`](../access/multi-tenancy.md) — org / classroom model
- [`docs/ai/governance-ledger.md`](../ai/governance-ledger.md) — AI budgets and usage
- [`docs/platform/runtime-config.md`](./runtime-config.md) — environment-based configuration patterns
- Issue #728 (parent epic) · Issue #730 (this design)
