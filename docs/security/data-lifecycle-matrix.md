# Data classification and retention matrix

**Scope:** All Prisma models in `prisma/schema.prisma` (SQLite dev) /
`prisma/postgresql/schema.prisma` (production), plus client-side ephemeral
stores (IndexedDB, security-event ring buffer). Based on actual code; no
behavior is invented. Gaps are called out as follow-up items.

**Authoritative cross-references:**

- Export / deletion contract → [`../access/account-lifecycle.md`](../access/account-lifecycle.md)
- Analytics privacy & retention → [`../analytics/product-analytics.md`](../analytics/product-analytics.md)
- AI ledger privacy → [`../ai/governance-ledger.md`](../ai/governance-ledger.md)
- Security redaction policy → [`overview.md`](./overview.md) §5
- Multi-tenancy deletion rules → [`../access/multi-tenancy.md`](../access/multi-tenancy.md)
- Media asset storage → [`../media/storage.md`](../media/storage.md)
- Offline client cache → [`../reader/offline-sync.md`](../reader/offline-sync.md)

---

## Legend

| Column | Meaning |
|---|---|
| **Classification** | `public` — no user identity attached; `personal` — identifies or belongs to a specific user; `sensitive` — secrets, credentials, or PII requiring extra protection; `derived` — computed/cached from source-of-truth tables; `operational` — internal system records not user-content |
| **Exported** | Whether the data appears in the `exportUserData` bundle (`src/lib/account-lifecycle/account-commands.ts`) |
| **User deletion** | Behaviour when the owning `User` row is deleted |
| **Tenant deletion** | Behaviour when the owning `Organization` row is deleted |
| **Retention** | Explicit time-based window or expiry; blank = indefinite unless deleted by cascade or explicit erasure |
| **Log/metadata safe** | Whether the data may appear in logs, analytics metadata, audit records, or error context (governed by `src/lib/security/redaction.ts`) |

---

## 1. Identity and authentication

| Model / store | Owning subsystem | Classification | Exported | User deletion | Tenant deletion | Retention | Log/metadata safe |
|---|---|---|---|---|---|---|---|
| `User` (id, name, email, image, role) | Auth / Account | **personal** | ✅ partial — id, name, email, image, role, timestamps | Cascade (self) | Not affected | Indefinite | No — email is PII; redacted in audit metadata |
| `Account` (OAuth provider link; access_token, refresh_token, id_token, scope, providerAccountId) | Auth | **sensitive** | ⛔ provider name + type only; token columns explicitly omitted | Cascade via `Account.userId` | Not affected | Tied to session; NextAuth manages refresh | No — token fields are secrets; must never appear in logs |
| `Session` (sessionToken, expires) | Auth | **sensitive** | ⛔ | Cascade via `Session.userId`; also via `revokeMemberSessions` | Not affected | `expires` column (NextAuth `session.maxAge`) | No — token is a secret |
| `VerificationToken` (token, expires) | Auth | **sensitive** | ⛔ | Not FK-linked to User; expires naturally | Not affected | `expires` column | No |

> `Account.access_token`, `refresh_token`, `id_token`, `providerAccountId`,
> `scope`, and `session_state` are never included in exports, audit metadata, or
> error context. `Session.sessionToken` is never logged.

---

## 2. Profile and preferences

| Model | Owning subsystem | Classification | Exported | User deletion | Tenant deletion | Retention | Log/metadata safe |
|---|---|---|---|---|---|---|---|
| `Profile` (ageRange, gender, englishLevel, topics, dailyGoal, timezone, goalPath, streakShields) | Learning / Onboarding | **personal** | ✅ (ageRange, gender, englishLevel, topics, dailyGoal, goalPath, completedAt, timestamps) | Cascade via `Profile.userId` | Not affected | Indefinite | No — ageRange, gender are PII; `goalPath` is a controlled preference enum |
| `ReminderPreference` (enabled, preferredHour, quietHoursStart, quietHoursEnd, timezone) | Push notifications | **personal** | ✅ enabled, preferredHour, quietHoursStart, quietHoursEnd, timezone, timestamps | Cascade via `ReminderPreference.userId` | Not affected | Indefinite | No |

