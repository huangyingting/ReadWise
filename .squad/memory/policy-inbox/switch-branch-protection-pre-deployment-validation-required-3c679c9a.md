---
id: 3c679c9a-c8e3-4f02-8053-c80f4e3a44b1
class: POLICY
loadGuidance: [ALWAYS]
title: "Branch protection pre-deployment validation required"
author: "Switch"
createdAt: 2026-07-10T06:06:37.442Z
metadata: {}
---

Branch protection with required status checks must pass pre-deployment validation: (1) run CI on target branch and verify all proposed required checks pass; (2) sync required check names with actual CI job names in workflow; (3) review decision log for alignment before implementation; (4) extract infrastructure changes to separate PRs from feature work. Failure to validate before deployment causes organization-wide blocking of all PRs to target branch.
