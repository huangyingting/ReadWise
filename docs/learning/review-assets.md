---
title: "Review Assets"
category: "Learning"
architecture: "Documents review-asset conversion from highlights/notes into optional SRS study cards and Today reflection signals."
design: "Captures current low-pressure review-card creation, Progress/Study counts, privacy constraints, and additive Today reflection behavior."
plan: "Update when review-card routes, highlight/note integration, SRS conversion, Today reflection, or export/deletion behavior change."
updated: "2026-07-01"
rename: "none"
---

# Review Assets

Review assets turn a learner's **existing** highlights and notes into optional,
low-pressure review material — without turning extensive reading into heavy
coursework (#812, Today v1.1).

- **Owning subsystem:** Learning (`src/lib/learning/review-assets.ts`)
- **Reuses:** the flashcard/SRS store (`SavedWord` + SM-2), the annotation/note
  domain (`Highlight.note`), and the Today view model.
- **Related issues:** #782, #787, #812
- **Schema:** none — no new model or column was introduced.

## Capabilities

### 1. Highlight/note → review card

`convertHighlightToReviewCard(userId, highlightId)` promotes one of the learner's
own highlights into a spaced-repetition review card by **reusing the existing
flashcard store** (`SavedWord`): the highlighted passage becomes the card front,
the user's note becomes the back, and the full passage is kept as context. A
fresh card has `dueAt = null` (immediately due) and flows through the normal SM-2
review loop.

- **Optional / skippable:** nothing converts a highlight unless the learner
  explicitly asks.
- **Owner-scoped (no IDOR):** a highlight owned by another user, or a missing id,
  returns `null`.
- **Idempotent:** converting the same passage again returns the existing card and
  never resets its SRS schedule.
- **Route:** `POST /api/highlights/{id}/review-card` → `{ cardId, dueAt, created }`.

### 2. Aggregate, content-free counts (Progress/Study)

`getReviewAssetSummary(userId)` returns **numbers only** — total highlighted
passages, how many carry a note, how many were created this week, and how many
distinct articles were highlighted (a "themes" proxy). No quote or note text is
ever loaded or returned, so it is safe to surface on the Study page and to feed
aggregate-count analytics. Surfaced in the Study page "Highlights & notes"
section.

### 3. Optional Today reflection bonus

`recordTodayReflection({ userId, highlightId, sentence })` stores an optional
one-sentence "after reading" reflection in the **existing note domain** — the
`note` of one of the learner's own highlights (via the ownership-checked
`updateHighlight` command).

- It **never** touches the `TodaySession` row, its metadata, or analytics, so it
  cannot block or alter required Today completion. The completion tier engine
  does not model reflections at all.
- The Today view model exposes a purely additive `reflectionBonus`
  (`available` once reading is complete, plus display `label`) that never feeds
  steps, progress, the CTA, the completion tier, or the session status.
- **Route:** `POST /api/today/reflection` → `{ ok, highlightId }` (gated by the
  Today Session feature flag, mirroring the other `/api/today` routes).

## Privacy / safety

Raw selected text (a highlight's quote) and private notes live **only** in the
user-owned highlight/note/flashcard domains where the learner already stores
them. This subsystem never writes selected text, note text, prompts, or
definitions into analytics events or `TodaySession` metadata — only ids,
schedules, timestamps, and aggregate counts cross those boundaries.
