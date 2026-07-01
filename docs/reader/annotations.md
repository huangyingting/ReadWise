---
title: "Reader highlights and notes"
category: "Reader"
architecture: "Documents Reader annotation ownership, highlight anchors, notes, APIs, and offline conflict boundaries."
design: "Captures current anchor model, note editing, color rules, revalidation, merge behavior, and privacy constraints."
plan: "Update when Highlight schema, annotation APIs/UI, offline conflict rules, export/deletion, or anchor behavior change."
updated: "2026-07-01"
rename: "none"
---

# Reader highlights and notes

ReadWise lets learners highlight article text and attach notes. The system is
user-scoped, offline-aware, and resilient to small article-text changes.

## Data model

`Highlight` rows belong to a `(userId, articleId)` pair and cascade with both the
user and article.

| Field | Purpose |
| --- | --- |
| `quote` | Exact selected text at creation time. |
| `startOffset`, `endOffset` | Character offsets into the article's rendered plain text (`textContent`). |
| `prefix`, `suffix` | Context around the quote, used for re-anchoring. |
| `note` | Optional learner note. |
| `color` | Optional label: `yellow`, `green`, `blue`, `pink`. |
| `createdAt`, `updatedAt` | Sorting and offline conflict detection. |

Unique key:

```text
(userId, articleId, startOffset, endOffset)
```

This makes duplicate creates idempotent for the same selection.

## Anchor strategy

Anchors are immutable after creation. Only `note` and `color` can be edited.
This prevents a client from changing the selected text silently and keeps
annotation history stable.

Validation in `src/lib/annotations/commands.ts` enforces:

| Constraint | Value |
| --- | --- |
| Quote required | non-empty after trimming |
| Max quote length | 10,000 characters |
| Offset type | integer |
| Offset bounds | `startOffset >= 0`, `endOffset <= 10,000,000`, `startOffset < endOffset` |
| Prefix/suffix max | 256 characters each |
| Note max | 2,000 characters |
| Colors | `yellow`, `green`, `blue`, `pink`, or null |

## Revalidation and stale anchors

When article plain text changes, stored offsets may no longer point to the same
quote. `annotateHighlightAnchors(rows, plainText)` runs each highlight through
`revalidateAnchor(...)` from `src/lib/offline-conflict.ts`.

Possible statuses:

| Status | Meaning | User impact |
| --- | --- | --- |
| `valid` | The stored text slice still matches the quote, with whitespace tolerance. | Render normally. |
| `moved` | The quote exists elsewhere, possibly with matching prefix/suffix context. | Mark as stale and include suggested offsets. |
| `missing` | The quote can no longer be found. | Mark as stale; never silently drop it. |

The revalidation algorithm checks in this order:

1. Exact or whitespace-normalized match at stored offsets.
2. Full `prefix + quote + suffix` context match.
3. Plain quote match anywhere else.
4. Whitespace-flexible token match.
5. Missing.

## Notes and offline conflict handling

Offline note edits use `baseUpdatedAt` to detect whether the server note changed
since the client started editing.

Rules:

- If the stored note did not change since the client's base version, the client
  edit wins.
- If client and server notes are identical, there is no conflict.
- If both changed, the text is merged rather than overwritten.

The conflict separator is:

```text
--- ⚠ also edited on another device ---
```

This preserves both versions so the learner can clean up the merged note later.
Progress and saved-word conflict policies are documented in
[`offline-sync.md`](./offline-sync.md).

## API and library operations

Library functions in `src/lib/annotations/`:

| Function | Behavior |
| --- | --- |
| `listHighlights(userId, articleId)` | Lists highlights for one user/article by `startOffset`. |
| `createHighlight(userId, articleId, input)` | Validates anchor and upserts by unique key. Duplicate creates return existing row unchanged. |
| `updateHighlight(id, userId, input)` | Updates note/color only; ownership checked by `id + userId`. |
| `deleteHighlight(id, userId)` | Deletes only if owned by user. |
| `listAllUserHighlights(userId)` | Cross-article notes page data, capped at 1000 rows. |
| `getHighlightCounts(userId, articleIds)` | Batch count for listing badges. |
| `annotateHighlightAnchors(rows, plainText)` | Adds stale/reanchor metadata for current article text. |

API routes:

- `GET /api/reader/[id]/highlights`
- `POST /api/reader/[id]/highlights`
- `PATCH /api/highlights/[id]`
- `DELETE /api/highlights/[id]`

All routes are authenticated and user-scoped. User ids come from the session,
never from the request body.

## Reader UI

Main components:

| Component | Role |
| --- | --- |
| `ReaderHighlightsProvider` | Client context for highlights in the reader. |
| `SelectionToolbar` | Selection actions such as highlight/note/translate. |
| `ReaderNotesPanel` | In-reader list/editor surface. |
| `HighlightEditPopover` | Inline note/color editing. |
| `InlineNoteEditor` | Note text input with conflict-aware updates. |
| `/notes` page | Cross-article notes and highlights. |

## Privacy and export

Highlights and notes are part of user-owned data and are included in
`exportUserData(...)` (`GET /api/account/export`) with article ids, quote,
offsets, context, note, color, and timestamps. User deletion cascades highlight
rows with the user.
