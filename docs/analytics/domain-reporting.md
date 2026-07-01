---
title: "Domain reporting and read models"
category: "Analytics"
architecture: "Documents domain-owned reporting read models and their separation from the product analytics event stream."
design: "Captures current aggregation boundaries, visibility rules, privacy limits, and report ownership."
plan: "Update when domain reporting queries, read models, admin dashboards, or privacy constraints change."
updated: "2026-07-01"
rename: "none"
---

# Domain reporting and read models

ReadWise distinguishes between the **product analytics event stream** (an
append-only log of product-significant moments owned by Analytics — see
[`product-analytics.md`](./product-analytics.md)) and **domain reporting read
models** (aggregations computed on demand from source-domain tables, each owned
by its domain).

This document describes the domain read models that are surfaced by dashboards
and the privacy/retention rules that govern them.

## Why the distinction matters

The Analytics event stream is a denormalized, metadata-only log of funnel and
feature-usage events. Domain read models are different in nature:

- They are **computed on read** from the authoritative source-domain tables
  (`ReadingProgress`, `SavedWord`, `QuizAttempt`, `AssignmentCompletion`,
  `Article`, `AiInvocation`, etc.). There is no separate event to
  write or retain.
- **Source-domain ownership**: deleting a learner's rows in `ReadingProgress`
  automatically removes them from classroom completion aggregates because those
  rows cascade. Domain read models respect the domain's own retention/cascade
  rules.
- **Scope and access control** are enforced per domain, not by the Analytics
  subsystem.

## Learner analytics

**Module:** `src/lib/analytics/learner.ts`  
**Owned by:** Learning  
**Data sources:** `ReadingProgress`, `SavedWord`, `QuizAttempt`, engagement/streak tables

`getLearnerAnalytics(userId)` returns a single user's own activity summary:

| Metric | Source |
| --- | --- |
| Total completed / in-progress articles | `ReadingProgress` grouped by `completed` |
| Completion trend (last 12 weeks) | `ReadingProgress` where `completedAt >= 12 weeks ago` |
| Vocabulary saved (total + weekly trend) | `SavedWord` |
| Quiz attempt count and average score | `QuizAttempt` aggregate |
| Quiz score trend (last 10 attempts) | `QuizAttempt` ordered by `completedAt` |
| Completed articles by difficulty (CEFR) | `ReadingProgress` joined `Article.difficulty` |
| Current and longest streak | engagement / streak tables |

**Scope:** always scoped to a single `userId` — no cross-user data is returned.

**Privacy:** no article text, no word text, no quiz content — only counts,
rates, and timestamps. Data is deleted automatically when the user's
`ReadingProgress` / `SavedWord` / `QuizAttempt` rows cascade on account
deletion.

## Classroom / tenant analytics

**Module:** `src/lib/analytics/tenant.ts`  
**Owned by:** Access & Tenancy  
**Data sources:** `AssignmentCompletion`, classroom/org membership, `Assignment`

`getClassroomAnalytics(classroomId, role)` aggregates assignment completion data
for a classroom and applies access-control redaction based on the viewer's role:

| Role | Scope | Individual learner rows |
| --- | --- | --- |
| `systemAdmin` | Global | Yes |
| `teacher` | Own classroom | Yes (pedagogical) |
| `orgAdmin` | Own org | No — aggregates only |
| `learner` | Own data | Own rows only |

The aggregation functions (`aggregateClassroom`, `redactIndividualData`,
`applyAnalyticsAccess`) are pure — they take loaded rows and return numbers,
making them testable without a database.

**Privacy:** org admins never receive named per-learner rows — individual data
is redacted (`redacted: true`). Classroom data is computed from
`AssignmentCompletion`; when a learner's rows are erased (cascade on account
deletion), they are automatically excluded from future aggregates.

## Admin content and member statistics

**Module:** `src/lib/analytics/admin.ts`  
**Owned by:** Article Library / Admin  
**Data sources:** `Article`, `User`, `ReadingProgress`, `SavedWord`, `Tag`

`getAdminAnalytics()` provides a library-level summary for the admin dashboard:

| Metric | Source |
| --- | --- |
| Articles by category | `Article.groupBy(category)` |
| Articles by difficulty level | `Article.groupBy(difficulty)` |
| Total members | `User.count()` |
| Active readers (distinct users with progress) | `COUNT(DISTINCT userId)` from `ReadingProgress` |
| Reads tracked / completed | `ReadingProgress` counts |
| Words saved | `SavedWord.count()` |
| Top public tags | `Tag` ordered by article count |

**Scope:** platform-wide — no per-user rows are returned. All metrics are
aggregates.

**Privacy:** no individual user data, no text content. Counts and distributions
only. Data reflects the current state of the library on each call; there is no
separate retention window — row deletion (article or user) is reflected
immediately.

## AI usage ledger

**Module:** `src/lib/ai-usage-summary.ts`  
**Owned by:** AI  
**Data source:** `AiInvocation` table

The `AiInvocation` table is the ledger for AI cost, volume, latency, and
provider fallback data. It is owned by the AI subsystem and is not part of the
Analytics event stream.

The `/admin/analytics/ai` dashboard (gated `analytics.view`) renders AI usage
metrics from this ledger. The dashboard composes the AI read model; Analytics
does not own the `AiInvocation` contract, schema, or retention rules.

**Privacy:** `AiInvocation` rows must never contain prompt text, article
content, or user-generated input. The AI subsystem is responsible for enforcing
that invariant at the ledger write site.

## Job / content-processing health

**Module:** `src/lib/processing/state.ts`  
**Owned by:** Operations  
**Data source:** `ArticleProcessingStep` and the job queue

Content-processing health (step timelines, failure rates, queue depth) is owned
by Operations. The `/admin/analytics/ai` page also renders content-ops health
using this data alongside AI usage.

Analytics does not own the job queue schema, retry state machine, or
processing-step retention rules. Operations is responsible for those boundaries.

## Privacy and retention summary

| Read model | Retention mechanism | PII / content stored |
| --- | --- | --- |
| Learner analytics | Automatic cascade on account deletion | No — counts and timestamps only |
| Classroom analytics | Automatic cascade on account deletion | No — aggregates and percentages only; individual rows redacted by role |
| Admin statistics | Reflects current DB state on each call | No — platform-wide counts only |
| AI usage ledger | Owned by AI subsystem | Must not contain prompts or user content |
| Job health | Owned by Operations | No user data |

For the product analytics event stream retention window, per-user erasure, and
sanitization rules see [`product-analytics.md`](./product-analytics.md).
