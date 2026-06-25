# Platform Primitives — `src/lib/primitives/`

This directory governs small shared utility modules as **platform primitives**
(REF-085). It provides:

1. **Classification** — every primitive declares its boundary tier.
2. **Purpose-based barrels** — group imports by intent rather than hunting for
   the right file.
3. **Contribution guidelines** — rules for adding, placing, and testing new
   helpers.

---

## Boundary tiers

| Tier | Import barrel | Rule |
|------|---------------|------|
| **pure** | `@/lib/primitives/pure` | No DOM, no `node:*`, no server-only APIs. Runs in browser, Node, and edge runtimes. |
| **client** | `@/lib/primitives/client` | May use DOM / Web APIs and React hooks. Must NOT import server-only modules (`server-only`, `node:*`, Prisma, etc.). |
| **server** | `@/lib/primitives/server` | May use Node.js APIs, Prisma, `server-only`. Must NOT be imported by client components. |

A **security-sensitive** helper may live in any tier; its module header MUST
note the security concern and the tier ensures it cannot cross the wrong
boundary.

---

## Classified primitives

### Pure (universal)

| Module | Exports | Notes |
|--------|---------|-------|
| `@/lib/aggregation` | `percentage`, `wholePercentage`, `averageRounded`, `isoWeek`, `lastNWeeks`, `fillWeekBuckets` | Analytics aggregation math |
| `@/lib/backoff` | `jitteredExponentialBackoff` | Retry/backoff with injectable randomness |
| `@/lib/safe-json` | `safeJsonStringify` | **Security-sensitive** — XSS-safe JSON for `<script>` injection |
| `@/lib/format-relative` | `formatRelative` | ISO → relative time string |
| `@/lib/list-name-validation` | `validateListName`, `LIST_NAME_MAX_LENGTH` | Reading-list name validation |

### Client-only

| Module | Exports | Notes |
|--------|---------|-------|
| `@/lib/cn` | `cn`, `focusRing` | Tailwind class composition and focus-ring token |
| `@/lib/storage-keys` | `STORAGE_KEYS`, `lsGet`, `lsSet`, `lsRemove`, `ssGet`, `ssSet`, `ssRemove` | Browser storage key registry and safe helpers |
| `@/lib/focus-trap` | `getTabbable`, `useFocusTrap` | **Security-sensitive** — focus containment for modals |
| `@/lib/use-roving-tabindex` | `computeRovingIndex`, `useRovingTabindex` | Arrow-key navigation within control groups |

### Server-only

| Module | Exports | Notes |
|--------|---------|-------|
| `@/lib/sanitize` | `sanitizeArticleHtml` | **Security-sensitive** — HTML sanitization before render |

---

## Contribution guidelines

### When to add a new primitive

Add a primitive here when the helper is:

- **Genuinely reused** — imported from two or more unrelated call sites.
- **Self-contained** — no business-domain concepts leak in (no article IDs, user
  IDs, Prisma models as return types).
- **Stable** — the API is unlikely to change for domain reasons.

If it is only used within a single feature, keep it **feature-local** (same
directory as the feature).

### Placing a new primitive

1. Choose the correct boundary tier (pure → client → server, in preference
   order — use the lowest tier that satisfies your needs).
2. Create the module in `src/lib/` with a `@boundary: <tier>` JSDoc tag in the
   file header.
3. Add it to the appropriate barrel in `src/lib/primitives/`.
4. Write a focused test in `tests/` covering the happy path plus edge cases.
5. Add a row to the classification table in this README.

### Do NOT add here

- Domain services (article processing, AI orchestration, SRS logic).
- Any module that imports Prisma models in its public API.
- Wrappers that are purely compatibility shims (keep those in the module they
  wrap until the old path is deleted).

---

## Stability contract

Existing canonical import paths (e.g. `@/lib/aggregation`, `@/lib/cn`) are the
**stable API**. The barrels in this directory are convenience re-exports and
must stay in sync with the canonical modules. Never delete a canonical export
without a deprecation cycle.
