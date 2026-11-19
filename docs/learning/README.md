---
type: "index"
status: "current"
last_updated: "2026-11-19"
description: "Learner experience and evidence: Today sessions, mastery and SRS, placement and levels, study plans, gamification, reading series, and teacher and classroom learning tools."
---

# Learning

Learner evidence, mastery, and study workflows, plus classroom learning features that run after Access has authorized the viewer.

Add a document here when the change affects what a learner studies or practises, how progress is measured, or the teacher tools used during reading.

## Code ownership

- `src/lib/learning/`, `src/lib/engagement/`, `src/lib/study/`, `src/lib/leveling/`, `src/lib/difficulty/`
- `src/lib/classroom/` (activities, annotations, writing, text sets), `src/lib/lesson/`
- `src/app/(app)/today/`, `src/app/(app)/study/`, `src/app/(app)/teacher/`

Template: [`provider-difficulty-labels.template.csv`](./provider-difficulty-labels.template.csv) is the human difficulty-label sheet described in [`difficulty-calibration.md`](./difficulty-calibration.md).

## Documents

<!-- BEGIN GENERATED: docs-index (npm run docs:index) -->

| Document | Type | Status | Description |
| --- | --- | --- | --- |
| [Classroom annotations](./classroom-annotations.md) | design | current | Documents classroom annotations: teacher guided prompts anchored to passages of assigned articles, learner replies and explicitly shared evidence highlights, reader rendering, the teacher review page, privacy of personal highlights, RBAC, APIs, and audit. |
| [Difficulty calibration and aggregate evaluation](./difficulty-calibration.md) | reference | current | Privacy-safe CEFR, OneStop-style ordinal, Lexile-like, provider drift, and vocabulary penalty calibration workflow. |
| [Educator tools and reading activities](./educator-tools.md) | design | current | Documents educator reader tools: Educator tools bar, View as student preview, Apply to your lesson scaffolds with deterministic fallback, oral fluency passages and printable rubric, quick assign, and assignment pre-reading polls and Checks for Understanding with privacy, RBAC, APIs, and audit. |
| [Engagement analytics, streaks, heatmaps, and reading speed](./engagement-analytics.md) | design | current | Documents learner-owned engagement read models derived from progress, daily activity, streaks, heatmaps, and reading speed. Captures current local-day rules, forward-only progress, shield policy, WPM calculations, gamification summary, and privacy boundaries. |
| [Gamification summary, streaks, and dashboard widgets](./gamification.md) | design | current | Learning/Engagement gamification read model: GET /api/gamification/summary combines streaks, daily-goal progress, last-seven-day activity, shields, and due flashcards from DailyActivity and SRS without duplicating private content. |
| [Learning, mastery and learner analytics](./learning-and-mastery.md) | design | current | Documents durable learning mastery models, learner analytics, adaptive leveling, and their source tables. Captures current formulas, side-effect write behavior, privacy-safe coach memory, SRS integration, and analytics page rules. |
| [Reading placement](./placement.md) | design | current | Documents the Learning-owned placement attempt workflow, passage route, welcome/settings UI affordances, and PlacementResult schema. Placement is a lightweight, deterministic, privacy-preserving cold-start/retake flow that stores only counts, controlled levels, and a recommendation. |
| [Profile preferences and onboarding](./profile-preferences.md) | design | current | Documents learner profile preferences, onboarding boundary, goal paths, level history, and personalization consumers. Captures current validation, profile route behavior, onboarding completion, placement relationship, and privacy rules. |
| [Curated reading series](./reading-series.md) | design | current | Documents ReadingSeries and SeriesEnrollment data model, learner series browser/API, and Today soft-candidate integration. Captures current public-series listing, idempotent enroll/unenroll commands, access-checked article resolution, progress advancement, and remaining gaps. |
| [Reading skills and maturity bands](./reading-skills.md) | design | current | Documents the reading-skill taxonomy on quiz questions, answer rationales, per-question attempt answers, reading-skill learner evidence, content maturity bands, Browse skill/maturity facets, and the classroom Reading skills matrix with CSV export. |
| [Review Assets](./review-assets.md) | design | current | Documents review-asset conversion from highlights/notes into optional SRS study cards and Today reflection signals. Captures current low-pressure review-card creation, Progress/Study counts, privacy constraints, and additive Today reflection behavior. |
| [Study plan and study mode](./study-plan.md) | design | current | Documents the Learning-owned study diagnostics engine, persisted weekly study-plan snapshots, SRS/cloze study routes, and Reader practice signals that feed weekly recommendations. Study mode combines stable weekly plan items, history, due flashcards, saved-word filters, and cloze fallback behavior. |
| [Teacher workflows and assignments](./teacher-workflows.md) | design | current | Teacher and student assignment workflows on Access-owned organizations, classrooms, memberships, and assignments: classroom and roster management, assigning readable articles, completion tracking, and classroom analytics boundaries. |
| [Text Sets](./text-sets.md) | design | current | Documents teacher-curated Text Sets: org-scoped ownership, PRIVATE/ORG sharing with cross-organization isolation, editing/duplication rules, assignment to classrooms as linked unit assignments, unit progress rollups, the student unit view, APIs, and audit. |
| [Today Session](./today-session.md) | design | current | Documents the durable per-learner local-day TodaySession workflow anchor and its plan/completion/offline boundaries. Captures current daily generation, primary/backup article ids, comprehension checks, saved-word targets, reflection, local-date semantics, and privacy constraints. |
| [Write prompts](./write-prompts.md) | design | current | Documents Write Prompt constructed responses: prompt resolution (assignment, article default, generic), the reader Write panel with draft autosave, the DRAFT/SUBMITTED/NEEDS_REVISION/GRADED flow, rubric grading and return-for-revision by teachers, privacy of independent writing, APIs, and audit. |

<!-- END GENERATED: docs-index -->