> **Gap #711-A — RESOLVED (#711):** `ReminderPreference` is now included in the
> `exportUserData` bundle. See `src/lib/account-lifecycle/account-commands.ts`.

---

## 3. Article content and library

| Model | Owning subsystem | Classification | Exported | User deletion | Tenant deletion | Retention | Log/metadata safe |
|---|---|---|---|---|---|---|---|
| `Article` (visibility=PUBLIC / UNLISTED / ORG; title, content, sourceUrl, …) | Content library | **public** (for PUBLIC/UNLISTED/ORG articles) | ⛔ — article text is not duplicated into the user export; progress/list rows identify articles by id | Public articles remain on user deletion; private (ownerId non-null) cascade via `Article.ownerId` (onDelete: Cascade) | `Article.organizationId` is a soft non-FK scalar; org articles survive org deletion (organizational referential integrity is enforced in application code, not DB cascades) | Indefinite unless archived/taken down | Metadata fields (category, difficulty, wordCount) safe; `content` field must never appear in logs or audit metadata |
| `Article` (visibility=PRIVATE; user-imported) | Content library / Import | **personal** | ⛔ article text not exported; articleId references appear in progress/list rows | Cascade via `Article.ownerId` | Not applicable (private articles are user-owned) | Deleted with owner | Same as above |
| `Tag` (scope=PUBLIC) | Content library | **public** | ⛔ | Public tags remain; `Tag.ownerId` is nullable | Cascade if orgId set; no FK enforcement for `Tag.orgId` (soft ref) | Indefinite | Safe |
| `Tag` (scope=PRIVATE) | Content library | **personal** | ⛔ | Cascade via `Tag.ownerId` | Not applicable | Deleted with owner | Safe |
| `ArticleTag` | Content library | **public / personal** (mirrors tag scope) | ⛔ | Cascade via article or tag deletion | Cascade via article | Deleted with article or tag | Safe |
| `VocabularyItem` (AI-generated; word, explanation, example) | Content / AI | **public** (article-scoped, not user-owned) | ⛔ | Cascade via article | Cascade via article | Deleted with article | `explanation`, `example` are AI-generated content; do not log raw values |
| `QuizQuestion` (AI-generated) | Content / AI | **public** | ⛔ | Cascade via article | Cascade via article | Deleted with article | `question`, `options` contain AI content; do not log |
| `Translation` (full-article AI translation) | Content / AI | **public** (article-level cache) | ⛔ | Cascade via article | Cascade via article | Deleted with article | `content` is AI-derived article text; do not log |
| `SentenceTranslation` (on-demand sentence translation cache) | AI / Reader | **derived** (keyed by hash; no user FK) | ⛔ | Not FK-linked to User; survives user deletion | Cascade via article | Deleted with article | `sourceText` + `translation` are user-selected text + AI output; must not appear in logs |
| `GrammarExplanation` (AI-generated, per article+phrase) | Content / AI | **public** (article-scoped) | ⛔ | Cascade via article | Cascade via article | Deleted with article | `phrase`, `explanation` contain AI content; do not log |
| `ContentSource` (scraper provider operational state) | Operations | **operational** | ⛔ | Not user-linked | Not applicable | Indefinite | Safe (health counters only) |
| `ContentReview` (moderation audit trail per article) | Content moderation | **operational** | ⛔ | `reviewerId` is a plain string (non-FK); row survives reviewer account deletion | Cascade via article | Deleted with article | `note`, `changes` may contain admin notes; apply redaction before logging |

---

## 4. Reading lists and annotations

