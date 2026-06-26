# Supply-chain and dependency hygiene

ReadWise depends on Next.js, Prisma, Azure SDKs, OpenTelemetry, NextAuth,
web-push, Playwright, scraper libraries, and AI/Speech providers.  This document
records the dependency hygiene policy, the automated CI gates, and how to respond
to vulnerability advisories.

Automated gates are defined in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).
For general CI topology, see [`ci.md`](ci.md).

---

## Gates at a glance

| Gate | Where | Severity | Blocking? |
| --- | --- | --- | --- |
| **Lockfile integrity** (`npm ci`) | `supply-chain` CI job | n/a | **Yes** — hard fail |
| **npm audit** | `supply-chain` CI job | HIGH + CRITICAL | Advisory (see below) |
| **Dependency review** | `dependency-review` CI job (PRs only) | HIGH + CRITICAL | **Yes** — blocks PR merge |
| **Dependabot security updates** | Automated PRs | all | PR opened automatically |

---

## Lockfile policy

`package-lock.json` is **committed** and is the single source of truth for the
dependency graph.

- Always commit `package-lock.json` alongside any `package.json` changes.
- Use `npm install` (not `--force`) to update the lockfile; never hand-edit it.
- `npm ci` — used in every CI job — fails immediately if the lockfile is absent
  or inconsistent with `package.json`.  This is the hard, zero-false-positive
  lockfile integrity gate.

**Fix for a drifted lockfile:**

```bash
npm install          # regenerates package-lock.json from package.json
git add package-lock.json
git commit -m "chore: sync package-lock.json"
```

---

## Vulnerability scanning (npm audit)

### Policy

| Severity | Action |
| --- | --- |
| **Critical** | Fix or mitigate before merging to `main`. Open a tracking issue immediately. |
| **High** | Fix or document an exception within one sprint. Blocks new PRs that _introduce_ the vulnerable package (via dependency-review). |
| Moderate | Triage within the current release cycle; fix when a non-breaking upgrade exists. |
| Low / Info | Fix opportunistically; no timeline required. |

### Current advisory state

As of the date this gate was added, the audit reports **2 HIGH** advisories and
**26 moderate** advisories, all transitive.  The HIGH advisories are in
`@opentelemetry/exporter-prometheus` and `@opentelemetry/sdk-node`
([GHSA-q7rr-3cgh-j5r3](https://github.com/advisories/GHSA-q7rr-3cgh-j5r3)).
No direct fix is available without a breaking `@opentelemetry` upgrade.

Because of these pre-existing advisories, the `npm audit` step in the
`supply-chain` CI job runs with **`continue-on-error: true`** (advisory mode).
The step always runs and its output is written to the run summary, so the signal
is visible without breaking CI.

**Promote to blocking** once the pre-existing HIGH advisories are resolved:

1. Verify `npm audit --audit-level=high` exits 0 locally.
2. Remove `continue-on-error: true` from the `npm audit (HIGH/CRITICAL — advisory)`
   step in `.github/workflows/ci.yml`.
3. Commit the change.

### Triaging a new advisory

1. Run `npm audit --json | npx better-npm-audit` (or read the raw JSON) to
   identify the vulnerable package and its dependency path.
2. Check whether a non-breaking fix is available: `npm audit fix --dry-run`.
3. If fixable, apply it: `npm audit fix` (without `--force`) and commit the
   updated `package-lock.json`.
4. If **not fixable** (breaking change, no upstream fix, or false positive):
   - Open a GitHub issue labelled `security` describing the advisory, the
     dependency path, and why immediate upgrade is not feasible.
   - Document the exception in this file under [Exception log](#exception-log).
   - The `continue-on-error: true` flag in CI covers pre-existing advisories;
     new ones discovered by `dependency-review` will still block PRs that add
     or upgrade the affected package.

---

## Dependency review (new dependencies on PRs)

The `dependency-review` job runs `actions/dependency-review-action@v4` on every
pull request.  It **only** scans packages that are **added or changed** by the
PR diff — it does not rescan the entire existing graph.

- Fails on **HIGH** or **CRITICAL** severity vulnerabilities in newly introduced
  packages.
- Posts a comment on the PR with a summary of any findings.
- Does not require external credentials; uses the public GitHub Advisory Database
  via the built-in `GITHUB_TOKEN`.

If the action fails on a legitimate new dependency that carries a known advisory:

1. Evaluate whether an alternative package or a patched version exists.
2. If unavoidable, document the exception (see below) and update the PR
   description with a rationale.  A maintainer with write access can override the
   check by approving the PR.

---

## Dependabot automated updates

`.github/dependabot.yml` configures Dependabot to open pull requests for:

- **npm** — weekly (Mondays, 08:00 UTC); patch and minor updates are grouped to
  reduce PR noise; security updates are opened immediately regardless of schedule.
- **GitHub Actions** — weekly; keeps action pins up to date.

Dependabot PRs go through the same CI gates as any other PR, including
`dependency-review`.  Merge Dependabot security PRs promptly.

**Cadence targets:**

| Type | Target merge window |
| --- | --- |
| Security (any severity) | Within 3 business days of the PR opening |
| Major version | Manual review; no automatic open |
| Minor / patch | Within 2 weeks (or close if stale) |

---

## Secret scanning

GitHub's built-in secret scanning is expected to be enabled on the repository.
**Never** commit secrets, API keys, tokens, or connection strings to source code
or to this documentation.  Use GitHub repository secrets or `.env` files (which
are `.gitignore`-listed) for local development.

If a secret is accidentally committed:

1. Rotate the secret immediately.
2. Use `git filter-repo` (never `git filter-branch`) to remove it from history.
3. Force-push to all branches and notify affected services.

---

## License policy

All runtime dependencies must carry a permissive open-source licence (MIT, ISC,
BSD-2, BSD-3, Apache-2.0, or equivalent).  GPL-licensed packages are not permitted
in the production dependency tree without explicit approval.

To audit licences: `npx license-checker --production --summary`.

---

## Exception log

Pre-existing exceptions are listed here.  Each entry must include the advisory
ID, the affected package, the reason for deferral, and a target remediation date.

| Advisory | Package | Severity | Reason for deferral | Target |
| --- | --- | --- | --- | --- |
| [GHSA-q7rr-3cgh-j5r3](https://github.com/advisories/GHSA-q7rr-3cgh-j5r3) | `@opentelemetry/exporter-prometheus`, `@opentelemetry/sdk-node` (transitive) | HIGH | No non-breaking fix available upstream as of gate introduction. Fix requires a major `@opentelemetry` upgrade; tracked separately. | Next `@opentelemetry` major release |
