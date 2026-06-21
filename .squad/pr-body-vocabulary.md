## Vocabulary system: save-from-popover, in-app journal, flashcard context, frequency badges

This PR implements four vocabulary-related features requested by the ReadWise team, improving the end-to-end learner vocabulary workflow.

---

### Closes #107 — Save word from dictionary popover (quick win)

**What changed:**
- `WordLookup.tsx`: Added a **Save word / ✓ Saved** toggle button in the dictionary popover footer
- Optimistic save with a loading spinner (`…`) during in-flight request
- Extracts the surrounding article sentence as `contextSentence` at save-time using a `extractContextSentence()` helper (sentence boundary split on `.?!`)
- Populates `explanation` and `example` from the live dictionary result already in state
- Session-level saved-state cache (`savedCacheRef`) avoids redundant API calls on popover re-open
- Reuses `POST /api/vocabulary/save` and `POST /api/vocabulary/unsave` — no new backend code
- Error feedback inline in the footer (reverts optimistic state on failure)

---

### Closes #115 — In-app vocabulary journal at `/study/words`

**What changed:**
- New page: `src/app/(app)/study/words/page.tsx` (gated via `requireOnboardedSession`)
- New API: `GET /api/study/words` — paginated, searchable, filterable saved words with article title resolution
- New API: `POST /api/vocabulary/unsave-batch` — removes an array of words in one request (`prisma.savedWord.deleteMany`)
- New lib helper: `getFilteredSavedWords(userId, {search, articleId, filter, page})` in `src/lib/vocabulary.ts` — LIKE search on word/explanation, SRS filter (all/due/new), pagination (20/page)
- New component: `src/components/VocabularyJournal.tsx` (client) — search input, SRS filter, article-source filter dropdown, multi-select checkboxes, bulk-remove button, paginated table (word/definition/article/date saved/SRS status), article linkback via `Link`
- Study page shell now shows a **Manage words** link to `/study/words`
- Empty states for no saved words and no search matches

---

### Closes #119 — Flashcard context sentence + article linkback

**What changed:**
- Schema: added `contextSentence String?` to `SavedWord` model
- Migration: `prisma/migrations/20260621020000_add_saved_word_context_sentence/migration.sql`
- `save/route.ts`: accepts optional `contextSentence` field
- `vocabulary.ts`: `saveWord()` and `SavedWordView` now include `contextSentence`
- `flashcards.ts`: `FlashcardView` and `getDueFlashcards` now include `contextSentence` and `articleId`
- `FlashcardReview.tsx`: card back now shows **"Original context"** block with muted italic sentence when `contextSentence` is available, falls back to AI `example` when null
- **"Go to article ↗"** link on card back navigates to `/reader/[articleId]` (shown only when `articleId` exists)
- Cloze route also forwards new fields to the client
- Pre-migration words show AI example gracefully (null contextSentence)

---

### Closes #123 — Word frequency tier badge

**What changed:**
- `src/data/word-frequency-data.ts`: static TypeScript map of ~1300 words with tiers `top1k` | `top5k` | `academic` (derived from COCA / BNC / wordfreq public-domain data; ~30KB)
- `src/data/word-frequency.json`: source JSON (kept for reference / tooling)
- `src/lib/frequency.ts`: pure `frequencyTier(raw)` function — normalizes input via `normalizeCandidates()` from `dictionary.ts` so inflected forms resolve automatically; no server-only imports (safe in client components)
- `WordLookup.tsx`: frequency badge in popover header (alongside word name)
- `ArticleVocabulary.tsx`: frequency badge next to each AI-extracted word
- Badges use existing `Badge` variants: `success` (Top 1K), `primary` (Top 5K), `warning` (Academic); no badge when word is not in the list
- `tests/frequency.test.ts`: 8 unit tests covering tier lookups, case insensitivity, inflection normalization, null cases

---

### Verification

```
npm run typecheck  → 0 errors
npm run lint       → 0 warnings
npm test           → 493 pass, 0 fail (including 8 new frequency tests)
npm run build      → ✓ Compiled successfully
```

All server-only modules (`@/lib/ai`, `@/lib/logger`, `@/lib/translation`, `@/lib/difficulty`) remain absent from client bundles.