| Model | Owning subsystem | Classification | Exported | User deletion | Tenant deletion | Retention | Log/metadata safe |
|---|---|---|---|---|---|---|---|
| `ReadingList` | Reader | **personal** | ✅ (name, isDefault, timestamps, items) | Cascade via `ReadingList.userId` | Not affected | Deleted with user | Safe |
| `ReadingListItem` | Reader | **personal** | ✅ (articleId, addedAt) | Cascade via list | Not affected | Deleted with list | Safe |
| `Highlight` (quote, startOffset, endOffset, prefix, suffix, note, color) | Reader | **personal + sensitive** | ✅ all fields | Cascade via `Highlight.userId` | Not affected | Deleted with user | No — `quote` is selected article text; `note` is user private annotation; both must never appear in logs or audit metadata |
| `TutorMessage` (role, content — AI conversation) | AI Tutor | **personal + sensitive** | ✅ (articleId, role, content, createdAt) | Cascade via `TutorMessage.userId` | Not affected | Deleted with user | No — `content` contains user messages and AI responses; must never appear in logs, analytics metadata, or error context |

> `Highlight.quote` (selected text) and `TutorMessage.content` (chat content)
> are explicitly listed as sensitive keys in the redaction policy
> (`src/lib/security/redaction.ts`). The sanitizer drops them from analytics
> properties and audit metadata automatically; call sites must not pass them in
> error context either.

---

## 5. Vocabulary and study

| Model | Owning subsystem | Classification | Exported | User deletion | Tenant deletion | Retention | Log/metadata safe |
|---|---|---|---|---|---|---|---|
| `SavedWord` (word, explanation, example, contextSentence, SRS schedule fields) | Vocabulary / Learning | **personal** | ✅ (word, explanation, example, articleId, SRS fields, timestamps; `contextSentence` excluded — contains selected text) | Cascade via `SavedWord.userId` | Not affected | Deleted with user | No — `contextSentence` is user-selected text; `explanation`/`example` are AI-derived; the export deliberately excludes `contextSentence` |

> **Gap #711-B:** `SavedWord.contextSentence` stores the sentence surrounding a
> saved word (user-selected passage). It is correctly excluded from the export
> (selected text must not be re-exported), but an explicit erasure/nulling
> helper does not exist beyond user deletion cascade. Confirm this is
> sufficient for GDPR Article 17 requests where only selected data is to be
> erased.

---

## 6. Reading progress and mastery

