# Learning, mastery and learner analytics

This document describes the learner-facing analytics and mastery systems in the
current ReadWise codebase. These are distinct from product analytics events in
[`analytics.md`](./analytics.md): product analytics measures product usage,
whereas the systems here compute a learner's progress, confidence, level, and
study recommendations.

## Data sources

| Model / table | Purpose | Main code |
| --- | --- | --- |
| `ReadingProgress` | Per-user article percent/completion; progress is forward-only and completion is sticky. | `src/lib/progress.ts` |
| `DailyActivity` | Distinct articles progressed per local calendar day; powers streaks and heatmap. | `src/lib/activity.ts` |
| `LevelHistory` | Timestamped CEFR changes for a user's profile level. | `src/lib/progress-helpers.ts` |
| `SavedWord` | Explicit user study list and SM-2 schedule fields. | `src/lib/vocabulary.ts`, `src/lib/flashcards.ts` |
| `QuizAttempt` | Per-user quiz history with score percentage and idempotency key for offline sync. | `src/lib/quiz-mastery.ts`, `src/lib/quiz-grading.ts` |
| `WordMastery` | Durable familiarity/confidence estimate per user + lemma. | `src/lib/word-mastery.ts` |
| `ArticleMastery` | Durable comprehension score per user + article. | `src/lib/article-mastery.ts` |
| `SkillMastery` | Confidence per skill dimension. | `src/lib/skill-mastery.ts` |
| `ArticleDifficultyFeedback` | Per-user article vote: `too_easy`, `just_right`, `too_hard`. | `src/lib/leveling.ts` |
| `PronunciationAttempt` | Pronunciation scores persisted from client-side Azure Speech assessment. | `src/lib/pronunciation.ts` |

All writes are user-scoped. Mastery writes are best-effort side effects: if a
mastery update fails, the underlying user action still succeeds.

## Word mastery

`WordMastery` estimates how familiar a learner is with a word, keyed by a
normalized lemma so case/possessive/punctuation variants merge. Lemma
normalization reuses `normalizeCandidates()` from `src/lib/dictionary-normalize.ts`.

### Fields

| Field | Meaning |
| --- | --- |
| `lemma` | Canonical key for the word. |
| `exposures` | Count of observed exposures: lookup, save, reading encounter, or review. |
| `correctReviews` / `incorrectReviews` | Recall outcomes from SRS/cloze-like review. |
| `familiarity` | 0-1 estimate of recognition/recall strength. |
| `confidence` | 0-1 amount of evidence behind the estimate. |
| `sourceArticleIds` | Most recent article ids associated with this word, capped at 20. |
| `lastSeenAt`, `lastReviewedAt` | Recency metadata. |

### Formula

`computeFamiliarity(exposures, correctReviews, incorrectReviews)` is transparent
and deterministic:

1. Exposure recognition score:

   $$
   exposureScore = 1 - e^{-exposures/4}
   $$

2. If there are no reviews, familiarity is capped at recognition-only evidence:

   $$
   familiarity = clamp01(exposureScore \times 0.6)
   $$

3. Once reviews exist, recall accuracy increasingly dominates:

   $$
   reviews = correctReviews + incorrectReviews
   $$

   $$
   accuracy = correctReviews / reviews
   $$

   $$
   recallTrust = min(1, reviews / 4)
   $$

   $$
   familiarity = clamp01(exposureScore \times 0.6 \times (1 - recallTrust) + accuracy \times recallTrust)
   $$

`computeConfidence(...)` is based on total evidence:

$$
confidence = clamp01(1 - e^{-(exposures + correctReviews + incorrectReviews)/5})
$$

### Write entry points

- `recordWordExposure(userId, word, { articleId? })` increments exposure and
  updates `lastSeenAt`.
- `recordWordReview(userId, word, correct, { articleId? })` increments exposure,
  correct/incorrect review count, and `lastReviewedAt`.
- `estimateFamiliarity(userId, word)` returns 0 when no mastery row exists.

Flashcard grading calls `recordWordReview` and also records vocabulary skill
evidence.

## Article mastery

`ArticleMastery` provides one queryable representation of how well a user
understood an article.

### Source signals

- `ReadingProgress.percent` → `readingCompletion` in 0-1.
- Best `QuizAttempt.scorePct` → `quizScore` in 0-1, or `null`.
- Count of `SavedWord` rows for the article divided by article word count →
  `lookupDensity` as lookups per 100 words.
- `ArticleDifficultyFeedback.vote` → `too_easy`, `just_right`, `too_hard`, or
  `null`.
- Optional accumulated reading time from the reader time tracker.

### Formula

With a quiz score:

$$
score = 0.5 \times readingCompletion + 0.5 \times quizScore
$$

Without a quiz score:

$$
score = 0.6 \times readingCompletion
$$

Then:

- `too_hard` multiplies by `0.85`.
- `too_easy` applies `score = score * 1.05 + 0.05`.
- Lookup-density penalty, when present, is `min(0.15, lookupDensity * 0.02)` and
  multiplies the score by `1 - penalty`.

