# Profile preferences and onboarding

Profile preferences are the learner-owned inputs that drive onboarding state,
recommended level, topic personalization, daily goals, and parts of the learning
dashboard. They are small but central: routes should validate them consistently
and never trust client-provided user ids.

## Code map

| Area | Code | Purpose |
| --- | --- | --- |
| Feature schema | `src/features/profile-preferences/schema.ts` | Shared parser/normalizer for onboarding and settings profile writes. |
| Values | `src/features/profile-preferences/values.ts`, `src/lib/option-registries.ts` | Single source of allowed age/gender/CEFR/daily-goal values. |
| Repository | `src/features/profile-preferences/repository.ts` | `getProfile`, `isOnboarded`, and `isUserOnboarded`. |
| Onboarding route | `src/app/api/onboarding/route.ts` | Creates/updates profile and stamps `completedAt`. |
| Profile route | `src/app/api/profile/route.ts` | Updates preferences and records level history on explicit level changes. |
| Guards | `src/lib/session.ts` | `requireOnboardedSession(...)` redirects incomplete profiles to `/onboarding`. |
| Consumers | `src/lib/recommendations/context.ts`, `src/lib/leveling/`, `src/lib/engagement/` | Topic, level, timezone, goal, and activity personalization. |

## Data model

`Profile` is one-to-one with `User` and cascades on user deletion. Important
fields include:

- optional demographic choices (`ageRange`, `gender`),
- required `englishLevel`,
- `topics` as a validated category-slug array,
- `dailyGoal`,
- `timezone`,
- `completedAt`,
- `levelUpdatedAt`,
- `streakShields`.

`completedAt` is the onboarding boundary. A profile row without `completedAt`
does not count as onboarded.

## Validation contract

`parseProfileInput(...)` is the shared route parser:

- `englishLevel` must be one of the configured CEFR levels,
- optional `ageRange` and `gender` must be from their configured registries,
- `topics` are filtered to valid article category slugs and de-duplicated,
- `dailyGoal`, when supplied, must be an integer inside the configured min/max.

Keep allowed values in `src/lib/option-registries.ts`; feature modules re-export
them through `values.ts` for local ergonomics.

## Write flows

### Onboarding

`POST /api/onboarding` upserts the current session user's profile, stamps
`completedAt`, and records a product analytics `onboarding_complete` event with
metadata only (`englishLevel`, `topicCount`).

### Profile settings

`PUT /api/profile` upserts the current session user's profile. If the CEFR level
changed from the existing profile, it records a `LevelHistory` row in the same
transaction and updates `levelUpdatedAt`.

User ids always come from the authenticated session. The request body never
selects which profile to modify.

## Read and personalization behavior

- `requireOnboardedSession(...)` uses `isUserOnboarded` to redirect incomplete
  users to onboarding.
- Recommendations use profile topics and adaptive recommended level as part of
  the scored-picks context.
- Engagement uses profile timezone/daily goal/streak shields for local-day
  activity and dashboard widgets.
- Learning analytics and level recommendation use `LevelHistory`, quiz results,
  skill mastery, and current profile level.

## Reading placement (`PlacementResult`, #806)

A lightweight cold-start signal that complements self-reported CEFR level for
brand-new learners.

- **Source of truth:** the single per-user `PlacementResult` row (1:1 with
  `User`, upserted on retake, cascades on user delete). Written by
  `POST /api/placement`.
- **Producer:** the placement step on the post-onboarding welcome screen
  (skippable) and the "Retake placement" affordance in Settings (posts
  `attempt = "retake"`). Passage + questions are served by `GET /api/placement`
  from the public Article Library — no new content table.
- **Scoring:** `computePlacementScore` (`src/lib/learning/placement.ts`) is a
  pure function mapping `{ correctCount, totalCount, lookupCount, wordCount }`
  for a seed level to a recommended starting level (`A1`–`C1`). Deterministic
  and conservative (heavy vocabulary pressure can only nudge *down*).
