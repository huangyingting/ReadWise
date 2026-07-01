---
title: "Study plan and study mode"
category: "Learning"
architecture: "Documents the Learning-owned study diagnostics engine, SRS/cloze study routes, and Reader practice signals that feed weekly recommendations."
design: "The study plan is computed on demand from current learner data, not persisted; Study mode combines plan items, due flashcards, saved-word filters, and cloze fallback behavior."
plan: "Keep aligned with src/lib/learning/study-plan*, flashcards/cloze routes, /study UI, and mastery signal changes."
updated: "2026-07-01"
rename: "none"
---

# Study plan and study mode

The Study page combines a dynamic weekly study plan with saved-word review
surfaces. It is grounded in recorded learner activity and always returns a
usable starter plan when evidence is sparse.

## Code map

| Area | Code | Purpose |
| --- | --- | --- |
| Study page | `src/app/(app)/study/page.tsx`, `src/app/(app)/study/words/page.tsx` | Learner UI for weekly plan, flashcards, cloze, and saved-word browsing. |
| Plan UI | `src/components/StudyPlanSection.tsx` | Renders diagnosed weak areas and plan items. |
| Plan engine | `src/lib/learning/study-plan-engine.ts`, `study-plan-types.ts` | Diagnostics gathering, weak-area ranking, weekly plan synthesis. |
| SRS | `src/lib/learning/flashcards.ts`, `src/lib/learning/srs.ts` | Due-card ordering and SM-2 schedule updates. |
| Cloze | `src/lib/learning/cloze.ts`, `src/app/api/study/cloze/route.ts` | Fill-in-the-blank cards built from due saved-word examples. |
| Saved words | `src/app/api/study/words/route.ts`, `src/lib/lexical/saved-words.ts` | Paginated/searchable saved-word read model with article-title linkback. |
| Flashcard APIs | `GET /api/study/flashcards`, `POST /api/study/flashcards/grade` | Due review cards and SM-2 grade writes. |
| Related signals | `WordMastery`, `ArticleMastery`, `SkillMastery`, `LearnerCoachMemory`, `QuizAttempt`, `PronunciationAttempt` | Source data for diagnosis and plan ranking. |

## Current architecture

`generateStudyPlan(userId)` computes the plan at request time. There is no
persisted weekly-plan table and no scheduled generation job. This keeps the plan
fresh after every quiz, flashcard grade, pronunciation attempt, reading progress
write, or coach-memory update.

The engine has three layers:

1. `gatherStudyDiagnostics` reads current activity and aggregate state.
2. `diagnoseWeakAreas` turns diagnostics into ordered weak areas.
3. `buildWeeklyPlan` maps weak areas to concrete plan items and always appends a
   level-appropriate reading recommendation when available.

## Diagnostic inputs

| Signal | Source | How it affects the plan |
| --- | --- | --- |
| Vocabulary weakness | `WordMastery.familiarity`, due `SavedWord` count, vocabulary `SkillMastery` | Adds review/new-word plan items when weak words or due cards exist. |
| Comprehension weakness | `ArticleMastery.comprehensionScore`, quiz average, comprehension `SkillMastery` | Adds quiz/remediation/read-with-care recommendations. |
| Reading level pressure | adaptive level recommendation from `src/lib/leveling` | Suggests easier level-appropriate reading when recent evidence indicates overload. |
| Pronunciation weakness | average `PronunciationAttempt.pronScore`, pronunciation `SkillMastery` | Adds pronunciation practice recommendations. |
| Listening/grammar weakness | `SkillMastery` and coach-memory confidence | Adds focused practice recommendations when evidenced confidence is low. |
| Coach memory | `LearnerCoachMemory` via `coachMemorySkillConfidences` | Recency-aware aggregate weakness signal; falls back to `SkillMastery` when empty. |
| Reading recommendation | `listScoredPicksPage(userId, { limit: 1 })` | Adds a concrete next article when personalized Picks has a candidate. |

Weak areas are included only when there is supporting evidence. The engine does
not invent generic weaknesses for cold-start learners.

## Weak-area thresholds

| Area | Current threshold |
| --- | --- |
| Skill confidence | `< 0.5` when the skill has evidence. |
| Quiz average | `< 70%` contributes to comprehension weakness. |
| Pronunciation score | `< 70` contributes to pronunciation weakness. |
| Word familiarity | below `WEAK_WORD_FAMILIARITY` from `study-plan-types.ts`. |
| Article comprehension | below `LOW_COMPREHENSION` from `study-plan-types.ts`. |

The result is sorted by severity and capped to a focused set of plan items.

## Starter plan

When there are no weak areas, the Study page still returns a starter plan:

- review due flashcards when any are due;
- read a level-appropriate article;
- take a comprehension quiz after reading.

This starter path is intentional for new learners, newly imported accounts, and
users who cleared coach memory.

## Flashcard review

`GET /api/study/flashcards` returns due cards and the total due count. Cards with
`dueAt = null` appear before past-due cards so newly saved words are reviewed at
least once.

`POST /api/study/flashcards/grade` accepts:

- `savedWordId`;
- grade: `again`, `hard`, `good`, or `easy`.

The route updates the SM-2 schedule, records a product analytics study-review
event with grade metadata only, records word/skill mastery as best-effort side
effects, and may complete the Today word-review step when enough target words
have been reviewed.

## Cloze mode

`GET /api/study/cloze?limit=N` builds cloze cards from due flashcards. When a
saved word has no example sentence or the word cannot be located in the example,
the API returns `cloze: null` so the UI falls back to definition-mode instead of
failing.

Cloze items may include `contextSentence` and `articleId` for the authenticated
learner's study UI. These are user-facing study data, not analytics metadata;
they must not be copied into logs, product analytics properties, audit metadata,
or AI ledger rows.

## Saved-word browser

`GET /api/study/words` powers `/study/words` with:

- text search over word or explanation;
- source-article filter;
- SRS filter: `all`, `due`, or `new`;
- 1-based pagination;
- article-title linkback resolved through article-access checks.

Article titles are omitted when the original article is no longer readable by
the user, preventing saved-word rows from becoming an article-title oracle.

## Privacy and deletion

Study Plan reads user-owned learning rows and aggregate weakness memory. It does
not persist generated plan text. Product analytics records only metadata such as
study grade, never reviewed words, definitions, examples, notes, or article
text. User deletion cascades `SavedWord`, mastery rows, quiz/pronunciation
attempts, coach memory, and related user-owned study state.

## Tests

Relevant tests include `tests/study-plan.test.ts`, `tests/study-words-read-models.test.ts`,
`tests/srs.test.ts`, `tests/cloze.test.ts`, `tests/review-session-reducer.test.ts`,
`tests/weak-word-reexposure.test.ts`, `tests/review-assets*.test.ts`, and route
coverage for `/api/study/*`.

## Related docs

- [`learning-and-mastery.md`](./learning-and-mastery.md) — formulas and durable mastery rows.
- [`gamification.md`](./gamification.md) — dashboard due-count/streak summary widgets.
- [`today-session.md`](./today-session.md) — daily word-review target completion.
- [`../reader/reader-tools.md`](../reader/reader-tools.md) — Reader practice tools that feed Study Plan.
