---
type: "reference"
status: "current"
last_updated: "2026-07-10"
description: "Documents the ReadWise three-branch model (main/dev/insiders), branch naming, worktree workflow, and promotion pipeline."
---

# Git workflow and branch model

ReadWise uses a three-branch model. All feature work targets `dev`; `main` is
the released, tagged, stable branch.

## Branch purposes

| Branch | Purpose | CI |
| --- | --- | --- |
| `main` | Released code only; tagged for stable npm publish | Full CI on every push and PR |
| `dev` | Integration branch — all feature PRs land here first | Full CI on every push and PR |
| `insiders` | Early-access channel; synced automatically from `dev` | — |

## Naming convention

Issue branches **must** follow: `squad/{issue-number}-{kebab-case-slug}`

Examples: `squad/195-fix-version-stamp-bug`, `squad/42-add-profile-api`

## Standard workflow

1. Branch from `dev` (never from `main`):
   ```bash
   git fetch origin dev
   git checkout -b squad/{issue-number}-{slug} origin/dev
   ```
2. Create a **draft** PR targeting `dev`.
3. Do the work; commit with issue reference.
4. Push and mark the PR ready for review.
5. After merge to `dev`, delete the remote feature branch.

## Parallel work (worktrees)

When the coordinator runs multiple issues simultaneously, use `git worktree` to
give each agent an isolated working directory. Never switch branches in the main
checkout while worktrees are active.

```bash
# Create a worktree per issue, siblings to the main clone:
git worktree add ../ReadWise-{issue-number} -b squad/{issue-number}-{slug} origin/dev
```

Naming convention: `../{repo-name}-{issue-number}` (e.g. `../ReadWise-42`).

After a worktree's PR is merged:
```bash
git worktree remove ../ReadWise-{issue-number}
git worktree prune
git branch -d squad/{issue-number}-{slug}
git push origin --delete squad/{issue-number}-{slug}
```

## Promotion pipeline

```
feature branch  →  dev  →  insiders (automated)  →  main (manual, tag)
```

- `dev → insiders`: Automated sync on green build.
- `dev → main`: Manual merge when ready for stable release; create a tag.
- Hotfixes: Branch from `main` as `hotfix/{slug}`, PR to `dev`, cherry-pick to
  `main` if urgent.

## Anti-patterns

- ❌ Branching from `main` — always branch from `dev`
- ❌ PRs targeting `main` directly — target `dev`
- ❌ Non-conforming branch names — must be `squad/{number}-{slug}`
- ❌ Switching branches in the main clone while worktrees are active
- ❌ Committing directly to `main` or `dev` — use PRs
