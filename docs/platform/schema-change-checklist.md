# Schema-change privacy and retention checklist

Use this checklist for **every** Prisma model or migration change before
opening a pull request. It extends the brief checklist in
[`database.md §Schema-change checklist`](./database.md#schema-change-checklist)
with explicit privacy, retention, export, and cascade requirements drawn from
the [data-lifecycle matrix](../security/data-lifecycle-matrix.md).

> **Tip:** paste the [PR template section](#pr-template-fragment) into your
> pull-request description so reviewers can see the checklist outcome at a
> glance.

---

## 1. Parity and migration hygiene

- [ ] **Schema parity** — `npm run schema:check-parity` exits 0. Both
  `prisma/schema.prisma` (SQLite) and `prisma/postgresql/schema.prisma`
  (PostgreSQL) are byte-identical except for the `provider` line.
- [ ] **Migration parity** — new migration directories exist in both
  `prisma/migrations/` and `prisma/postgresql/migrations/` with matching
  timestamped names.
- [ ] **All four artefacts committed together** — both schema files and both
  migration SQL files land in the same commit.
- [ ] **Parity script passes** — `npm test` (unit + parity) and, where
  possible, `npm run test:db` (PostgreSQL integration) are green.

---

## 2. Data classification

Every new model and every new field must be classified before the PR is merged.
Refer to the [data-lifecycle matrix legend](../security/data-lifecycle-matrix.md#legend)
for the full definition of each class.

- [ ] **Classification assigned** — each new model or field is labelled as one
  of: `public`, `personal`, `sensitive`, `derived`, or `operational`.
- [ ] **Sensitive fields called out** — fields that contain credentials, tokens,
  PII, or raw AI output carry an inline Prisma schema comment explaining what
  class of data they hold (e.g. `// sensitive: OAuth access token — never log`).
- [ ] **Log/metadata safety determined** — confirm whether each new field may
  appear in structured logs, analytics metadata, audit records, or error
  context. If not, add the field name or key pattern to
  `src/lib/security/redaction.ts` (or document why an existing catch-all
  already covers it).

---

## 3. Export inclusion

- [ ] **Export decision made** — confirm whether the new model or field should
  appear in the `exportUserData` bundle
  (`src/lib/account-lifecycle/account-commands.ts`).
  - If **yes** → add the field to the export query and note it in the
    [data-lifecycle matrix](../security/data-lifecycle-matrix.md).
  - If **no** → document the reason (e.g. "operational — not user-owned",
    "sensitive — token excluded by policy").
- [ ] **No secrets in export** — verify that no token, credential, or raw
  session value is reachable through the export path.

---

## 4. Deletion and cascade behaviour

- [ ] **`onDelete` / `onUpdate` is intentional** — every new foreign key
  explicitly sets `onDelete` and, where relevant, `onUpdate`. The choice must
  be deliberate:
  - `Cascade` — used only when the child row has no independent value after the
    parent is deleted (e.g. a session belonging to a user).
  - `SetNull` — used when the child row must survive parent deletion with the
    FK nulled (e.g. an analytics event after its source article is deleted).
  - `Restrict` / `NoAction` — used when deletion of the parent must be blocked
    until the child is explicitly removed (e.g. an organization with active
    members).
- [ ] **Audit and analytics rows preserved** — rows that record user or
  operator actions (audit logs, AI invocations, job history, analytics events)
  are **not** cascade-deleted when the parent user or article is removed,
  unless a separate retention policy explicitly allows it. Use `SetNull` with a
  nullable FK, or denormalize the relevant identifier at write time.
- [ ] **Soft references documented** — if a relation is enforced only in
  application code (not a DB-level FK), note it in the schema comment and in
  the data-lifecycle matrix (see existing `Article.organizationId` example).
- [ ] **Storage-layer cascade** — if the model references binary assets stored
  outside the database (speech files, images, object-storage blobs), document
  which abstraction owns their lifecycle and whether deletion cascades to the
  storage layer.

---

## 5. Retention window

- [ ] **Retention window defined** — specify how long rows live:
  - *Indefinite* — rows survive until the owning user or article is deleted.
  - *TTL-based* — rows expire after a fixed period (e.g. `VerificationToken`
    expires via the `expires` column).
  - *Policy-bounded* — rows are pruned by a background job or operator action.
- [ ] **Matrix updated** — the "Retention" column in the
  [data-lifecycle matrix](../security/data-lifecycle-matrix.md) is updated for
  every new or changed model.
- [ ] **Known gaps recorded** — if a retention window cannot be implemented yet,
  add a numbered gap entry (e.g. `712-A` style) to the matrix "Known gaps and
  open items" section and open or reference a tracking issue.

---

## 6. Visibility and tenancy

- [ ] **Visibility scope enforced** — new content models that can be scoped to
  a user or organisation include an explicit visibility or owner field. Rows
  without an owner or visibility scope must be impossible by constraint, not
  just by convention.
- [ ] **Multi-tenancy isolation preserved** — row-level isolation for
  organisation-scoped models is verified in tests or documented in
  [`docs/access/multi-tenancy.md`](../access/multi-tenancy.md).

---

## 7. Seed, tests, and indexes

- [ ] **Seed data updated** — if new non-nullable fields or required relations
  are added, `scripts/seed.ts` and any test factories are updated.
- [ ] **Indexes present** — every column used in `WHERE`, `ORDER BY`, or
  `@@unique` across API or worker queries has an explicit `@@index` or
  `@unique` in the schema.
- [ ] **Schema comments added** — non-obvious design decisions (visibility
  rules, retention policies, nullable intent) are documented with inline
  Prisma schema comments. Long narratives belong in `docs/`.

---

## 8. Documentation updates

- [ ] **Data-lifecycle matrix updated** — add a row (or update an existing row)
  in [`docs/security/data-lifecycle-matrix.md`](../security/data-lifecycle-matrix.md)
  for every new or materially changed model.
- [ ] **`database.md` schema governance section reviewed** — if the change
  introduces a new allowed parity divergence or a new constraint pattern,
  update [`docs/platform/database.md §Allowed differences`](./database.md#allowed-differences).
- [ ] **`account-lifecycle.md` reviewed** — if the change affects how user data
  is exported or deleted, update
  [`docs/access/account-lifecycle.md`](../access/account-lifecycle.md).

---

## PR template fragment

Paste the following block into pull-request descriptions for any schema change:

```markdown
### Schema-change checklist

<!-- Complete only if this PR touches prisma/schema.prisma or migrations. -->

- [ ] Parity — `npm run schema:check-parity` exits 0
- [ ] Migration artefacts committed for both SQLite and PostgreSQL
- [ ] Data classification assigned for each new model/field
- [ ] Log/metadata safety confirmed; redaction.ts updated if needed
- [ ] Export decision documented (included or excluded with reason)
- [ ] `onDelete`/`onUpdate` behaviour is intentional; audit rows not silently cascaded
- [ ] Retention window defined and data-lifecycle matrix updated
- [ ] Visibility/tenancy scope enforced by constraint
- [ ] Seed, tests, and indexes updated
- [ ] Cross-references: data-lifecycle matrix and account-lifecycle docs reviewed
```

---

## Quick reference: cross-links

| Document | Purpose |
|---|---|
| [`docs/security/data-lifecycle-matrix.md`](../security/data-lifecycle-matrix.md) | Per-model classification, export, deletion, retention, and log-safety table |
| [`docs/platform/database.md`](./database.md) | Parity contract, migration workflow, and brief schema-change checklist |
| [`docs/access/account-lifecycle.md`](../access/account-lifecycle.md) | Export and deletion contract for user data |
| [`docs/analytics/product-analytics.md`](../analytics/product-analytics.md) | Analytics privacy and retention policy |
| [`docs/ai/governance-ledger.md`](../ai/governance-ledger.md) | AI invocation ledger privacy rules |
| [`docs/security/overview.md`](../security/overview.md) | Security redaction policy (§5) |
| [`docs/access/multi-tenancy.md`](../access/multi-tenancy.md) | Multi-tenancy deletion rules |
| `src/lib/security/redaction.ts` | Runtime log/metadata redaction implementation |
| `src/lib/account-lifecycle/account-commands.ts` | `exportUserData` and `deleteUser` implementations |