- **Consumer:** the Today generator
  (`src/lib/engagement/today-session/generator.ts`) reads
  `PlacementResult.recommendedLevel` and passes it as a `placementLevel`
  override to `listScoredPicksPage` → `buildRecommendationContext`, centring the
  first picks on the measured level. When no row exists the generator passes
  nothing and the picks pipeline keeps its existing adaptive/`Profile.englishLevel`
  signal, so behaviour is unchanged for learners without a placement.
- **Skip:** a skipped placement still seeds Today — `recommendedLevel` coerces
  to the self-reported seed level and `skipped = true` is recorded.

## Goal paths (`Profile.goalPath`, #809)

A controlled, optional reading-strategy preference that tunes recommendations
and Today copy without AI.

- **Storage:** `Profile.goalPath` is a nullable `String` (controlled enum:
  `daily_news` | `academic` | `business` | `exam` | `extensive`, or `null` when
  unset). Validators and tuning constants live in
  `src/lib/learning/goal-path.ts`. `null` means "not set" — behaviour falls back
  to existing level-only scoring.

  | `goalPath` | Description | Tuning intent |
  |---|---|---|
  | `daily_news` | Daily News Reader | Medium length, current-events topics, B1–B2 |
  | `academic` | Academic Reading | Longer articles, formal register, B2–C1 |
  | `business` | Business English | Business/finance/tech topics, B1–C1 |
  | `exam` | Exam Preparation | Variety of genres, comprehension emphasis, B1–B2 |
  | `extensive` | Casual Extensive Reading | Short, low difficulty risk, any topic |

- **Producer:** the "Reading goal" selector in Settings
  (`ProfileSettingsForm`) posts `goalPath` to `PUT /api/profile`. Choosing or
  changing a path only updates this one scalar — reading history, progress,
  streak, and saved words are untouched. Sending `null`/`""` clears it; an
  invalid value is rejected with `400`.
- **Tuning (deterministic, no AI):** `buildRecommendationContext` loads
  `goalPath` into `RecommendationContext`. After the core seven-component score,
  `applyGoalPathAdjustment` (pure, in `goal-path.ts`) applies a **soft, capped
  (±0.2 in normalised score units)** nudge from the path's length / difficulty-
  band / topic-boost constants. It never hard-filters: a **content-starvation
  guard** (`resolveEffectiveGoalPath`) relaxes tuning to standard scoring when
  fewer than two candidates fit the path, so the feed is never starved. With
  `goalPath = null` scoring is byte-for-byte unchanged.
- **Today copy:** path-specific Today heading / completion / comprehension-prompt
  copy lives in `src/lib/copy/goal-path.ts` and is surfaced through the Today
  view model (`goalPathCopy`, `comprehensionPrompt`). All five paths have
  deterministic English copy — no AI.

## Privacy

Profile preferences are user-owned. Analytics may record coarse metadata such as
level and topic count, but not free-text answers or private content. Avoid
logging demographics or topic arrays unless they are explicitly aggregated and
sanitized.

`PlacementResult` stores STRUCTURED OUTCOMES ONLY — counts (`questionCount`,
`correctCount`, `lookupCount`), controlled levels (`seedLevel`,
`recommendedLevel`), `skipped`, `attempt`, and timestamps. It never stores
passage text, question/answer text, looked-up words, definitions, or PII. The
`placement_completed` analytics event carries only `{ seedLevel,
recommendedLevel, skipped, questionCount, correctCount }` — never article ids.
`exportUserData` exports only the controlled columns.

`Profile.goalPath` (#809) stores ONLY the controlled enum string the learner
explicitly selected — never reading history used to infer a goal, article
titles, prompts, or any AI-derived goal. The `goal_path_selected` analytics
event carries only `{ goalPath }`. `exportUserData` includes `goalPath`.

## Tests

Relevant tests include `tests/profile*.test.ts`, `tests/onboarding*.test.ts`,
`tests/leveling*.test.ts`, recommendation context tests, `tests/placement*.test.ts`,
and auth/session guard tests.
