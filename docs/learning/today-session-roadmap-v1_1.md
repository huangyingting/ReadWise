# Today Session v1.1 / v2 Roadmap — Implementation-Ready Designs

**Status:** Design-ready — resolves `go:needs-research` for issues #806, #807,
#809, #810, #811, #813 (Epic #787).  
**Doc owner:** Lead / Architect  
**Cross-references:**
- Existing Today Session v1 design: [`today-session.md`](./today-session.md)
- Schema conventions: `prisma/base.prisma` (controlled strings, single-source)
- Privacy rules: `AGENTS.md` + [`../security/data-lifecycle-matrix.md`](../security/data-lifecycle-matrix.md)

---

## Contents

| Section | Issue | Feature |
|---|---|---|
| [§1 Reading Placement](#1-reading-placement-806) | #806 | Lightweight cold-start placement flow |
| [§2 Comprehension Feedback & Quiz Remediation](#2-comprehension-feedback--quiz-remediation-807) | #807 | Post-reading self-check + guided remediation |
| [§3 Goal Paths](#3-goal-paths-809) | #809 | Personalized reading strategy via learner goal |
| [§4 Privacy-Safe Coach Memory](#4-privacy-safe-learning-coach-memory-810) | #810 | Structured weakness summaries for Tutor / Study Plan |
| [§5 Today Offline Mutations](#5-today-offline-mutation-support-811) | #811 | Offline queue for skip / step-complete / review |
| [§6 Reading Fluency Feedback & Curated Series](#6-reading-fluency-feedback--curated-reading-series-813) | #813 | Fluency trends + curated topic/level reading series |

---

## 1 Reading Placement (#806)

### Problem & goal

New A2-B2 learners receive Today article picks seeded only by self-reported CEFR
level. Cold-start accuracy is poor: over-reporters get hard content, under-reporters
get trivial content. Goal: add a short (5-8 min) placement assessment so the first
Today recommendations land closer to the learner's actual level.

### Proposed design

#### Flow overview

1. Shown once after `Profile.completedAt` is set (onboarding done) when
   `PlacementResult` does not yet exist for the user.
2. Learner reads one short passage (~150-200 words) from a curated set keyed by a
   self-reported CEFR level (`A2`, `B1`, `B2`). Passage is served from the
   existing Article Library (visibility `PUBLIC`, `difficulty` within band) —
   **no new content table needed**.
3. Three to five multiple-choice comprehension questions drawn from the article's
   existing `QuizQuestion` rows. If < 3 questions exist for the seeded article,
   fall back to the next passage candidate.
4. Vocabulary pressure signal: count `SavedWord` lookups during the passage read
   (client-tracked; sent as a count only, never word text).
5. Score: `correctRatio = correct / total`, `lookupRate = lookups / wordCount`.
   Deterministic bucketing:
   - `correctRatio >= 0.8 AND lookupRate < 0.05` → `recommendedLevel = one above seed`
   - `correctRatio >= 0.6` → `recommendedLevel = seed`
   - `correctRatio < 0.6 OR lookupRate >= 0.1` → `recommendedLevel = one below seed`
6. Store only the structured result row. Allow skip (stores `skipped = true`).
7. Today generator reads `PlacementResult.recommendedLevel` if available and
   passes it as a `placementLevel` override to `listScoredPicksPage`.
8. Learner can retake via Settings → Profile.

#### Prisma model sketch

```prisma
// #806 — Lightweight reading placement result.
// Stores STRUCTURED OUTCOMES ONLY — no passage text, answers, or PII.
// One row per user; upserted on retake. Cascades with the user.
model PlacementResult {
  id                String    @id @default(cuid())
  userId            String    @unique
  /// Passage article id used for placement (NOT FK — survives article deletion).
  passageArticleId  String
  /// Self-reported seed level used to pick the passage.
  seedLevel         String    // "A2" | "B1" | "B2"
  /// Deterministic recommended starting level.
  recommendedLevel  String    // "A1" | "A2" | "B1" | "B2" | "C1"
  /// Number of questions presented (3–5).
  questionCount     Int
  /// Number of correct answers — no answer text stored.
  correctCount      Int
  /// Vocabulary lookup count during placement passage — count only.
  lookupCount       Int
  /// True when the learner skipped placement; recommendedLevel is null-coerced
  /// to seedLevel when skipped = true so Today still has a starting signal.
  skipped           Boolean   @default(false)
  /// Controlled: "initial" | "retake"
  attempt           String    @default("initial")
  completedAt       DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

**SQLite + PostgreSQL parity:** all columns use scalar types; no `String[]` (use
`Int` count instead). Single-source `prisma/base.prisma` → `npm run
schema:generate`. Cascade: `onDelete: Cascade` on `userId` foreign key.

**Retention:** indefinite per user; overwritten on retake (upsert). Deleted with
user via cascade. Exported in `exportUserData` bundle (see §4.3 of lifecycle
matrix): `recommendedLevel`, `seedLevel`, `skipped`, `completedAt`,
`questionCount`, `correctCount`.

#### Integration points

| Module / file | Change |
|---|---|
| `prisma/base.prisma` | Add `PlacementResult` model (above) |
| `src/lib/engagement/today-session/generator.ts` | Read `PlacementResult.recommendedLevel`; pass as `placementLevel` override to picks context |
| `src/lib/recommendations/context.ts` | Accept optional `placementLevel` in `RecommendationContext`; use in `levelFitScore` weight when present |
| `src/lib/learning/placement.ts` _(new)_ | Pure scoring: `computePlacementScore(correct, total, lookups, wordCount)` → `recommendedLevel` |
| `src/app/api/placement/route.ts` _(new)_ | `POST /api/placement` — receive `{ articleId, correctCount, totalCount, lookupCount, seedLevel, skipped? }`; run scorer; upsert `PlacementResult` |
| `src/app/(app)/onboarding/` | Show placement step after profile completion; allow skip |
| `src/app/(app)/settings/` | "Retake placement" affordance in Profile settings |
| `docs/learning/profile-preferences.md` | Document `PlacementResult` as a personalization consumer |

#### Privacy & safety plan

| Stored | Banned from storage |
|---|---|
| `correctCount`, `questionCount` (integers) | Passage text, question text, answer options, selected answer text |
| `lookupCount` (integer) | Individual word lookup list, definitions, context sentences |
| `recommendedLevel`, `seedLevel` (controlled strings) | Raw quiz attempt payloads, user notes, article body |
| `skipped`, `attempt`, timestamps | Any free-form explanation, prompts |

Analytics event: `placement_completed` with `{ seedLevel, recommendedLevel, skipped, questionCount, correctCount }`. No article ids in the analytics payload.

#### Acceptance criteria (build-ready)

- [ ] `PlacementResult` model in `prisma/base.prisma`; migration generated for
  both SQLite and PostgreSQL targets.
- [ ] `computePlacementScore` is a pure function; 100% branch coverage in unit
  tests (no Prisma dependency).
- [ ] `POST /api/placement` rejects: missing/invalid fields (`400`); submission
  with no authenticated session (`401`); `articleId` not in public library
  (`404`).
- [ ] `POST /api/placement` is idempotent (second submission for same user
  upserts, does not create a duplicate row).
- [ ] Today generator passes `recommendedLevel` (or falls back to
  `Profile.englishLevel`) to `listScoredPicksPage`; existing behavior unchanged
  when no `PlacementResult` row exists.
- [ ] Privacy test: the API request payload and the `PlacementResult` row contain
  no passage text, question text, answer text, definitions, or PII.
- [ ] Settings UI includes "Retake placement" that posts `attempt = "retake"`.
- [ ] Skip at any point stores `skipped = true` without blocking onboarding
  completion.
- [ ] `exportUserData` includes `PlacementResult` fields (controlled columns
  only).

#### Phased implementation plan

| Phase | Deliverable |
|---|---|
| 1 (smallest shippable) | `PlacementResult` schema + migration; `computePlacementScore` pure function; `POST /api/placement` endpoint; Today generator reads placement level |
| 2 | Onboarding step UI (skip allowed); passage selection (public library pick by difficulty band) |
| 3 | Settings retake affordance; `exportUserData` update; privacy test |
| 4 | (Optional) AI-assisted question generation for placement passages not yet having quiz questions |

#### Open product questions / risks

- **Passage curation:** who ensures placement passages exist with ≥ 3 quiz
  questions per CEFR band? Recommend a small admin-curated set of 3–5 articles
  per band before shipping Phase 2.
- **Retake gating:** should retake be rate-limited (e.g. once per 30 days)? Not
  critical for v1 but prevents gaming.
- **Cold-start for A1 learners:** current self-report includes A1; placement as
  designed starts at A2. Decision needed: skip placement for A1 self-reporters
  or add A1 passages.
- **Partial completion:** if the learner closes mid-placement, should partial
  results be discarded or resumed? Phase 1 can discard; Phase 3 can resume.

---

## 2 Comprehension Feedback & Quiz Remediation (#807)

### Problem & goal

v1 Today comprehension reuses the full article quiz or difficulty feedback, but
both are heavyweight. Goal: add a low-pressure post-reading self-check (1-2
questions) and a guided remediation step that feeds structured weakness signals
into mastery/study-plan without requiring a full quiz.

### Proposed design

#### Flow overview

1. After `readingCompletedAt` is set, the Today workflow presents an optional
   self-check:
   - A single self-rating question: "How well did you understand this article?"
     (`confident` / `partial` / `confused`).
   - Zero or one lightweight MCQ drawn from the article's `QuizQuestion` rows
     (the most recently added question tagged `main_idea` or `detail` if
     available; otherwise any question). If no `QuizQuestion` exists, the flow
     shows self-rating only.
2. **Self-rating alone advances `comprehensionCompletedAt`** — no forced quiz.
3. If the learner answers the optional MCQ **incorrectly**:
   - Show a low-pressure remediation card: "Let's revisit the key idea."
   - Surface the `QuizQuestion.explanation` (already stored, not newly
     generated) and a "Go back to article" deep-link to the relevant paragraph.
   - Store the question id and outcome; do **not** store the option text.
4. Signals are written to `ArticleMastery` and optionally `SkillMastery` via
   the existing mastery update path. No new model needed in Phase 1.

#### Prisma model sketch

A new lightweight model is needed only if structured per-question outcomes need
to outlive the session and be queried by study-plan/tutor. For v1/Phase 1,
`ArticleMastery.comprehensionScore` and `SkillMastery.confidence` (existing
models) are sufficient. A dedicated model is proposed for Phase 2+:

```prisma
// #807 Phase 2 — Lightweight comprehension check outcome per Today session.
// Stores question ids and boolean outcomes ONLY — no answer text, option text,
// article text, or explanations.  One row per Today session.
model TodayComprehensionFeedback {
  id              String   @id @default(cuid())
  userId          String
  /// Plain string reference to TodaySession.id (NOT FK — survives session
  /// reset; only user deletion cascades).
  todaySessionId  String
  /// Article id at the time of the check — non-FK, survives article deletion.
  articleId       String
  /// Controlled self-rating: "confident" | "partial" | "confused"
  selfRating      String
  /// Optional: id of the QuizQuestion that was asked (null if no MCQ shown).
  questionId      String?
  /// True when the MCQ was answered correctly; null when no MCQ was shown.
  mcqCorrect      Boolean?
  /// Controlled skill tag from the question if available:
  /// "main_idea" | "detail" | "inference" | "vocabulary_in_context"
  skillTag        String?
  /// True when the learner opened the remediation card (engagement signal).
  remediationViewed Boolean @default(false)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([userId, articleId])
}
```

**SQLite + PostgreSQL parity:** all scalar columns; single-source schema.
**Retention:** indefinite; deleted with user via cascade. Exported in
`exportUserData`: `selfRating`, `mcqCorrect`, `skillTag`, `remediationViewed`,
timestamps (no question text, no article text).

#### Integration points

| Module / file | Change |
|---|---|
| `prisma/base.prisma` | Add `TodayComprehensionFeedback` (Phase 2) |
| `src/lib/engagement/today-session/completion.ts` | Accept `selfRating` in `markTodayComprehensionComplete`; advance `comprehensionCompletedAt` on self-rating alone |
| `src/app/api/today/comprehension/route.ts` _(new)_ | `POST /api/today/comprehension` — body `{ selfRating, questionId?, mcqCorrect?, skillTag? }`; idempotent |
| `src/lib/learning/article-mastery.ts` | Accept comprehension outcome to update `comprehensionScore` |
| `src/lib/learning/skill-mastery.ts` | Accept `skillTag` + outcome to update `SkillMastery.confidence` |
| `src/app/(app)/today/_components/TodayWorkflow.tsx` | Render comprehension self-check step; show remediation card on wrong MCQ |
| `src/lib/learning/study-plan-engine.ts` | Consume `SkillMastery` weakness signals (already hooked; no new plumbing needed for Phase 1) |

#### Privacy & safety plan

| Stored | Banned from storage |
|---|---|
| `selfRating`, `skillTag` (controlled strings) | Article text, question text, answer option text |
| `mcqCorrect` (boolean) | Selected option text, free-form explanation, prompts |
| `questionId` (id only) | Article paragraphs, word definitions, context sentences |
| `remediationViewed` (boolean) | AI-generated content unless cached and governed via `AiInvocation` ledger |

Analytics event: `today_comprehension_submitted` with `{ selfRating, skillTag, mcqCorrect, remediationViewed }`. No article or question text.

**AI fallback:** remediation explanations use stored `QuizQuestion.explanation`
(already cached). AI-generated per-session explanations are out-of-scope for
Phase 1; if introduced in a later phase, every invocation is logged via
`AiInvocation` ledger and the result is never stored as raw text in
`TodayComprehensionFeedback`.

#### Acceptance criteria (build-ready)

- [ ] `markTodayComprehensionComplete` advances `comprehensionCompletedAt` when
  `selfRating` alone is submitted (no MCQ required).
- [ ] When a `QuizQuestion` exists for the article, one question is presented;
  when none exists, only self-rating is shown — verified by unit test.
- [ ] Incorrect MCQ response triggers remediation card with the stored
  `QuizQuestion.explanation`; no AI call in Phase 1.
- [ ] "Go back to article" link deep-links to the article reader; article content
  is not embedded in the Today API response.
- [ ] `ArticleMastery.comprehensionScore` and `SkillMastery.confidence` are
  updated via existing mastery paths; a failing mastery write never breaks the
  Today completion flow.
- [ ] Privacy test: `POST /api/today/comprehension` payload and stored row
  contain no article text, question text, answer text, or prompts.
- [ ] The feature degrades gracefully (self-rating only) when no
  `QuizQuestion` rows exist for the article.
- [ ] `TodayComprehensionFeedback` rows are included in `exportUserData`
  (controlled fields only).

#### Phased implementation plan

| Phase | Deliverable |
|---|---|
| 1 | `markTodayComprehensionComplete` accepts `selfRating`; `POST /api/today/comprehension` endpoint; `ArticleMastery` + `SkillMastery` update hooks; UI self-rating step |
| 2 | `TodayComprehensionFeedback` model + migration; MCQ selection from `QuizQuestion`; remediation card with stored explanation; `exportUserData` update |
| 3 | Skill-tag–aware study-plan weighting; (optional) AI-generated explanation via `AiInvocation` ledger |

#### Open product questions / risks

- **Question selection policy:** use the most recently added question, the
  highest-difficulty question, or a random one? Needs product decision before
  Phase 2 ships.
- **Remediation depth:** should "wrong answer" surface a second chance question,
  or only explanation + article link? Phase 1 can use explanation + link only.
- **Streak/XP integration:** does a `confused` self-rating affect streak or
  gamification? Recommendation: treat self-rating as informational only —
  never penalize honesty.

---

## 3 Goal Paths (#809)

### Problem & goal

Today uses `Profile.englishLevel` and `Profile.topics` as its only
personalization signals. Learners with distinct goals (exam prep vs. casual
reading vs. business English) get identical Today experiences. Goal: add a
`goalPath` preference that tunes article length, difficulty risk tolerance,
topic mix, and copy without requiring AI.

### Proposed design

#### Goal paths (initial set)

| `goalPath` value | Description | Tuning intent |
|---|---|---|
| `daily_news` | Daily News Reader | Medium length, current-events topics, B1-B2 range |
| `academic` | Academic Reading | Longer articles, formal register, B2-C1 range |
| `business` | Business English | Business/finance/tech topics, B1-C1 range |
| `exam` | Exam Preparation | Variety of genres, comprehension emphasis, B1-B2 range |
| `extensive` | Casual Extensive Reading | Short-medium, low difficulty risk, any topic |

#### Storage: extend `Profile`

`goalPath` is a nullable `String` on `Profile` (no new model needed). Following
the controlled-string convention of `ArticleDifficultyFeedback.vote`:

```prisma
// In model Profile — add after `timezone` (no migration danger for SQLite):
goalPath  String?  // controlled: "daily_news" | "academic" | "business" | "exam" | "extensive" | null
```

Validators live in `src/lib/learning/goal-path.ts`. `null` means "not set";
behavior falls back to existing level-only scoring.

**SQLite + PostgreSQL parity:** nullable `String` column. Single-source schema.
**Retention:** indefinite; deleted with user. Exported in `exportUserData`.
No cascade complexity (scalar field on existing `Profile` model).

#### Tuning implementation (deterministic, no AI)

`RecommendationContext` gains an optional `goalPath` field. The scoring layer
applies path-specific soft adjustments as score multipliers (pure functions, no
DB calls):

| Signal | `daily_news` | `academic` | `business` | `exam` | `extensive` |
|---|---|---|---|---|---|
| Max article length (words) | 600 | 1200 | 900 | 800 | 500 |
| Difficulty overshoot tolerance | ±0.5 | +1.0 | +0.5 | ±0.5 | -0.5 |
| Topic interest weight boost | current_events ×1.3 | – | business ×1.3, technology ×1.2 | – | ×1.0 |
| Comprehension prompt copy | "Main idea" | "Argument structure" | "Key takeaway" | "Comprehension check" | "How did you enjoy this?" |

These multipliers are constants in `goal-path.ts`; they are applied **after** the
core recommendation scoring, as soft nudges (cap: ±0.2 additive to final score).
They never hard-filter candidates — if a path produces fewer than 2 scored
candidates, the path tuning is relaxed and the standard scoring applies, ensuring
content is never starved.

#### Integration points

| Module / file | Change |
|---|---|
| `prisma/base.prisma` | Add `goalPath String?` to `Profile` model |
| `src/lib/learning/goal-path.ts` _(new)_ | Controlled values, validators, tuning constants, pure `applyGoalPathAdjustment` |
| `src/lib/recommendations/context.ts` | Add `goalPath` to `RecommendationContext`; load from `Profile` |
| `src/lib/recommendations/scoring.ts` | Call `applyGoalPathAdjustment` after core score; content-starvation guard |
| `src/app/api/profile/route.ts` | Accept and validate `goalPath` in profile update |
| `src/app/(app)/settings/` | "Reading goal" selector in profile settings |
| `src/app/(app)/today/_components/TodayWorkflow.tsx` | Path-specific copy keys (Today heading / completion message) |
| `docs/learning/profile-preferences.md` | Document `goalPath` values and tuning behavior |

#### Privacy & safety plan

| Stored | Banned from storage |
|---|---|
| `goalPath` (controlled enum string) | Reading history used to infer goal, article titles, prompts |
| Exported in user data export | Any AI inference of learner goal |

Analytics event: `goal_path_selected` with `{ goalPath }`. No content.

#### Acceptance criteria (build-ready)

- [ ] `goalPath` added to `Profile` in `prisma/base.prisma`; migration generated
  for both targets; existing rows default to `null` (no-op for today behavior).
- [ ] `applyGoalPathAdjustment` is a pure function; unit tests cover all 5
  paths + null case.
- [ ] Content-starvation guard: when path tuning would leave < 2 candidates,
  tuning is relaxed and standard scoring applies — tested by unit test.
- [ ] `PATCH /api/profile` accepts `goalPath`; invalid values rejected with `400`.
- [ ] Today article selection uses `goalPath` when set; existing behavior
  unchanged when `goalPath` is `null`.
- [ ] Today copy keys vary by path; all 5 paths have deterministic English copy
  (no AI).
- [ ] Learner can change path in Settings without losing reading history,
  progress, or streak.
- [ ] Privacy test: `goalPath` is the only new stored signal; no article text or
  inferred goals are stored.
- [ ] `exportUserData` includes `goalPath`.

#### Phased implementation plan

| Phase | Deliverable |
|---|---|
| 1 | `goalPath` on `Profile`; validators; `PATCH /api/profile` change; `RecommendationContext` and scoring hooks (all 5 paths, content-starvation guard) |
| 2 | Settings UI selector; Today copy keys; onboarding goal-path step (optional) |
| 3 | Path-specific Progress copy and weekly summary framing |

#### Open product questions / risks

- **Goal path at onboarding:** should goal-path selection be part of initial
  onboarding, or post-onboarding settings only? Onboarding adds friction; a
  post-onboarding prompt (e.g. first Today load) may convert better.
- **Classroom / tenant context:** should a teacher be able to set a default
  `goalPath` for a classroom? Out of scope for v1; flag for multi-tenancy design.
- **Topic scoring for `academic` path:** the topic taxonomy may not include
  "academic" as a first-class category. Verify coverage before Phase 2.

---

## 4 Privacy-Safe Learning Coach Memory (#810)

### Problem & goal

Tutor and Study Plan lack long-term learner context: every session starts cold.
Storing full interaction history (prompts, answers, article text) is banned by
privacy policy. Goal: define a **structured, privacy-safe memory** made of
skill-weakness summaries only, so Tutor framing and weekly study-plan
recommendations improve over time without storing private content.

### Proposed design

#### Allowed memory fields

Memory is a set of **structured weakness entries** keyed by `(userId, skill)`.
Each entry captures:

```prisma
// #810 — Structured long-term learner weakness memory for Tutor and Study Plan.
// Stores ONLY aggregated skill signals — no prompts, article text, question
// text, answer text, definitions, notes, or PII.
// One row per (userId, skill). Cascades with the user.
model LearnerCoachMemory {
  id             String    @id @default(cuid())
  userId         String
  /// Controlled skill key — one of the six SkillMastery skills plus
  /// two reading-specific dimensions:
  /// "reading" | "vocabulary" | "grammar" | "listening" |
  /// "pronunciation" | "comprehension" | "main_idea" | "inference"
  skill          String
  /// 0–1 confidence estimate blended from SkillMastery and comprehension
  /// check outcomes. Low values indicate weakness.
  confidence     Float     @default(0)
  /// Count of evidence events contributing to this entry (bounded; capped
  /// at 100 before export to prevent runaway accumulation).
  evidenceCount  Int       @default(0)
  /// ISO-8601 timestamp of the most recent evidence event that updated
  /// this entry. Used for recency decay.
  lastObservedAt DateTime  @default(now())
  /// Controlled trend direction: "improving" | "stable" | "declining"
  trend          String    @default("stable")
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, skill])
  @@index([userId])
}
```

**Banned fields (enforced in code and privacy tests):** prompts, article text,
selected text, answer text, question text, word definitions, examples, context
sentences, private notes, tokens, credentials, PII, article ids, question ids,
session ids, free-text explanations.

**SQLite + PostgreSQL parity:** all scalar columns; `Float`, `Int`, `String`,
`DateTime`. Single-source schema. Cascade: `onDelete: Cascade` on `userId`.

#### Update mechanics

`LearnerCoachMemory` rows are updated as **best-effort side effects** (a write
failure must never break the underlying action) from:

- `SkillMastery` update events (existing `skill-mastery.ts` path; hook a
  `syncCoachMemory` side-effect call after each upsert).
- `TodayComprehensionFeedback` write (§2 above; `skillTag` → skill key).
- Weekly study-plan generation (`study-plan-engine.ts`): re-reads all
  `LearnerCoachMemory` rows for the user and recalculates `trend` from the
  delta between current `confidence` and the value 4 weeks ago (stored as
  a snapshot in `evidenceCount` progression — no separate snapshot model
  needed for v1).

`evidenceCount` is bounded at 100 (capped before persistence). `lastObservedAt`
drives recency decay: entries not updated in > 90 days are treated as "stale"
and weighted at 50% by the Tutor and study-plan consumers.

#### Tutor integration

Tutor receives a **pre-formatted context string** built from `LearnerCoachMemory`
rows:

```
Skill weaknesses (structured summary only):
- comprehension: confidence 0.42 (declining, 8 observations)
- vocabulary: confidence 0.51 (stable, 15 observations)
```

The pre-formatter (`src/lib/learning/coach-memory.ts`) is the only place that
reads `LearnerCoachMemory`; it produces a bounded plain-text summary (max 200
tokens) that the Tutor prompt builder appends. **The raw `LearnerCoachMemory`
rows and the formatted summary are never logged** (they are transient, not stored
in `AiInvocation.prompt`).

#### Study Plan integration

`study-plan-engine.ts` currently ranks skills by `SkillMastery.confidence`.
With coach memory: read the top 3 lowest-confidence skills from
`LearnerCoachMemory` (not `SkillMastery` directly) so the plan is informed by
recency trend, not just the latest snapshot. The existing plan output format
is unchanged.

#### Retention, deletion, and export policy

| Policy | Behavior |
|---|---|
| **Retention window** | Indefinite; stale entries (> 90 days, no new evidence) decay in weight but are not auto-deleted |
| **User deletion** | `onDelete: Cascade` on `userId` — all rows purged immediately with the account |
| **User export** | `exportUserData` includes: `skill`, `confidence`, `evidenceCount`, `lastObservedAt`, `trend`, `createdAt`. No prompt, text, or derivative content. |
| **User-facing deletion** | "Clear learning memory" in Privacy Settings sends `DELETE /api/coach-memory` (user-scoped); hard-deletes all `LearnerCoachMemory` rows for that user; does not affect `SkillMastery` (source of truth) |
| **Retention override** | Organization admins cannot access individual learner coach memory (tenant boundary). |

#### Integration points

| Module / file | Change |
|---|---|
| `prisma/base.prisma` | Add `LearnerCoachMemory` model |
| `src/lib/learning/coach-memory.ts` _(new)_ | `upsertCoachMemory`, `buildTutorContext`, `exportCoachMemory`, `deleteCoachMemory` |
| `src/lib/learning/skill-mastery.ts` | Hook `syncCoachMemory` side-effect after each `SkillMastery` upsert |
| `src/lib/learning/study-plan-engine.ts` | Read from `LearnerCoachMemory` for skill ranking (fallback to `SkillMastery` when memory is empty) |
| `src/lib/ai/tutor/` _(existing)_ | Append bounded `buildTutorContext` output to prompt; never log the formatted context |
| `src/app/api/coach-memory/route.ts` _(new)_ | `DELETE /api/coach-memory` — hard-delete all rows for authenticated user |
| `src/app/(app)/settings/` | "Clear learning memory" action in Privacy settings |
| `src/lib/account-lifecycle/account-commands.ts` | Add `LearnerCoachMemory` to `exportUserData` |
| `docs/security/data-lifecycle-matrix.md` | Add `LearnerCoachMemory` row to §5 Learning |

#### Privacy & safety plan

| Stored | Banned |
|---|---|
| `skill` (controlled string from allowlist) | Prompts, article text, selected text, answer text |
| `confidence` (0–1 float) | Question text, definitions, examples, context sentences |
| `evidenceCount` (int, bounded at 100) | Free-text explanations, session transcripts, PII |
| `lastObservedAt` (timestamp) | Article ids, question ids, session ids |
| `trend` (controlled string) | Any AI model output stored as memory content |

**Privacy test requirement:** a test asserts that `upsertCoachMemory` rejects
any input object containing `prompt`, `text`, `definition`, `example`,
`contextSentence`, `note`, `token`, `articleId`, or `sessionId` keys.

#### Acceptance criteria (build-ready)

- [ ] `LearnerCoachMemory` model in `prisma/base.prisma`; migration for both targets.
- [ ] `upsertCoachMemory` accepts only the allowed structured fields; rejects any
  forbidden field with a typed error — tested by privacy unit test.
- [ ] `buildTutorContext` outputs ≤ 200 tokens; contains no text, ids, or
  article references — tested by unit test.
- [ ] Study plan uses `LearnerCoachMemory` for skill ranking; falls back to
  `SkillMastery` when memory is empty — tested by unit test.
- [ ] `DELETE /api/coach-memory` hard-deletes all rows for the authenticated user
  and returns `204`; does not touch `SkillMastery`.
- [ ] `exportUserData` includes `LearnerCoachMemory` (controlled fields only).
- [ ] `docs/security/data-lifecycle-matrix.md` updated with `LearnerCoachMemory`
  row (classification: `derived`, exported: yes).
- [ ] Entries not updated for > 90 days are weighted at 50% in Tutor context and
  study-plan ranking (tested by unit test with mocked `lastObservedAt`).
- [ ] `evidenceCount` is capped at 100 on each upsert.

#### Phased implementation plan

| Phase | Deliverable |
|---|---|
| 1 | `LearnerCoachMemory` schema + migration; `upsertCoachMemory` + privacy tests; `SkillMastery` hook; study-plan integration; export/delete |
| 2 | Tutor `buildTutorContext` integration; Settings "Clear learning memory" UI |
| 3 | Trend calculation; `TodayComprehensionFeedback` → coach memory hook (§2 Phase 2) |

#### Open product questions / risks

- **Tutor prompt budget:** how many tokens does the Tutor prompt already use?
  Validate that a 200-token memory summary fits within the remaining budget
  before Phase 2 ships (see `docs/ai/context-management.md`).
- **Memory cold start:** for users with no `SkillMastery` data, coach memory
  is empty — Tutor/study-plan behavior is unchanged. No special cold-start
  path needed for v1.
- **Multi-device recency:** `lastObservedAt` uses server timestamps; no
  clock-skew issue. Confirm with offline sync design (§5).

---

## 5 Today Offline Mutation Support (#811)

### Problem & goal

Today v1 is online-only. Learners who skip or complete a Today step while
offline lose that action. Goal: extend the existing offline mutation queue to
cover Today operations: `skip`, `read-complete`, `comprehension-complete`, and
`word-review-complete`.

**Prerequisite:** Today v1 online semantics must be stable (completed by the P3
milestone) before this is implemented.

### Proposed design

#### New offline mutation types

Add four new `OfflineMutationType` entries to `registry.ts`:

| Type | Endpoint | Method | Idempotency key |
|---|---|---|---|
| `today.skip` | `/api/today/skip` | `POST` | `today-skip-{userId}-{localDate}` |
| `today.read-complete` | `/api/today/read-complete` | `POST` | `today-read-{userId}-{localDate}` |
| `today.comprehension` | `/api/today/comprehension` | `POST` | `today-comp-{userId}-{localDate}` |
| `today.word-review-complete` | `/api/today/word-review-complete` | `POST` | `today-review-{userId}-{localDate}` |

`localDate` in the key is the learner's resolved local date (passed from the
client; validated against the server's local-date resolution on replay to detect
timezone drift — see §5.3).

#### Payload constraints (privacy)

Offline mutation payloads for Today operations must contain **only**:

| Field | Allowed | Banned |
|---|---|---|
| `localDate` | ✅ `"YYYY-MM-DD"` | article text, word text |
| `timezone` | ✅ IANA string | definitions, prompts, PII |
| `skipReason` | ✅ controlled string | free-text reason |
| `selfRating` (comprehension) | ✅ controlled string | answer text, question text |
| `questionId` (comprehension) | ✅ id string | any content field |
| `mcqCorrect` (comprehension) | ✅ boolean | — |

No article ids are needed in the payload — the server resolves today's primary
article from the stored `TodaySession` for that `(userId, localDate)`.

#### Idempotency on replay

Each Today API route already behaves idempotently (completion timestamps are
never overwritten; skip enforces a 1/day limit). Offline replay does not need
extra server-side deduplication — the existing idempotency contracts are
sufficient. The `clientMutationId` in the queue record provides the client-side
deduplication key via `dedupeKey` collapse (latest wins for progress-style
updates; append-only for skip).

#### Conflict resolution

Three conflict scenarios and their resolutions:

| Scenario | Resolution | UI feedback |
|---|---|---|
| Learner skips offline; same-day session already `completed` online on another device | Server skip rejects (`skipTodaySession` returns `alreadyCompleted`); replay handler marks mutation as `conflict`; client shows "Already completed on another device" toast | Non-destructive; session stays `completed` |
| Learner marks read-complete offline; primary article was swapped by `set-article` online | Server `syncTodayReadingFromProgress` checks `primaryArticleId`; if article id doesn't match, hook is a no-op; mutation replay returns `200` (idempotent no-op); no silent data loss | Silent no-op; learner sees current Today state on next load |
| Two devices queue `today.word-review-complete` for the same localDate | Both replay; server `wordReviewCompletedAt` is monotonic (first write wins; second is a no-op); final state is consistent | No conflict UI needed |

A `conflict` status in the queue record is surfaced as a non-blocking toast
("Some offline actions couldn't be applied — your progress is safe"), not a
blocking error dialog.

#### `sync-runtime.ts` changes

Add a `todayMutationReplayHandler` to `sync-runtime.ts` that:

1. Validates `localDate` format and timezone.
2. Posts to the relevant Today endpoint with the queued payload.
3. On `409` (limit reached / conflict): marks mutation `conflict` and emits
   `today_offline_conflict` analytics event (ids + status codes only; no content).
4. On `200`: removes from queue.
5. On network error: increments `retryCount`; exponential back-off (existing
   `sync-runtime` pattern).

#### No new Prisma model needed

All Today offline actions replay into existing Today API routes which use the
existing `TodaySession` model. No server-side offline queue table is introduced.
The queue is client-only (`IndexedDB` via `mutation-store.ts`).

#### Integration points

| Module / file | Change |
|---|---|
| `src/lib/offline/registry.ts` | Add 4 new `OfflineMutationType` entries and `MutationRegistration` records |
| `src/lib/offline/sync-runtime.ts` | Add `todayMutationReplayHandler`; conflict → `conflict` status + toast |
| `src/app/(app)/today/_components/TodayWorkflow.tsx` | Enqueue Today mutations offline; show conflict toast |
| `src/app/api/today/skip/route.ts` | Verify idempotency already holds for duplicate requests (smoke-test) |
| `src/app/api/today/read-complete/route.ts` | Same — verify idempotency |
| `src/app/api/today/comprehension/route.ts` _(new, §2)_ | Verify idempotency |
| `docs/reader/offline-sync.md` _(or equivalent)_ | Document Today mutation types |

#### Privacy & safety plan

| Stored in offline queue | Banned |
|---|---|
| `localDate`, `timezone`, `skipReason`, `selfRating`, `questionId`, `mcqCorrect` | Article text, word text, definitions, prompts, PII |
| `clientMutationId` (UUID) | Any content-bearing payload field |

Analytics event on conflict: `today_offline_conflict` with `{ mutationType, statusCode }`. No content.

**Idempotency keys** use only `userId` (from auth session, not payload) +
`localDate` + mutation type — never include content or sensitive context.

#### Acceptance criteria (build-ready)

- [ ] All four Today mutation types added to `OFFLINE_MUTATION_REGISTRY` with
  correct endpoint and method.
- [ ] `todayMutationReplayHandler` replays each type against the Today API;
  verified by unit test using a mock server.
- [ ] Conflict scenarios (already completed, wrong article) produce a `conflict`
  queue status — not a thrown error — tested by unit test.
- [ ] Conflict toast is shown in Today UI without blocking the current state.
- [ ] Privacy test: no offline queue record for any Today mutation type contains
  article text, word text, definitions, prompts, or PII.
- [ ] Idempotency test: replaying the same `today.skip` mutation twice against
  the server returns `200` (idempotent no-op or `limitReached`) without creating
  duplicate rows.
- [ ] `today.read-complete` no-ops when the primary article id has changed
  online — verified by integration test.
- [ ] PWA/offline Playwright smoke test: skip Today while network is off; go
  online; verify session is `skipped` in DB.

#### Phased implementation plan

| Phase | Deliverable |
|---|---|
| 1 | Registry entries + payload validators; `todayMutationReplayHandler`; unit tests for all 4 types; privacy test |
| 2 | TodayWorkflow enqueue hooks; conflict toast UI |
| 3 | PWA Playwright offline smoke test; `offline-sync.md` docs update |

#### Open product questions / risks

- **Timezone drift conflict:** if a learner queues `today.skip` at 23:59 local
  time and replays at 00:01 (next day in server time), the `localDate` in the
  payload differs from the server's current local date. Recommendation: server
  accepts the payload `localDate` as authoritative (today-session uses
  `(userId, localDate)` as the unique key, so the correct row is found
  regardless of server clock). Confirm this is acceptable with product.
- **`today.comprehension` dependency on §2:** the offline comprehension mutation
  depends on `POST /api/today/comprehension` (§2). Ship §5 Phase 1 behind the
  same feature flag as §2 Phase 1.
- **Multi-device Today re-generation:** Today is generated lazily on the first
  `GET /api/today` each day. An offline skip queued from Device A can arrive
  before Device B has loaded Today — the skip handler already guards this
  (returns a graceful no-op when no session exists for the local date).

---

## 6 Reading Fluency Feedback & Curated Reading Series (#813)

### Problem & goal

Today's Progress surface shows streak counts and session counts but no
reading-speed trend or fluency feedback. Learners lack motivation framing beyond
streaks. Goal: add level/topic-specific fluency feedback to Progress and define
curated reading series (topic ladders / themed sets) that Today can pull from.

### Proposed design

#### 6.1 Reading fluency feedback

**Signals available (no new data collection needed):**

| Signal | Source |
|---|---|
| WPM per article | `ReadingProgress.activeTimeMs` + `Article.wordCount` (existing `computeWpm`) |
| Difficulty level | `Article.difficulty` (CEFR string) |
| Topic/category | `Article.category` |
| Lookup density | `ArticleMastery.lookupDensity` |
| Comprehension self-rating | `TodayComprehensionFeedback.selfRating` (§2) |

**Aggregation (`src/lib/engagement/reading-speed-repo.ts`):**

Add `getFluencyTrend(userId, { level?, category?, windowDays? })` that returns:

```typescript
interface FluencyTrend {
  avgWpm: number | null;          // null if < 3 data points
  trend: "improving" | "stable" | "declining" | "insufficient_data";
  sampleCount: number;
  levelFilter: string | null;     // CEFR level used for filter
  categoryFilter: string | null;
}
```

The trend is determined by comparing the mean WPM of the most recent 5 sessions
against the prior 5 sessions (for the same difficulty band and topic if filtered).
All computation is **pure** and **deterministic** — no AI.

**Fluency copy (deterministic, non-punitive):**

| Trend | Copy key |
|---|---|
| `improving` | "Your reading speed is picking up — great momentum!" |
| `stable` | "Consistent reading pace — steady progress." |
| `declining` | "Slower reads often mean tougher content — that's a good sign." |
| `insufficient_data` | "Read a few more articles to see your fluency trend." |

Copy keys are stored in the i18n message catalog (`messages/en.json`); no AI.
Slowdowns are framed positively (harder content = slower = good) to avoid
punitive messaging.

**No new Prisma model.** Fluency trends are computed on demand from existing
`ReadingProgress`, `Article`, and `ArticleMastery` rows. Results are **not
persisted** — they are a view over source-of-truth tables.

#### 6.2 Curated Reading Series

A series is a curator-defined ordered list of article ids with a theme, target
CEFR range, and metadata. Learners can subscribe to a series; Today generation
uses the series as a soft candidate source.

```prisma
// #813 — Curated reading series definition.
// A named, ordered list of article ids for themed or leveled reading paths.
// Article ids are NOT foreign keys — series survive article deletion;
// orphaned ids are skipped silently at read time.
model ReadingSeries {
  id              String    @id @default(cuid())
  /// Slug used in URLs and analytics: "7-days-tech-news", "b1-b2-ladder"
  slug            String    @unique
  title           String
  description     String?
  /// Target CEFR level range: "A2" | "B1" | "B2" | "C1" | null (any)
  targetLevelMin  String?
  targetLevelMax  String?
  /// Topic tag used for recommendation scoring (matches Article.category values)
  topic           String?
  /// Ordered array of Article ids — NOT FKs. Revalidated at serve time.
  articleIds      Json      @default("[]") // string[]
  /// Controlled: "active" | "archived"
  status          String    @default("active")
  /// Whether series appears in public series browser (learner-facing)
  public          Boolean   @default(false)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  enrollments  SeriesEnrollment[]

  @@index([status])
  @@index([topic])
}

// #813 — Per-user enrollment in a curated series.
// Tracks position and completion without storing article content.
model SeriesEnrollment {
  id              String    @id @default(cuid())
  userId          String
  seriesId        String
  /// Index of the next article to read (0-based; clamped to articleIds length).
  nextIndex       Int       @default(0)
  /// Controlled: "active" | "paused" | "completed"
  status          String    @default("active")
  startedAt       DateTime  @default(now())
  completedAt     DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  user   User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  series ReadingSeries @relation(fields: [seriesId], references: [id], onDelete: Cascade)

  @@unique([userId, seriesId])
  @@index([userId])
  @@index([userId, status])
}
```

**SQLite + PostgreSQL parity:** `Json` for `articleIds`; scalar columns elsewhere.
**Cascade:** `SeriesEnrollment` cascades with `User` and `ReadingSeries`.
**Retention:** `SeriesEnrollment` deleted with user. `ReadingSeries` rows are
admin-managed; `archived` status hides from learners without deleting.

**Today integration:** `generator.ts` checks for an `active` `SeriesEnrollment`
for the user. If found, the series article at `nextIndex` is validated against
Article Library access rules and added as an additional candidate (not a
mandatory override) to the Picks scoring. This ensures series content never
bypasses visibility/access rules. When the article at `nextIndex` is inaccessible
or deleted, `nextIndex` is advanced silently to the next valid entry.

**Access rules:** `SeriesEnrollment.series.articleIds` are revalidated through
`publicListableArticleWhere` at serve time, identical to backup article
revalidation. Private or inaccessible articles in a series are silently skipped.

#### Integration points

| Module / file | Change |
|---|---|
| `prisma/base.prisma` | Add `ReadingSeries`, `SeriesEnrollment` models |
| `src/lib/engagement/reading-speed-repo.ts` | Add `getFluencyTrend` query |
| `src/lib/engagement/reading-speed.ts` | Add `computeFluencyTrend` pure function (moving average comparison) |
| `src/lib/engagement/today-session/generator.ts` | Check active `SeriesEnrollment`; inject series candidate |
| `src/lib/engagement/today-session/completion.ts` | Advance `SeriesEnrollment.nextIndex` when series article is the completed primary |
| `src/app/api/series/` _(new)_ | `GET /api/series` (list public series); `POST /api/series/[id]/enroll`; `DELETE /api/series/[id]/enroll` |
| `src/app/(app)/progress/` | Add fluency trend panel to Progress page |
| Admin article operations | Series management UI for curators (Phase 3) |
| `docs/content/article-library.md` | Note series access rule (article Library rules apply) |

#### Privacy & safety plan

| Stored | Banned |
|---|---|
| `nextIndex`, `status`, `startedAt`, `completedAt` (enrollment) | Article text, series notes, prompts |
| `slug`, `title`, `topic`, `targetLevelMin/Max` (series metadata) | Learner reading history in series metadata |
| Aggregated WPM trend (in-memory, not persisted) | Individual article WPM stored in `ReadingSeries` rows |

Analytics events:
- `series_enrolled`: `{ seriesId, seriesSlug }` — no user content.
- `fluency_trend_viewed`: `{ trend, sampleCount, levelFilter }` — no WPM values.

`getFluencyTrend` result is **not cached server-side** and **not stored** — it is
computed on demand and sent to the client as display data only.

#### Acceptance criteria (build-ready)

- [ ] `ReadingSeries` and `SeriesEnrollment` models in `prisma/base.prisma`;
  migration for both targets.
- [ ] `computeFluencyTrend` is a pure function; unit tests cover
  `improving`/`stable`/`declining`/`insufficient_data` with < 3 data points.
- [ ] Fluency copy keys for all 4 trend values are in `messages/en.json`; no AI
  required.
- [ ] Today generator includes series candidate when an active enrollment exists;
  falls back to standard scoring when no enrollment or series article is
  inaccessible.
- [ ] Series article access is validated against Article Library visibility rules;
  a private or inaccessible article never appears in Today as a series candidate.
- [ ] `SeriesEnrollment.nextIndex` advances when the series article is completed
  as Today's primary.
- [ ] `POST /api/series/[id]/enroll` rejects unauthenticated requests and returns
  `404` for non-existent or non-`public` series.
- [ ] Series enrollment does not bypass Article Library visibility; tested by
  unit test (private article in series should not surface in Today candidates).
- [ ] Privacy test: `getFluencyTrend` response and `fluency_trend_viewed` event
  contain no article text, WPM per-article values, or PII.
- [ ] Progress page fluency panel shows trend copy and sample count; avoids
  punitive framing for `declining` trend.

#### Phased implementation plan

| Phase | Deliverable |
|---|---|
| 1 | `getFluencyTrend` + `computeFluencyTrend`; Progress fluency panel (trend copy); no schema change needed |
| 2 | `ReadingSeries` + `SeriesEnrollment` schema + migration; series enrollment API; Today generator series candidate |
| 3 | `SeriesEnrollment.nextIndex` advance on completion; series browser UI for learners; admin series management UI |

#### Open product questions / risks

- **Series authoring workflow:** who creates and maintains series? A content
  admin? Automated from article tags? A curation pipeline is needed before
  Phase 3 ships.
- **Series vs. Goal Path overlap:** a `daily_news` Goal Path (§3) and a "7 Days
  of Tech News" series may compete for the same Today slot. Decide: series
  overrides path preference, or path tuning applies on top of series candidates?
  Recommendation for v1: series is an additional candidate scored by the same
  path-adjusted scoring; no special override.
- **WPM data quality for fluency trends:** `ReadingProgress.activeTimeMs` can be
  zero for older rows (pre-engagement tracking). `insufficient_data` trend
  handles this gracefully. Confirm minimum data requirement (≥ 3 complete reads
  with non-zero `activeTimeMs`) with product before Phase 1 ships.
- **Encouraging copy for low fluency:** the "slower = harder content = good
  sign" framing may feel condescending at very low WPM. Review copy with a
  language educator before Phase 1 ships.