| Model | Owning subsystem | Classification | Exported | User deletion | Tenant deletion | Retention | Log/metadata safe |
|---|---|---|---|---|---|---|---|
| `ReadingProgress` (percent, completed, completedAt) | Reader / Learning | **personal** | ✅ (articleId, percent, completed, completedAt, timestamps) | Cascade via `ReadingProgress.userId` | Not affected | Deleted with user | Safe |
| `DailyActivity` (date, articlesRead) | Learning | **personal** | ✅ (date, articlesRead, createdAt) | Cascade via `DailyActivity.userId` | Not affected | Deleted with user | Safe |
| `LevelHistory` (level, changedAt) | Learning | **personal** | ✅ level, changedAt | Cascade via `LevelHistory.userId` | Not affected | Deleted with user | Safe |
| `QuizAttempt` (correctCount, totalQuestions, scorePct, clientMutationId) | Learning | **personal** | ✅ (articleId, scores, completedAt; clientMutationId omitted) | Cascade via `QuizAttempt.userId` | Not affected | Deleted with user | Safe (scores only) |
| `PronunciationAttempt` (referenceText, scores) | Learning / Speech | **personal** | ✅ all score fields | Cascade via `PronunciationAttempt.userId` | Not affected | Deleted with user | No — `referenceText` is user-spoken text; do not log |
| `ArticleDifficultyFeedback` (vote: too_easy/just_right/too_hard) | Learning | **personal** | ✅ articleId, vote, timestamps | Cascade via userId | Not affected | Deleted with user | Safe |
| `PlacementResult` (seed/recommended level, question/correct counts, lookup count, skipped, attempt) | Learning / Onboarding | **personal** | ✅ controlled subset — seedLevel, recommendedLevel, questionCount, correctCount, skipped, completedAt | Cascade via `PlacementResult.userId` | Not affected | Deleted with user; one row per user, upserted on retake | Safe — stores structured outcomes only; never passage text, question/answer text, looked-up words, definitions, or PII |
| `WordMastery` (familiarity, confidence, exposures, correctReviews, incorrectReviews, sourceArticleIds) | Learning | **derived** | ✅ all mastery fields, timestamps | Cascade via `WordMastery.userId` | Not affected | Deleted with user | Safe (aggregate scores only; sourceArticleIds are ids, not content) |
| `ArticleMastery` (comprehensionScore, readingCompletion, quizScore, etc.) | Learning | **derived** | ✅ all mastery fields, timestamps | Cascade via `ArticleMastery.userId` + article | Cascade via article | Deleted with user or article | Safe |
| `SkillMastery` (confidence, evidenceCount, recentEvidence) | Learning | **derived** | ✅ skill, confidence, evidenceCount, recentEvidence, timestamps | Cascade via `SkillMastery.userId` | Not affected | Deleted with user | `recentEvidence` is a bounded JSON array of `{outcome, weight, at}` — no sensitive content per schema comment |
| `LearnerCoachMemory` (skill, confidence, evidenceCount, lastObservedAt, trend) | Learning | **derived** | ✅ skill, confidence, evidenceCount, lastObservedAt, trend, createdAt | Cascade via `LearnerCoachMemory.userId` | Not affected | Indefinite (stale > 90d decays in weight, not auto-deleted); deleted with user; user-facing clear via `DELETE /api/coach-memory` | Safe — **structured aggregate signals only**, banned by schema + `upsertCoachMemory` allowlist from storing prompts, article/selected/question/answer text, definitions, examples, notes, tokens, article/question/session ids, or PII. Hard-delete leaves `SkillMastery` (source of truth) intact |
| `TodaySession` (localDate, timezoneSnapshot, primaryArticleId, backupArticleIds, targetSavedWordIds, controlled status/source/tier/reason, completion + skip timestamps) | Learning / Today | **personal** | ✅ anchors + ids only (no content) | Cascade via `TodaySession.userId` | Not affected | Deleted with user | Safe — stores **ids and anchors only**; `primaryArticleId`/`backupArticleIds`/`targetSavedWordIds` are plain string ids (NOT FKs) revalidated in code, so deleting an Article or SavedWord never cascades here. Never stores article text, word text, definitions, examples, or context sentences |
| `TodayComprehensionFeedback` (selfRating, todaySessionId, articleId, questionId, mcqCorrect, skillTag, remediationViewed) | Learning / Today | **personal** | ✅ controlled fields + ids/booleans | Cascade via `TodayComprehensionFeedback.userId` | Not affected | Deleted with user | Safe — stores ids/enums/booleans only; never article text, question text, answer/option text, explanations, prompts, definitions, notes, or selected text |
| `ReadingSeries` (slug, title, description, target levels, topic, articleIds, status, public) | Learning / Content catalogue | **operational / public** when public | ⛔ | Not user-linked | Not affected by tenant deletion unless managed explicitly | Indefinite | Metadata mostly safe; `description` is curator-authored free text and should be redacted before logging if copied into metadata |
| `SeriesEnrollment` (userId, seriesId, nextIndex, status, startedAt/completedAt) | Learning | **personal** | ⛔ currently not selected by `exportUserData` | Cascade via `SeriesEnrollment.userId`; also deleted when the series is deleted | Not affected | Deleted with user or series | Safe — stores progress metadata only, no article text or learner free text |


