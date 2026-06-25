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

## Privacy

Profile preferences are user-owned. Analytics may record coarse metadata such as
level and topic count, but not free-text answers or private content. Avoid
logging demographics or topic arrays unless they are explicitly aggregated and
sanitized.

## Tests

Relevant tests include `tests/profile*.test.ts`, `tests/onboarding*.test.ts`,
`tests/leveling*.test.ts`, recommendation context tests, and auth/session guard
tests.
