---
title: "Reader recommendations and scored picks"
category: "Reader"
architecture: "Documents Scored Picks candidate boundaries, personalization context, ranking, diversity, explanations, and privacy rules."
design: "Captures current candidate filtering, score weights, placement/goal/profile inputs, series soft candidates, feed/browse behavior, and fallback rules."
plan: "Update when recommendation context, scoring weights, feed/browse routes, placement/series inputs, diversity, or explanation behavior change."
updated: "2026-07-01"
rename: "none"
---

# Reader recommendations and scored picks

Recommendations power the personalized scored "Picks" feed. The system is
transparent by design: every article receives component scores, a final score,
and a human-readable reason.

## Code map

| Area | Code | Purpose |
| --- | --- | --- |
| Candidate loading | `src/lib/recommendations/picks.ts` | Cached public candidate set and paginated scored picks. |
| Context loading | `src/lib/recommendations/context.ts` | Per-user profile, adaptive level, mastery, progress, and vocabulary signals. |
| Scoring | `src/lib/recommendations/scoring.ts` | Pure component scorers and weighted base score. |
| Diversity | `src/lib/recommendations/diversity.ts` | Greedy category-spread penalty. |
| Explanations | `src/lib/recommendations/explanations.ts` | Headline reason and detailed score notes. |
| Types/weights | `src/lib/recommendations/types.ts` | Shared score shapes and component weights. |

## Candidate boundary

Candidates are public-listable articles only: `visibility = PUBLIC`,
`status = PUBLISHED`, and `ownerId = null` (Article Library articles, not
personal imports). Private imports, owned-public articles, and drafts are
never recommendation candidates. Specifically:

| Article state | Candidate? | Reason |
| --- | --- | --- |
| `PUBLIC` + `PUBLISHED` + `ownerId = null` | ✅ Yes | Public library article — safe for any user. |
| `PRIVATE` + any `ownerId` | ❌ No | User import — excluded by `ownerId = null` requirement. |
| `PUBLIC` + `PUBLISHED` + `ownerId ≠ null` | ❌ No | Owner-linked article — excluded by `ownerId = null` requirement. |
| any + `DRAFT` | ❌ No | Unpublished — excluded by `status = PUBLISHED` requirement. |

This policy is enforced by `publicListableArticleWhere` from `@/lib/article-library`, which is **stricter** than `readableArticleWhere` (the search predicate). A user's own private imports will never appear as Picks candidates — only public library content can be recommended.

The candidate fetch is cached and user-agnostic. It selects card-level metadata
and tag slugs only, capped at `MAX_CANDIDATES = 400`. Per-user scoring happens
after the cache boundary so no user data enters a shared cache key.

### Privacy and IDOR safety

The cached candidate set carries no per-user data. Because the candidate set is user-agnostic it is safe to share across requests. Cross-user IDOR is structurally impossible: the candidate query binds `publicListableArticleWhere` before the cache key is evaluated, so no private or org-restricted article can enter the candidate pool regardless of who is requesting.

Regression coverage lives in `tests/recommendations-candidate-visibility.test.ts` (IDOR/visibility cases) and `tests/recommendations.test.ts` (scoring/graceful-degradation cases).

## User context

`buildRecommendationContext(userId, candidateIds)` loads:

- adaptive recommended CEFR level,
- profile topics,
- completed/in-progress progress for candidate articles,
- article mastery for candidate articles,
- difficulty-feedback bias,
- weakest skill,
- word-mastery aggregate familiarity and known word count.

New users degrade gracefully: neutral level/topic/bias, empty mastery, empty
vocabulary strength, and every article treated as novel.

## Score components

Every component is normalized to `0..1` and then weighted into a `0..100` base
score.

| Component | Weight | Signal |
| --- | ---: | --- |
| `levelFit` | 0.26 | Article CEFR rank relative to the user's recommended level. |
| `topicInterest` | 0.20 | Category/tag overlap with profile topics. |
| `masteryGap` | 0.14 | Opportunity to learn; boosted for weakest-skill alignment. |
| `novelty` | 0.12 | Penalizes completed, in-progress, and very recently seen articles. |
| `wordLoad` | 0.12 | Estimated unknown-word comfort from level delta and vocabulary strength. |
| `freshness` | 0.08 | Recent publication date. |
| `difficultyFeedback` | 0.08 | Nudge based on whether the user tends to prefer easier or harder articles. |

Scoring functions are pure. Database reads belong in `context.ts`, not in
`scoring.ts`.

### Weak-word re-exposure booster (#808)

On top of the seven weighted components, articles known to contain the learner's
**weak words** (low `WordMastery.familiarity`) earn a small, capped bonus so the
feed naturally re-exposes those words in context. The overlap is computed from
`WordMastery.sourceArticleIds` in `context.ts` (`weakWordArticleIds`: candidate
articleId → distinct weak-word count) — ids/counts only, never word text. The
bonus saturates at `WEAK_WORD_REEXPOSURE_TARGET` (3 words) and is capped at
`WEAK_WORD_REEXPOSURE_MAX_POINTS` (8 of 100), so it nudges without overwhelming
`wordLoad` or starving strong content. It is a soft booster, never a hard
filter, and degrades to a no-op when the learner has no weak words. Each result
carries a `weakWordReexposure` breakdown (`count`/`score`/`points`).

## Diversity pass

`rankWithDiversity(scored)` greedily selects the best remaining item, subtracting
`6` points per previous same-category pick, up to `18` points. The penalty is
recorded in each result and included in the final score/explanation.

This prevents a single category from dominating the top of the feed while still
allowing excellent same-category articles to appear.

## Pagination and UI contract

`listScoredPicksPage(userId, opts)` returns:

- listing-card articles,
- `hasMore`,
- `reasons` keyed by article id,
- full `scored` objects keyed by article id.

Routes/components can display the headline reason without exposing raw user
profile data.

## Privacy

Recommendation context is computed per request and not stored as a separate
profile. Do not log component inputs, topic lists, mastery rows, or article text.
Aggregate score outputs are safe for UI/debug tests, but production logs should
keep only low-cardinality metadata.

## Tests

Relevant tests include:

- `tests/recommendations-candidate-visibility.test.ts` — IDOR/visibility regression: private imports, another user's private articles, owned-public articles, and drafts must never appear as candidates.
- `tests/recommendations.test.ts` — scoring, diversity, context loading, and graceful new-user degradation.
- `tests/recommendations-context.test.ts` — per-user context signal loading.
- `tests/article-mastery.test.ts`, `tests/leveling*.test.ts` — component signal tests.