> **Gap #711-C — RESOLVED (#711):** `LevelHistory`, `WordMastery`,
> `ArticleMastery`, `SkillMastery`, and `ArticleDifficultyFeedback` are now
> included in the `exportUserData` bundle. See
> `src/lib/account-lifecycle/account-commands.ts`.

---

## 7. Analytics events

| Model | Owning subsystem | Classification | Exported | User deletion | Tenant deletion | Retention | Log/metadata safe |
|---|---|---|---|---|---|---|---|
| `AnalyticsEvent` (type, userId?, anonymousId?, articleId?, sessionId?, properties Json) | Analytics | **operational** (metadata only — never content) | ⛔ | **Not cascading** — `userId` is a plain string (non-FK). Call `deleteEventsForUser(userId)` (`src/lib/analytics/events/retention.ts`) explicitly for GDPR/privacy erasure | Not applicable | **400 days** default (`ANALYTICS_RETENTION_DAYS` env var); pruned via `pruneOldEvents()` | `properties` is sanitized by `sanitizeEventProperties` before write, dropping any sensitive key (content, text, token, email, url, …). Safe if sanitizer ran correctly |

> The `deleteEventsForUser` call is **not** part of `deleteOwnAccount`
> or `deleteMember` by default. If policy requires removing analytics rows on
> account deletion, callers must invoke it explicitly alongside the account
> deletion. See [`../analytics/product-analytics.md`](../analytics/product-analytics.md) §Privacy & retention.

---

## 8. AI invocation ledger

| Model | Owning subsystem | Classification | Exported | User deletion | Tenant deletion | Retention | Log/metadata safe |
|---|---|---|---|---|---|---|---|
| `AiInvocation` (feature, model, promptVersion, status, latencyMs, token counts, estimatedCostUsd, errorMessage, userId?, articleId?) | AI | **operational** (metadata only — prompts/responses never stored) | ⛔ | **Not cascading** — `userId`/`articleId` are plain string refs. Call `deleteAiInvocationsForUser` explicitly when erasing a user's data | Not applicable | Configurable via `AI_LEDGER_RETENTION_DAYS` (default 365 days). Prune with `pruneOldAiInvocations` (`src/lib/ai/retention.ts`) | `errorMessage` is scrubbed via `redactSensitiveValue` before persistence; safe. Other fields (feature, status, counts) are safe |

> **#712-A resolved:** `pruneOldAiInvocations` (time-based retention, env:
> `AI_LEDGER_RETENTION_DAYS`, default 365 days) and `deleteAiInvocationsForUser`
> (GDPR Article 17 per-user erasure) added in `src/lib/ai/retention.ts`.
> Neither runs automatically — wire to a scheduled job or CLI script.

---

## 9. Audit logs

| Model | Owning subsystem | Classification | Exported | User deletion | Tenant deletion | Retention | Log/metadata safe |
|---|---|---|---|---|---|---|---|
| `AuditLog` (action, actorId?, actorRole?, targetType, targetId?, metadata, requestId, ipAddress, userAgent) | Security | **operational** | ⛔ | **Not cascading** — actor/target ids are plain string refs; the investigation trail is intentionally preserved after entity deletion | Not applicable | Configurable via `AUDIT_LOG_RETENTION_DAYS` (default 730 days / 2 years for regulatory compliance). Prune with `pruneOldAuditLogs` (`src/lib/security/audit.ts`) | `metadata` is sanitized via `sanitizeAuditMetadata` (uses `isSensitiveMetadataKey` + `redactSensitiveValue`); `ipAddress` and `userAgent` are retained for forensics |

> **#712-B resolved:** `pruneOldAuditLogs` added to `src/lib/security/audit.ts`.
> Default retention is **730 days (2 years)** to cover common regulatory
> frameworks (PCI-DSS, SOC 2, GDPR legitimate-interest). Override via
> `AUDIT_LOG_RETENTION_DAYS`. Do NOT reduce below 90 days without a
> legal/compliance review. The helper does not run automatically.

---

