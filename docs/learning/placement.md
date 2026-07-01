---
type: "design"
status: "current"
last_updated: "2026-07-01"
description: "Documents the Learning-owned placement scorer, placement passage route, welcome/settings UI affordances, and PlacementResult schema. Placement is a lightweight, deterministic, privacy-preserving cold-start/retake flow that stores only counts, controlled levels, and a recommendation."
---

# Reading placement

Reading placement gives new and returning learners a conservative CEFR starting
signal without storing passage answers, question text, looked-up words, or free
text. It complements profile preferences and adaptive level recommendations.

## Code map

| Area | Code | Purpose |
| --- | --- | --- |
| Pure scorer | `src/lib/learning/placement.ts` | Deterministic seed-level + counts → recommended level. |
| Passage loader | `src/lib/learning/placement-passage.ts` | Selects a curated public-library passage and question DTO for a seed level. |
| API | `src/app/api/placement/route.ts` | `GET` passage, `POST` structured outcome and upsert `PlacementResult`. |
| UI card | `src/components/placement/ReadingPlacementCard.tsx` | Fetches passage, tracks answers/lookups, submits counts, supports skip. |
| Welcome prompt | `src/app/(app)/welcome/page.tsx`, `WelcomePlacement.tsx` | One-time post-onboarding prompt when no placement result exists. |
| Settings retake | `src/app/(app)/settings/RetakePlacement.tsx` | Retake affordance that upserts the same per-user result row. |
| Schema | `PlacementResult` in Prisma schemas | Single per-user structured outcome; cascades with the user. |

## Seed levels

Placement passages are keyed to controlled seed bands:

```text
A2, B1, B2
```

`seedLevelForProfile(level)` maps profile CEFR into the nearest placement seed:

| Profile level | Placement seed |
| --- | --- |
| `A1`, `A2`, missing/unknown | `A2` |
| `B1` | `B1` |
| `B2`, `C1`, `C2` | `B2` |

The scorer may recommend one band below or above the seed, clamped to `A1..C1`.

## GET /api/placement

`GET /api/placement?seedLevel=A2|B1|B2` returns:

- `{ available: false }` when no eligible public passage exists;
- otherwise `{ available: true, passage }` with the passage article id, display
  text, word count, and self-scoring questions/options.

The passage is rendered client-side for the learner. The GET route does not
persist an attempt.

## POST /api/placement

The POST route accepts only structured fields:

| Field | Meaning |
| --- | --- |
| `articleId` | Public-library passage id; validated through article access policy. |
| `correctCount` | Number of correct answers, count only. |
| `totalCount` | Number of questions presented, count only. |
| `lookupCount` | Number of vocabulary lookups during the passage, count only. |
| `seedLevel` | Controlled seed band. |
| `skipped` | Optional boolean; skipped placement seeds recommendation to the seed level. |
| `attempt` | Optional `initial` or `retake`. |

The route rejects `correctCount > totalCount` and returns `404` when the article
is not in the public library.

## Scoring rules

The pure scorer computes:

- `correctRatio = correct / total`;
- `lookupRate = lookups / wordCount`.

Conservative bucketing:

| Condition | Offset |
| --- | --- |
| `correctRatio < 0.6` or `lookupRate >= 0.1` | one level down |
| `correctRatio >= 0.8` and `lookupRate < 0.05` | one level up |
| otherwise | hold seed level |

Downward conditions are evaluated first so heavy vocabulary pressure cannot be
masked by high multiple-choice accuracy.

Skipped placement stores `skipped = true`, leaves `completedAt = null`, and uses
`recommendedLevel = seedLevel` so Today and recommendations still have a safe
starting signal.

## Persistence

`PlacementResult` is one row per user and is upserted on every initial attempt
or retake. It stores:

- `passageArticleId` as a plain string reference, not a foreign key;
- `seedLevel` and `recommendedLevel` controlled strings;
- `questionCount`, `correctCount`, `lookupCount` counts;
- `skipped`, `attempt`, and completion timestamps.

No passage text, question text, options, selected answers, looked-up words,
article text, definitions, prompts, or PII are stored.

## Product analytics

Placement completion emits metadata only:

- seed level;
- recommended level;
- skipped flag;
- question/correct counts;
- attempt type.

The analytics event deliberately omits `articleId` and any text.

## Relationship to profile and adaptive leveling

Placement does not overwrite `Profile.englishLevel` automatically. It provides a
recommended starting signal that Today, Browse/Picks, and adaptive leveling can
consume. Later adaptive recommendations still use real activity: quiz attempts,
difficulty feedback, completed articles, and skill mastery.

## Tests

Relevant tests include `tests/placement.test.ts`, `tests/placement-route.test.ts`,
`tests/placement-generator.test.ts`, `tests/placement-scorer.test.ts`, profile
route/onboarding tests, and UI smoke coverage around welcome/settings placement.

## Related docs

- [`profile-preferences.md`](./profile-preferences.md) — onboarding/profile fields that seed placement.
- [`learning-and-mastery.md`](./learning-and-mastery.md) — adaptive CEFR recommendation after placement.
- [`today-session.md`](./today-session.md) — daily workflow consumers of learner level.
