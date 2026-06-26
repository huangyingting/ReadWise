<!--
  ReadWise pull-request template.
  Delete sections that do not apply; keep the schema checklist if prisma/ is touched.
-->

## Summary

<!-- What does this PR do? Why? -->

## Related issues

<!-- Closes #NNN -->

---

## Schema-change checklist

<!--
  Complete this section if the PR touches prisma/schema.prisma,
  prisma/postgresql/schema.prisma, or any prisma/migrations/ directory.
  Delete this section entirely for PRs with no schema changes.

  Full guidance: docs/platform/schema-change-checklist.md
  Data-lifecycle matrix: docs/security/data-lifecycle-matrix.md
-->

- [ ] **Parity** — `npm run schema:check-parity` exits 0
- [ ] **Migration artefacts** — new migration directories committed for both SQLite and PostgreSQL with matching names
- [ ] **Data classification** — each new model/field is labelled `public`, `personal`, `sensitive`, `derived`, or `operational`
- [ ] **Log/metadata safety** — confirmed whether new fields may appear in logs/analytics; `src/lib/security/redaction.ts` updated if needed
- [ ] **Export decision** — new fields are included in or explicitly excluded from the `exportUserData` bundle, with reason noted
- [ ] **Deletion/cascade** — `onDelete`/`onUpdate` is intentional; audit, analytics, and job-history rows are not silently cascade-deleted
- [ ] **Retention window** — defined (indefinite / TTL / policy-bounded); data-lifecycle matrix updated
- [ ] **Visibility/tenancy** — scope enforced by DB constraint, not convention alone
- [ ] **Seed and tests** — `scripts/seed.ts` and test factories updated for new required fields
- [ ] **Indexes** — columns used in `WHERE`/`ORDER BY`/`@@unique` have explicit `@@index` or `@unique`
- [ ] **Documentation** — [`docs/security/data-lifecycle-matrix.md`](../docs/security/data-lifecycle-matrix.md) and [`docs/access/account-lifecycle.md`](../docs/access/account-lifecycle.md) reviewed and updated

---

## Testing

<!-- How was this tested? Which commands were run? -->

## Notes for reviewers

<!-- Anything unusual, deferred, or requiring follow-up? -->