## 10. Security events

| Store | Owning subsystem | Classification | Exported | User deletion | Tenant deletion | Retention | Log/metadata safe |
|---|---|---|---|---|---|---|---|
| In-memory ring buffer (`src/lib/security/events.ts`) | Security | **operational** | ⛔ | Not applicable (in-memory) | Not applicable | **Ephemeral** — bounded ring buffer (default 200 events, max 2 000, `SECURITY_EVENT_BUFFER_SIZE`). Lost on process restart | `meta` is scrubbed via `scrubContext` before the event is stored; article text, tokens, cookies cannot reach the buffer |

> For durable security history, forward the structured `security.event` log
> lines to a SIEM/log pipeline. See [`overview.md`](./overview.md) §3.

---

## 11. Media assets

| Model / store | Owning subsystem | Classification | Exported | User deletion | Tenant deletion | Retention | Log/metadata safe |
|---|---|---|---|---|---|---|---|
| `ArticleSpeech` (voice, format, mimeType, audioBase64?, storageKey?, plainText, words) | Speech / Media | **public** (article-scoped; served only to authenticated readers) | ⛔ | Cascade via article (`ArticleSpeech.articleId`) | Cascade via article | Deleted with article | `plainText` contains article narration text; do not log. `storageKey` is a content-addressed key (safe to log as an id) |
| `MediaAsset` (storageKey, kind, mimeType, sizeBytes, checksum, durationSec, voice, format) | Media | **public** (operational pointer; no user content) | ⛔ | Cascade via `MediaAsset.articleId` | Cascade via article | Deleted with article; object-storage bytes are not automatically purged by DB cascade (see [`../media/storage.md`](../media/storage.md)) | Safe |

> **Gap #711-D — RESOLVED (#711):** `deleteOwnAccount` and `deleteMember` now
> query `MediaAsset.storageKey` for articles owned by the user before the DB
> cascade, then call `storage.delete()` on each key after a successful
> transaction (best-effort via `Promise.allSettled` — storage failure does not
> abort the deletion). Implemented in
> `src/lib/account-lifecycle/account-commands.ts` and
> `src/lib/account-lifecycle/member-commands.ts`.

---

## 12. Background jobs and processing

| Model | Owning subsystem | Classification | Exported | User deletion | Tenant deletion | Retention | Log/metadata safe |
|---|---|---|---|---|---|---|---|
| `Job` (type, status, payload, attempts, errors, lockedBy, timestamps) | Operations | **operational** | ⛔ | **Not cascading** — `payload` ids are plain string refs; jobs survive entity deletion | Not applicable | Terminal rows (`COMPLETED`, `DEAD_LETTER`) prunable via `pruneTerminalJobs` (`src/lib/jobs/retention.ts`, env: `JOB_TERMINAL_RETENTION_DAYS`, default 90 days) | `lastError` / `errorHistory` may contain error text; apply redaction before surfacing in UI |
| `ArticleProcessingStep` (step, status, modelName, promptVersion, lastError) | Operations / AI | **operational** | ⛔ | Cascade via article (`ArticleProcessingStep.articleId`) | Cascade via article | Deleted with article | `lastError` is metadata only; must not contain prompt/response content per schema comment |

> **#712-C resolved:** `pruneTerminalJobs` added in `src/lib/jobs/retention.ts`.
> Deletes `COMPLETED` and `DEAD_LETTER` rows where `updatedAt < cutoff`. Default
> window is 90 days (env: `JOB_TERMINAL_RETENTION_DAYS`). The `statuses`
> parameter lets operators prune a subset (e.g. `DEAD_LETTER` only). Does not
> run automatically — wire to a scheduled job or CLI script.

---

## 13. Org, classroom, membership, and assignment data

