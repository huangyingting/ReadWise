---
type: "design"
status: "current"
last_updated: "2026-07-01"
description: "Documents user content-reporting, ContentReport schema, and admin moderation queue boundaries. Captures current report reasons/statuses, reader/admin APIs, deduplication, audit actions, and privacy rules."
---

# Content Reporting

> **Epic #734 / Issue #738** — User content reporting and admin moderation queue.

## Overview

ReadWise provides a structured workflow for users to flag problematic articles.
Reports are routed to an admin moderation queue where they can be reviewed,
resolved, or dismissed. No raw article text, selected text, user notes, or PII
is stored in report metadata — only article IDs and structured category metadata.

---

## Report Categories (Reasons)

| Reason key             | Label                    | Use case                                                      |
|------------------------|--------------------------|---------------------------------------------------------------|
| `rights_copyright`     | Rights / Copyright       | Content appears to infringe copyright or licensing terms      |
| `unsafe_content`       | Unsafe Content           | Content is harmful, inappropriate, or violates content policy |
| `extraction_broken`    | Extraction Broken        | Article extraction/scraping failed or content is garbled      |
| `wrong_level`          | Wrong Level              | CEFR level is incorrectly assigned                            |
| `inaccurate_ai`        | Inaccurate AI Enrichment | AI-generated enrichment (vocabulary, quiz, etc.) is wrong     |
| `classroom_concern`    | Classroom Concern        | Content is unsuitable for classroom/educational use           |
| `other`                | Other                    | Anything not covered above                                    |

---

## Report Lifecycle (Statuses)

```
OPEN → REVIEWING → RESOLVED
                 ↘ DISMISSED
```

| Status      | Meaning                                          |
|-------------|--------------------------------------------------|
| `open`      | Newly submitted, awaiting admin attention         |
| `reviewing` | Admin has started reviewing (future: set via UI)  |
| `resolved`  | Admin resolved — action taken (e.g. takedown)     |
| `dismissed` | Admin dismissed — no action needed                |

---

## Actors

| Actor     | Action                                     | Capability required          |
|-----------|--------------------------------------------|------------------------------|
| Reader    | Submit a report via `POST /api/reports`    | Authenticated session        |
| Admin     | View moderation queue at `/admin/reports`  | `content.moderate`           |
| Admin     | Resolve / dismiss via API                  | `content.moderate` (audited) |

---

## API

### `POST /api/reports`

Submit a content report. Authenticated users only.

**Body:**
```json
{
  "articleId": "clxxxxxxx",
  "reason": "unsafe_content",
  "note": "Optional short note (max 500 chars)"
}
```

**Responses:**
- `201 Created` — `{ ok: true, reportId: "..." }`
- `400 Bad Request` — validation error
- `404 Not Found` — article does not exist
- `429 Too Many Requests` — duplicate report within 1-hour window

**Privacy:** only `articleId` + `reason` + optional `note` are stored.
Raw article content, selected text, and user highlights are never stored.

### `GET /api/admin/reports`

List reports in the moderation queue. Requires `content.moderate`.

**Query params:**
- `status` — `open` (default), `reviewing`, `resolved`, `dismissed`
- `page` — page number (default `1`)
- `pageSize` — items per page (default `25`, max `100`)

### `PATCH /api/admin/reports/:id`

Update a report status (resolve or dismiss). Requires `content.moderate`. Audited.

**Body:**
```json
{ "status": "resolved" }
```

---

## Privacy & Data Rules

- `reporterUserId` is stored as a plain string (not a FK) so reports survive account deletion.
- `resolvedBy` is likewise a plain string.
- `note` is capped at 500 characters and must not contain raw article text, selected text, or personally identifying information. The API does not enforce content of the note beyond length — editors are responsible.
- No article excerpts, vocabulary items, quiz content, or highlight text are stored in report metadata.
- Reports cascade-delete when the article is deleted (no orphan reports).

---

## Deduplication

A user cannot submit the same `(reporterUserId, articleId, reason)` combination more than once within a 1-hour sliding window. Duplicate attempts receive HTTP 429.

---

## Admin Moderation Queue

Available at `/admin/reports` (requires `content.moderate`). Shows open reports by default with article title, reason, note, and status filter. Admins can:

1. **Resolve** — mark as actioned (optionally follow up with takedown via `/admin/articles/:id/takedown`)
2. **Dismiss** — mark as not actionable

All admin actions are recorded in the `AuditLog` under actions:
- `admin.report.resolve`
- `admin.report.dismiss`

User report submissions are audited under `user.content_report`.

---

## Connection to Existing Governance Workflows

- Content **takedown** after resolving a report → see `src/lib/article-library/takedown.ts` and `POST /api/admin/articles/:id/takedown`.
- Content **quality review** → see `src/lib/article-library/review.ts` and `POST /api/admin/articles/:id/review`.
- **Audit log** → see `src/lib/security/audit.ts`.

---

## Follow-up / Deferred

- **`REVIEWING` status transition** — currently set only manually via direct DB or future API; no admin UI button yet.
- **Email/in-app notifications** to admins on new report.
- **Reporter feedback** — notify the reporting user when their report is resolved/dismissed.
- **Rate limiting** beyond dedup — per-user daily cap on total reports.
- **Bulk actions** — resolve/dismiss multiple reports at once.
- **Report on non-article content** — currently only articles are supported.
