# Bookmarks and reading lists

Bookmarks are implemented as membership in a user's default reading list named
`Saved`. Custom reading lists use the same `ReadingList` / `ReadingListItem`
model pair.

## Code map

| Area | Code | Purpose |
| --- | --- | --- |
| Commands | `src/lib/article-library/collections/commands.ts` | Create/rename/delete lists, add/remove items, toggle default bookmark. |
| Default list policy | `src/lib/article-library/collections/default-list-policy.ts` | Lazy creation and non-deletable `Saved` list. |
| Read models | `src/lib/article-library/collections/read-models.ts` | User list summaries and list detail with articles. |
| Membership read model | `src/lib/article-library/collections/membership.ts` | Which user lists contain a visible article. |
| Schemas | `src/lib/article-library/collections/schemas.ts` | Route payload validation. |
| API routes | `src/app/api/lists/**`, `src/app/api/bookmarks/**` | Authenticated user-scoped list/bookmark routes. |

## Data model

| Model | Key rules |
| --- | --- |
| `ReadingList` | Belongs to one user; `@@unique([userId, name])`; cascades with user. |
| `ReadingListItem` | Joins a list to an article; `@@unique([listId, articleId])`; cascades with list and article. |

`isDefault` marks the bookmark list. The default list is created lazily by
`getOrCreateDefaultList(userId)` and cannot be deleted.

## Authorization and IDOR rules

All commands take both `listId` and `userId` and query by both. A list that does
not exist or belongs to a different user returns a 404-style domain result. This
prevents list ids from becoming an ownership oracle.

Adding/toggling an article also checks `getReadableArticleById(articleId,
{ userId, role })`. Drafts, unpublished articles, and another user's private
imports are indistinguishable from missing articles.

User ids must always come from the session, never the request body.

## Mutation semantics

| Command | Semantics |
| --- | --- |
| `createList` | Creates a named non-default list. |
| `renameList` | Ownership-checked rename. |
| `deleteList` | Ownership-checked; refuses the default list with conflict. |
| `addToList` | Idempotent upsert after list ownership and article readability checks. |
| `removeFromList` | Idempotent delete after list ownership check. |
| `toggleBookmark` | Toggles membership in the default `Saved` list after article readability check. |

Duplicate adds and missing removes are successful no-ops. This keeps retries and
offline replays safe.

## Read models

- `getUserLists(userId)` returns default list first, then oldest-first, with item
  counts.
- `getListWithArticles(listId, userId)` returns null unless the list is owned by
  the user.
- `getBookmarkedArticleIds(userId, articleIds)` batches listing badges without
  N+1 queries.
- `getArticleListMembership(userId, articleId, role?)` returns null when the
  article is not readable; otherwise it annotates every user list with
  `hasArticle`.

## Privacy, export, and deletion

Reading lists and items are user-owned data. They are included in account export
by name/default flag and article ids, and cascade on user deletion. They must not
be written into product analytics or logs except as aggregate counts/metadata.

## Tests

Relevant tests include `tests/bookmarks.test.ts`, `tests/bookmarks-routes.test.ts`,
list route tests, article-access regression tests, and account export/deletion
tests.