| Model | Owning subsystem | Classification | Exported | User deletion | Tenant deletion | Retention | Log/metadata safe |
|---|---|---|---|---|---|---|---|
| `Organization` (name, slug, settings) | Access / Tenancy | **operational** | ⛔ | Not user-owned | Self (manual delete) | Indefinite | `settings` is free-form metadata; may contain tenant branding config; apply redaction |
| `Membership` (userId, orgId, role) | Access / Tenancy | **personal** | ✅ orgId, role, timestamps | Cascade via `Membership.userId` or `Membership.orgId` | Cascade via `Membership.orgId` | Deleted with user or org | Safe |
| `Classroom` (orgId, name, teacherId) | Access / Tenancy | **operational** | ⛔ | Teacher link cascades via `Classroom.teacherId`; classroom deleted if teacher deleted | Cascade via `Classroom.orgId` | Deleted with org | Safe |
| `ClassroomMembership` (classroomId, userId, role) | Access / Tenancy | **personal** | ✅ classroomId, role, createdAt | Cascade via `ClassroomMembership.userId` or classroom | Cascade via classroom → org | Deleted with user or org | Safe |
| `Assignment` (classroomId, articleId, dueDate, instructions) | Access / Tenancy | **operational** | ⛔ | `instructions` may reference a deleted article; article cascade removes assignment | Cascade via classroom → org | Deleted with classroom | `instructions` is teacher-authored text; avoid logging |
| `AssignmentCompletion` (assignmentId, studentId, status, quizScore, completedAt) | Access / Tenancy | **personal** | ✅ assignmentId, status, quizScore, completedAt, timestamps | Cascade via `AssignmentCompletion.studentId` | Cascade via assignment → classroom → org | Deleted with user or org | Safe |

> **Gap #711-E — RESOLVED (#711):** Membership, classroom enrollment, and
> assignment completion records are now included in the `exportUserData` bundle.
> See `src/lib/account-lifecycle/account-commands.ts`.

---

## 14. Push subscriptions

| Model | Owning subsystem | Classification | Exported | User deletion | Tenant deletion | Retention | Log/metadata safe |
|---|---|---|---|---|---|---|---|
| `PushSubscription` (endpoint, p256dh, auth, failureCount, lastSuccessAt, lastFailureAt) | Push notifications | **sensitive** | ⛔ | Cascade via `PushSubscription.userId` | Not affected | Pruned on 404/410 response from push endpoint; additional pruning via `failureCount` tracking (`src/lib/push/subscription-health.ts`) | No — `p256dh` and `auth` are cryptographic keys; `endpoint` contains a provider-specific URL; must never appear in logs |

---

## 15. Rate-limit counters

| Model | Owning subsystem | Classification | Exported | User deletion | Tenant deletion | Retention | Log/metadata safe |
|---|---|---|---|---|---|---|---|
| `RateLimitCounter` (bucketKey, windowStart, count, expiresAt) | Security | **operational** | ⛔ | Not user-FK-linked; `bucketKey` encodes scope (e.g. `u1:ai`) | Not applicable | `expiresAt`-based; best-effort sweep prunes stale rows | `bucketKey` may encode a userId fragment; do not log full key in user-visible error responses |

---

## 16. Client-side offline stores (not in DB schema)

| Store | Owning subsystem | Classification | Exported | User deletion | Tenant deletion | Retention | Log/metadata safe |
|---|---|---|---|---|---|---|---|
| IndexedDB `readwise-offline` — article cache (article content, metadata) | Reader / Offline | **personal + sensitive** | ⛔ — client-side only | Cleared by service-worker cache eviction, browser storage pressure, or SW upgrade; NOT cleared by server-side account deletion | Not applicable | Until SW cache version bump (`SW_CACHE_VERSION`) or browser eviction | `content` is article text; must not be transmitted to server outside authenticated API calls |
| IndexedDB `readwise-offline` — mutation queue (pending progress/highlight/quiz sync payloads) | Reader / Offline | **personal** | ⛔ — client-side only | Not cleared by server-side account deletion | Not applicable | Until flushed or permanently failed (`MAX_MUTATION_RETRIES = 5` retries) | Payloads are JSON bodies for API endpoints; do not log body content |