The final `comprehensionScore` is clamped to 0-1.

## Skill mastery

`SkillMastery` tracks six dimensions:

```text
reading, vocabulary, grammar, listening, pronunciation, comprehension
```

Each row stores `confidence` (0-1), `evidenceCount`, bounded `recentEvidence`,
and `lastUpdatedAt`.

### Evidence update

`recordSkillEvidence(userId, skill, outcome, weight = 1)` clamps outcome to 0-1
and weight to 0-5. The first observation sets confidence. Later observations use
an exponential moving average:

$$
alpha = min(0.8, 0.3 \times weight)
$$

$$
confidence = clamp01(existingConfidence \times (1 - alpha) + outcome \times alpha)
$$

Recent evidence keeps the newest 10 summaries only; it stores metadata, not user
content.

### Skill profile and recommendation

`getSkillProfile(userId)` returns all six skill rows, an overall confidence
(mean of skills with evidence), total evidence count, weakest skill, and
strongest skill.

`recommendLevelChange(userId)` in `skill-mastery.ts` suggests:

- `up` when enough evidence exists, overall confidence is at least `0.8`, no
  evidenced skill is below `0.4`, and the user is not already at C2.
- `down` when overall confidence is below `0.4` and the user is above A1.
- `hold` when evidence is sparse or mixed.

The function never mutates `Profile.englishLevel`; applying a level change is an
explicit user action.

## Adaptive CEFR recommendation

`src/lib/leveling.ts` contains two layers:

1. A pure quiz-only recommendation for legacy flows.
2. The richer adaptive recommender used by level recommendation UI.

Adaptive evidence includes:

- Current `Profile.englishLevel`.
- Difficulty feedback counts.
- Average of the 20 most recent quiz attempts.
- Number of completed public articles at the current level.
- Overall `SkillMastery` confidence and evidence count.

Signals vote up/down. The recommender shifts the **recommended engine level** by
one CEFR band but does not automatically update the user's profile.

Important thresholds:

| Signal | Up | Down |
| --- | --- | --- |
| Recent quiz average | `>= 85` with at least 3 attempts | `< 50` with at least 3 attempts |
| Difficulty feedback bias | `>= 0.4` with at least 3 votes | `<= -0.4` with at least 3 votes |
| Skill confidence | `>= 0.8` with at least 4 evidence items | `< 0.4` with at least 4 evidence items |

Difficulty bias is:

$$
bias = (tooEasy - tooHard) / totalVotes
$$

## Learner analytics page

`src/lib/learner-analytics.ts` powers `/progress` and is scoped to a single
`userId`.

It returns:

- total completed and in-progress articles,
- total saved words,
- quiz attempt count and average score,
- reading completions by week for the last 12 weeks,
- saved words by week for the last 12 weeks,
- last 10 quiz scores oldest-to-newest,
- completed articles by CEFR difficulty,
- current and longest streak from `getStreakSummary`.

Weekly buckets use ISO week labels (`YYYY-Www`) and are zero-filled so charts do
not jump when a week has no activity.

## Activity, heatmap and streak shields

`recordReadingActivity(userId, articleId, timezone?)` runs as a side effect of
progress saving. It recomputes the distinct articles progressed on the user's
local calendar day and upserts `DailyActivity`.

Day boundaries use the user's IANA timezone from `Profile.timezone`, defaulting
to UTC. Stored `DailyActivity.date` is UTC midnight of that local calendar date.

Heatmap cells cover 52 weeks plus today (365 cells) and use levels:

| Articles read | Heat level |
| --- | --- |
| `0` | `0` |
| `1` | `1` |
| `2-3` | `2` |
| `4-5` | `3` |
| `6+` | `4` |

Streak shields:

- Earn one shield after 7 consecutive active days.
- Hold at most one shield.
- A 1-day gap can be filled when yesterday was missed, two days ago was active,
  today is newly active, and a shield is available.

## Study and SRS integration

`SavedWord` stores SM-2 fields: `dueAt`, `intervalDays`, `easeFactor`,
`repetitions`, and `lastReviewedAt`.

`getDueFlashcards(userId, limit)` returns never-reviewed cards first, then oldest
due cards. `gradeFlashcard(...)` updates the SM-2 schedule and records:

- word review mastery (`good`/`easy` = correct, `again`/`hard` = incorrect),
- vocabulary skill evidence with outcomes:

| Grade | Skill outcome |
| --- | --- |
| `again` | `0` |
| `hard` | `0.35` |
| `good` | `0.75` |
| `easy` | `1` |

## Privacy and deletion

Learner analytics are derived from user-owned tables and are not a separate
append-only stream. User deletion cascades through user-owned data such as
progress, saved words, daily activity, highlights, quiz attempts, and
pronunciation attempts. Product analytics events are non-FK rows and must be
handled through the retention/erasure helpers documented in
[`analytics.md`](./analytics.md).