> **Gap #711-F:** Server-side account deletion does not clear client-side
> IndexedDB stores. If a device is subsequently accessed by a different user
> (shared device), residual offline data may be visible. The PWA service worker
> must clear the offline cache on sign-out. Track as a follow-up.

---

## Summary of follow-up gaps

| # | Gap | Severity | Status |
|---|---|---|---|
| 711-A | `ReminderPreference` not in export bundle | Low | ✅ Resolved (#711) — added to export |
| 711-B | `SavedWord.contextSentence` has no selective erasure path | Medium | Follow-up — cascade on user deletion is sufficient for full-account deletion; selective erasure for GDPR Art. 17 partial requests is a dedicated task |
| 711-C | `LevelHistory`, `WordMastery`, `ArticleMastery`, `SkillMastery`, `ArticleDifficultyFeedback` not in export | Medium | ✅ Resolved (#711) — all added to export |
| 711-D | Object-storage bytes not purged on `MediaAsset` DB cascade | Medium | ✅ Resolved (#711) — best-effort purge in `deleteOwnAccount` and `deleteMember` |
| 711-E | Membership, classroom, assignment completion not in export | Low | ✅ Resolved (#711) — added to export |
| 711-F | Client-side IndexedDB not cleared on server-side account deletion | Medium | Follow-up — PWA service worker must clear offline cache on sign-out; tracked separately |
| 712-A | `AiInvocation` has no retention window or per-user erasure helper | High | ✅ Resolved (#712) — `pruneOldAiInvocations` + `deleteAiInvocationsForUser` in `src/lib/ai/retention.ts` |
| 712-B | `AuditLog` has no retention window | Medium | ✅ Resolved (#712) — `pruneOldAuditLogs` in `src/lib/security/audit.ts` (default 730 d, configurable via `AUDIT_LOG_RETENTION_DAYS`) |
| 712-C | `Job` dead-letter rows not automatically pruned | Low | ✅ Resolved (#712) — `pruneTerminalJobs` in `src/lib/jobs/retention.ts` (default 90 d, configurable via `JOB_TERMINAL_RETENTION_DAYS`) |

---

## Logging and metadata policy summary

The following data categories **must never** appear in structured logs, audit
metadata, analytics event properties, AI ledger records, or error context.
This is enforced at write time by `src/lib/security/redaction.ts` but **all
callers bear responsibility** for not passing raw values in the first place:

| Category | Examples | Redaction mechanism |
|---|---|---|
| Article text / content | `Article.content`, `Translation.content`, `SentenceTranslation.sourceText` | Sensitive key `content`; dropped by sanitizer |
| Selected / highlighted text | `Highlight.quote`, `SentenceTranslation.sourceText` | Sensitive key `select`, `text` |
| AI prompts and responses | `TutorMessage.content`, prompt strings | Sensitive keys `prompt`, `completion`, `response` |
| User private notes | `Highlight.note` | Sensitive key `text` |
| Credentials / tokens | `Account.access_token`, `Session.sessionToken`, `VerificationToken.token` | Sensitive keys `token`, `authorization`, `credential`, `key`, `secret` |
| Cookies | Session cookies | Sensitive key `cookie`, `session` |
| Email addresses | `User.email` | Inline `[email]` masking via `redactSensitiveValue` |
| Push crypto keys | `PushSubscription.p256dh`, `.auth` | Sensitive keys `key`, `auth` |
| AI context sentences | `SavedWord.contextSentence` | Sensitive keys `sentence`, `context` |
| Definitions / explanations | `VocabularyItem.explanation`, `GrammarExplanation.explanation` | Sensitive keys `definition`, `explanation` |
| Translations | `Translation.content`, `SentenceTranslation.translation` | Sensitive keys `translation`, `content` |
