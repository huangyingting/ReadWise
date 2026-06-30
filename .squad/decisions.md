# Squad Decisions

## 2026-06-29 — Decisions archive maintenance

Archived 22 decisions.md sections dated before 2026-06-22 plus 1 boundary sub-entry before 2026-06-22T02:29:36.866+00:00 to `decisions/archive/2026-06-29T02-29-36.866+00-00-older-than-2026-06-22.md` because the file was 89222 bytes, exceeding the 51200-byte hard gate. Undated sections were retained in place.

## Post-redesign features

> **Post-redesign rich features M10–M16 COMPLETE** — bookmarks, highlights/notes, AI tutor, sentence translation, quiz mastery, personalized feed, pronunciation practice.

---
## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
## 2026-06-22 — Wave Reviews, System Review, and Epic Wave Planning

### 2026-06-22T03-26-44: Wave-3 deep review delivered — 6 reviewers, 9 issues (#188–#196), all shipped as merged PRs (#197–#205); fixed 2 HIGH bugs (cloze answer leak, SW import privacy leak)
**By:** Squad-Coordinator
**References:** #188-#196, #197-#205

Third redesign wave (deep review). All six team members browser-reviewed the LIVE app (dev-browser/Playwright, seeded data, light+dark) focused on LESS-TRAVELED surfaces: command palette, search, import, tags, offline/PWA, error pages, settings/danger-zone, reader tool deep interactions, flashcard/cloze flows, loading states.

Two HIGH bugs fixed: (1) Cloze review LEAKED the answer — pronounce button showed+spoke the masked word before submission (#188/#197); (2) service worker omitted /import from AUTH_PATHS — private import list could be shared-cached and leaked to another user offline (#189/#198). Other fixes: import form inputs invisible (undefined .admin-input) + teal-token tabs → Input/Textarea/SegmentedControl (#190/#199); error/not-found family unified on EmptyState + authed-404 keeps shell (#191/#200); NEW /tags hub (listTagsWithCounts was dead code) + /tags/[slug] on PageShell + Topics nav entry (#192/#201); command-palette ghost ARTICLES header on zero results (#193/#202); reader dictionary popover overflow/focus/aria + 44px targets (#194/#203); RAI trust & clarity — typed-DELETE deletion, AiBadge, Privacy §4 (#195/#204); loading polish — reader skeleton, ArticleHero shimmer, SkeletonCard image slot (#196/#205).

Verified: typecheck clean, 565/565 tests pass, production build succeeds.

### 2026-06-22T08-24-58: Wave-4 review delivered — 6 reviewers, 5 issues (#210–#214), all shipped as merged PRs #215–#219; fixed multiple HIGH overlay/backend bugs
**By:** Squad-Coordinator
**References:** #210-#214, #215-#219

Fourth review wave. All six team members + Coordinator browser-reviewed the live app (dev-browser/Playwright, seeded data, light+dark), focused on deeper surfaces and the new full-page practice overlay.

HIGH bugs fixed: (1) Overlay focus-trap leaked because getTabbable counted focusables in hidden keep-alive panels — fixed with shared visibility-aware helper. (2) Browser/hardware Back exited the reader instead of closing the overlay — now pushes history + popstate closes. (3) Mic/audio kept running when tab was hidden or overlay closed. (4) Vocabulary auto-fired an AI request on every reader load — now empty. (5) Search returned zero for author/source/category terms (FTS early-exit before LIKE). (6) Feed pulled up to 1000 full article rows (~2.6s) — now content-free select + cap + per-user cache + DB-level filter.

Plus IA (Topics→Tags rename, Saved→Saved articles, reader Back origin from Notes/palette, dashboard Review-N-due CTA, Study reorder), AI transparency badges, and visual polish (deterministic card placeholder thumbnails, accessible progress charts, 44px swatches).

Verified: typecheck clean, 569/569 tests pass, build succeeds.

### 2026-06-22T11-42-09: System review (2 passes) delivered — 13 issues (#220–#226, #234–#239), shipped as merged PRs (#227–#233, #240–#245); fixed SSRF DNS-rebinding, private-import data exposure, client-trusted scores, timezone corruption, races; tests 569→666
**By:** Squad-Coordinator
**References:** #220-#226, #234-#239, #227-#233, #240-#245

Two-pass engineering system review (extensibility, robustness, observability + security/authz/data-integrity/correctness) — NO new features, only gaps/bugs. Team: Rusty (extensibility), Livingston (robustness/backend/authz/data-integrity), Linus (client/CLI + correctness/type-safety), Basher (observability + tests), Rai (logging privacy) + security-review agent + Coordinator. Test suite grew 569→666.

Pass 1: typed config module (#222), AI/speech/dictionary observability + feature labels + speech parse-guard/timeout (#220), backend robustness — saveProgress upsert race, SSRF redirect-hop validation, grammar rate-limit gap, worker poison quarantine (#221), shared cache-first AI abstraction (#223), client robustness — shared client-fetch + reader error boundaries + abort/race fixes (#224), logging privacy — URL/PII redaction + closed RequestContext type + global-error throttle (#225), critical-path tests (#226).

Pass 2 (deeper security/correctness): HIGH SSRF DNS-rebinding closed by IP pinning via undici dispatcher (#234); data-exposure — user-delete publishing private imports + bookmarks/lists bypassing article visibility (#235); import dedup unique constraint + migration (#236); server-side quiz grading + pronunciation clamp/rate-limit (#237); timezone bugs corrupting activity count/streak (#238); transactional last-admin guards + activity write + ai-cache type constraint (#239).

Security review verified NO IDOR/SQLi/stored-XSS/auth-bypass/open-redirect. Verified: typecheck clean, 666/666 tests pass, production build succeeds.

### 2026-06-22T23-40-45: Open epic delivery waves and immediate Wave 1 split
**By:** Rusty
**References:** #246-#258, #266-#267, #289, #293, #313, #316, #322, #324

Deliver the open ReadWise epics in dependency-led waves. Wave 1 is a low-risk safety/instrumentation foundation before the large PostgreSQL/job/rate-limit migrations: #324 ADR scaffold, #322 config validation, #293 health/readiness semantics, #289 initial core metrics, #266 centralized article access service, #267 IDOR regression tests, #316 security regression coverage, and a thin #313 Playwright critical-flow smoke slice.

Deferred to Wave 2 (after guardrails are green): #259 PostgreSQL, #260 explicit visibility/status/source type, #261 private lifecycle schema hardening, #270 audit logs, #271 persistent job table, #277 AI ledger, #284 shared rate limiting.

Rationale: The open P0 epics are tightly coupled. Starting with observable safety rails and access/test contracts reduces regression risk before high-churn schema, queue, and distributed-infrastructure work. Keeps each PR reviewable, gives Basher/Rai security gates before auth/data mutations expand, gives Livingston/Linus stable contracts for later waves.

---

## 2026-06-23 — Wave 2 Planning, Gate Checklist, Multi-tenancy, ReadingX

### 2026-06-23T00-39-08: Wave 2 merge-safe lane plan for issues #259 #260 #261 #262 #263 #264 #265 #268 #270 #314 #323
**By:** Rusty
**References:** #259, #260, #261, #262, #263, #264, #265, #268, #270, #314, #323

Recommended Wave 2 plan with merge-safe lanes:

1. **DB foundation lane** — #323, #259, #314. Owner: Livingston. Reviewers: Rusty (architecture), Basher (validation).
2. **Article access model lane** — #260, #261, #268. Owner: Livingston. Reviewer: Rusty; Basher for auth/privacy tests; Rai privacy/security review. Merge order: #260 → #261 → #268.
3. **Audit/security lane** — #270. Owner: Livingston with Linus for admin audit UI/export.
4. **Search/performance lane** — #265, #263. Owner: Livingston. Merge order: #265 → #263.
5. **Native JSON cleanup lane** — #262. Owner: Livingston. Depends on PostgreSQL foundation.
6. **Ops runbook lane** — #264. Owner: Rusty, with Livingston/Basher. Final, after #259/#323.

Dependencies: First merge #323/#259/#314; then article access lane in strict order; after #260 merged, #270 can merge; after foundation+visibility stable, merge #265 then #263; #262 after #314; #264 last.

Split/spike recommendations: #259 too large — split into migration spike/RFC first; #260 also large/risky — split design/migration plan first; #265 should begin as strategy spike; #263 should not start until #260/#265 queries are known.

### 2026-06-23T03-58-22: Gate checklist for final PostgreSQL provider flip (#259)
**By:** Rusty
**References:** #259, #314, #263, #323

Prerequisites after #314/#263/#323: PostgreSQL integration CI is required and green; schema parity test still passes with only provider diff; PostgreSQL migrations apply from empty DB and include privacy, audit, JSONB, sourceUrl+owner uniqueness, FTS/search indexes; local compose Postgres+Redis flow documented and works.

Validation: npm ci; npm run typecheck; npm run lint; npm test; docker compose up -d postgres redis; export DATABASE_URL=postgresql://...; npx prisma generate; npx prisma migrate deploy; npm run test:db; npm run build; container starts and /api/ready is green; smoke admin/login/list/search/reader/settings/study/import/worker.

Rollback: pre-flip SQLite backup and Postgres dump; pause workers during cutover; code-only failure redeploy previous image; data/corruption restore dump and repoint DATABASE_URL.

Reviewers: Livingston owns schema/migrations/runtime; Basher owns CI/test/db dry run; Linus quick smoke; Saul optional UX smoke; Rai reviews secret/PII handling; Rusty final architectural approval.

Red flags: PR relies on PRISMA_SCHEMA_PATH to hide wrong default; postinstall generates SQLite client; Docker generate schema differs from entrypoint migrate schema; CI still defaults to SQLite only; SQLite FTS or file: URLs remain in production docs.

Recommendation: one focused #259 PR if #314/#263/#323 are merged and green. Split only if the SQLite data migration tooling/runbook is not already done.

### 2026-06-23T04-39: Multi-tenancy / classroom foundation (Epic RW-E012, #257)
**By:** Livingston
**References:** #257, #318, #319, #320, #321, PR #356

Shipped ONE CI-green PR #356 closing #318 (RW-060), #319 (RW-061), #320 (RW-062), #321 (RW-063) on branch `squad/318-multi-tenancy`.

Design decisions: Tenancy is additive & nullable (`organizationId == null` = global/public; any user with no Membership keeps exact pre-tenancy single-user experience). `Article.organizationId` is a soft non-FK TEXT scalar (mirrors AnalyticsEvent/AuditLog convention), so SQLite migration is a clean `ALTER TABLE ADD COLUMN` with FTS5 triggers untouched. PG keeps it as plain indexed TEXT. Tenant roles live in `Membership` rows and resolve through the same `rbac.ts` capability table as global roles. Cache public listing keys UNCHANGED; `tenantCacheKeyParts` appends `org:<id>`/`user:<id>` only for org/user scopes to prevent cross-org leaks.

Models added (BOTH schemas + BOTH migration dirs): Organization, Membership, Classroom, ClassroomMembership, Assignment, AssignmentCompletion; enums MembershipRole/ClassroomRole/AssignmentStatus; soft `Article.organizationId` + index.

Local gate (all PASS): npm ci · prisma generate · typecheck · lint · npm test (1215 pass / 0 fail / 16 skip; +42 new tenancy tests) · prisma migrate deploy (ci.db) · npm run build · prisma validate (SQLite + PostgreSQL).

CI (all green): Unit tests, Fast checks (typecheck+lint), PostgreSQL Migrate/Integration, Build, CI summary.

### 2026-06-23T13-49-37: ReadingX incremental-integration backlog completed via PR-based squad integration
**By:** Scribe
**References:** #359-#378, #380-#384, e4e1cbb, 2d4e998, b4bf07a, c51dca0, e622b3b

Ralph coordinated the full ReadingX incremental-integration backlog using background specialist agents and PR-based merges into `main`. Livingston completed backend epics #359, #366, and #370 through PRs #381-#383, including #360/#380 URL extractor contract work; Linus completed frontend epic #375 through PR #384; Ralph landed the `instrumentation.ts` Edge-bundle tracing guard as housekeeping commit `e622b3b`. All 21 tracked issues are closed.

Each PR passed Fast checks, Unit tests, Build, and PostgreSQL Migrate before squash-merge. Final `main` verification: `npm run typecheck` passed, `npm test` reported 1436 pass / 0 fail / 16 skip.

Decision: treat this backlog as complete and use the PR-based wave pattern as the reference integration approach for similar multi-epic ReadingX work.

---
## 2026-06-25 — Codebase Quality Audit & Epic #610

### 2026-06-25T23-23-23: Created refactoring/quality epic #610 + 15 child issues (#611–#625) from a five-domain codebase audit
**By:** Squad-Coordinator
**References:** #610, #611-#625

Requested by Yingting Huang: run a repeated (10x) domain-by-domain quality audit, consolidate, and document as a GitHub epic + issues. Themes: modularization, reusability, subsystem separation, extensibility, readability, merging duplicate code, removing outdated/compat code, splitting large files, eliminating redundant compat layers.

Each domain expert (Rusty/architecture, Saul/design, Linus/frontend, Livingston/backend, Basher/testing) performed an exhaustive 10-pass sweep of their own domain. This produced 79 grounded findings (ARCH 15, DSGN 14, FE 16, BE 18, TEST 16). Rusty (Lead, opus-4.8) consolidated all 79 findings into 15 right-sized, PR-scoped child issues across 3 phases, deduping cross-domain corroborations.

**Phase 1 Foundations:** #611 p0 dark-mode/WCAG (Saul), #612 AI consolidation (Livingston), #613 lib dependency inversion (Rusty), #614 test shared-helper adoption (Basher).

**Phase 2 Core refactors:** #615 (Saul), #616–#617 (Linus), #618 (Basher), #619–#621 (Livingston).

**Phase 3 Cleanup/splits:** #622 (Livingston), #623 (Saul), #624 (Linus), #625 (Basher).

Owners assigned via squad:* labels: Rusty (#613), Saul (#611, #615, #623), Linus (#616, #617, #624), Livingston (#612, #619, #620, #621, #622), Basher (#614, #618, #625).

Non-goals enforced per AGENTS.md: no behavior changes, no new compat layers for superseded shapes, preserve AI/Speech/Push/OAuth/storage graceful fallbacks, keep SQLite/PG parity, no secret/PII logging. Analysis only — no source code modified this session.

Session artifacts: files/findings-{architecture,design,frontend,backend,testing}.md, files/consolidated-plan.md.

---
## 2026-06-26 — Round-2 Codebase Quality Audit & Epic #626

### 2026-06-26T01-04-57: Round-2 audit: created epic #626 + 13 child issues (#627-#639), follow-up to #610; 67 new findings, p0 sensitive-key redaction privacy leak
**By:** Squad-Coordinator
**References:** #626, #610, #627, #628, #629, #630, #631, #632, #633, #634, #635, #636, #637, #638, #639

Second-wave (round 2) codebase quality audit, follow-up to epic #610. Each domain expert (Rusty/architecture, Saul/design, Linus/frontend, Livingston/backend, Basher/testing) ran a fresh 10-pass sweep instructed to find NEW, non-overlapping issues (each read their round-1 findings + issues #611-#625 to avoid duplicates), targeting subsystems/angles round 1 under-covered. Result: 67 new findings (ARCH2 11, DSGN2 14, FE2 12, BE2 15, TEST2 15), all confirmed zero-overlap with #610.

Standout cross-domain corroboration: Rusty (ARCH2-2) and Livingston (BE2-1) independently flagged divergent sensitive-key redaction across audit.ts/errors.ts/analytics sanitize.ts with gaps in both directions (audit misses prompt/content/text; errors misses email/url) — a real privacy leak and AGENTS.md violation. Made the single highest-priority issue (p0). Also corroborated: runtime-config env scattering (ARCH2-3 + BE2-2/3).

Rusty (Lead, opus-4.8) consolidated 67 findings into 13 right-sized child issues across 3 phases, each finding covered exactly once, every HIGH covered. Two p0s: #627 redaction primitive, #628 flashcard effect-deps correctness bug.

Deliverables on huangyingting/ReadWise (main), cross-linked to #610:
- Epic #626 (type:epic, security/privacy/architecture/quality labels).
- Phase 1: #627 (p0, Rusty), #628 (p0, Linus), #629 (Livingston), #630 (Saul), #631 (Saul), #632 (Rusty).
- Phase 2: #633 (Linus), #634 (Livingston), #635 (Livingston), #636 (Basher), #637 (Basher).
- Phase 3: #638 (Livingston, deps #627), #639 (Basher).
- Owners via squad:* labels (Rusty 2, Saul 2, Linus 2, Livingston 4, Basher 3).

Non-goals enforced per AGENTS.md: no behavior changes, no new compat layers, preserve provider graceful fallbacks, SQLite/PG parity, no secret/PII logging. Analysis only — no source modified. Artifacts: files/findings-{architecture,design,frontend,backend,testing}-r2.md, files/consolidated-plan-r2.md.


### DECIDED — Scraper provider cleanup hardening finalization
_Recorded by Scribe · 2026-06-28_
**What:** Generic scraper cleanup is now guarded so unknown providers do not receive provider-specific generic cleanup, while known provider cleanup remains hardened for newsletters, get-latest widgets, CTA/social chrome, duplicate candidates, and provider-specific prose regressions.
**Why:** The team found and fixed over-removal risks during review. Final independent code review reported no correctness issues, security review found no vulnerabilities, and full scraper verification passed.
**Merged inbox:** `decisions/inbox/Livingston-apply-generic-scraper-chrome-cleanup-to-every-prov.md`, `decisions/inbox/basher-scraper-cleanup-verification.md`.
**Validation:** focused cleaned-HTML/cleanup tests passed; full scraper suite passed 336/336; typecheck passed; eslint on changed files passed; `git diff --check` passed.

## 2026-06-27 to 2026-06-28 — Decision inbox merge (processed 2026-06-29T02:29:36.866+00:00)

Processed 23 inbox files into 22 deduplicated decision summaries; full raw entries archived at `decisions/archive/2026-06-29T02-29-36.866+00-00-processed-inbox.md`. Duplicate summaries skipped: 1.


### 2026-06-27: Decision Record — #807 Today v1.1 Comprehension Feedback & Quiz Remediation
**By:** ** Linus (Frontend Dev)
**References:** ** #807 — Lightweight comprehension feedback and quiz remediation loop; PR #828
**Source:** decisions/inbox/linus-807-comprehension.md
**Decision summary:** A low-pressure post-reading comprehension self-check that completes the Today comprehension step without a full article quiz, plus a gentle remediation loop, feeding structured weakness signals into the existing mastery system. 1. After readingCompletedAt, the Today page offers an optional self-check: a single self-rating (confident/partial/confused) + zero or one lightweight MCQ drawn from the article's existing QuizQuestion rows (most recently added; tag-agnostic since the schema carries no per-question tag). 2. Self-rating alone advances comprehensionCompletedAt — no forced quiz. 3. Wrong MCQ answer → remediation card with "Go back to the article" deep-link (non-AI; remediationViewed flag persisted). 4. W…


### 2026-06-27: Decision — #808 Weak-word re-exposure (Today v1.1)
**By:** ** Livingston (Backend Dev)
**References:** ** #808 — Use weak-word re-exposure in recommendations and Today explanations.; PR #823
**Source:** decisions/inbox/livingston-808-weak-word.md
**Decision summary:** (deterministic, no AI) 1. Recommendation scoring booster - context.ts: new weakWordArticleIds map (candidate articleId → distinct weak-word count) built from WordMastery.sourceArticleIds for low-familiarity words (familiarity < WEAK_WORD_FAMILIARITY_MAX = 0.5). Intersected with the candidate set; ids/counts only, no word text. - scoring.ts: weakWordReexposureSignal + capped bonus folded into base score. Saturates at WEAK_WORD_REEXPOSURE_TARGET = 3, capped at WEAK_WORD_REEXPOSURE_MAX_POINTS = 8 (of 100). Soft nudge, not a hard filter; no-op when no weak words. ScoredRecommendation.weakWordReexposure carries {count, score, points}. - Kept the 7-component ScoreComponents/explanation-line contract intact (added…


### 2026-06-27: Decision — #810 Privacy-Safe Learning Coach Memory (increment 1)
**By:** ** Livingston (Backend Dev)
**References:** ** #810 — Explore privacy-safe learning coach memory for Tutor and Study Plan; PR #827
**Source:** decisions/inbox/livingston-810-coach-memory.md
**Decision summary:** (increment 1, schema already merged in #826) - src/lib/learning/coach-memory.ts (new): the single owner of LearnerCoachMemory reads/writes. - upsertCoachMemory(userId, input) — allowlist privacy guard (only skill/confidence/observedAt; any other key → typed CoachMemoryPrivacyError). EMA confidence blend (alpha 0.3), evidenceCount capped at 100, trend recompute ("improving"/"stable"/"declining", delta 0.05). Unknown skill keys silently dropped (returns null). - buildTutorContext — bounded (≤200 token est., ≤6 lines) plain-text aggregate summary; weakest-first; stale (>90d) entries down-weighted 50%. Returns "" on cold start. - listCoachMemory, coachMemorySkillConfidences (stale-weighted map; empty map = fallb…


### 2026-06-27: Decision — #812 Review assets from highlights & notes (Today v1.1)
**By:** ** Linus (Frontend Dev)
**References:** ** #824 (MERGED into main, squash, branch deleted) — Closes #812
**Source:** decisions/inbox/linus-812-review-assets.md
**Decision summary:** Concrete, low-risk first increment of #812. No schema change. 1. Highlight/note → review card (reused flashcard/SRS). convertHighlightToReviewCard(userId, highlightId) in src/lib/learning/review-assets.ts reuses the EXISTING flashcard store (SavedWord + SM-2): passage = card front (word, capped 200 chars, used as the idempotency key), note = back (explanation), full passage = context (contextSentence), plus articleId. Fresh card dueAt = null → immediately due in the normal review loop. Owner-scoped (no IDOR), idempotent (no schedule reset). Route: POST /api/highlights/{id}/review-card. 2. Aggregate, content-free Progress/Study counts. getReviewAssetSummary(userId) returns numbers only — totalHighlights, note…


### 2026-06-27: Decision — Goal Paths (#809) increment 1
**By:** ** Livingston (Backend Dev)
**References:** ** #809 — [Learner Roadmap] Add Goal Paths for personalized reading strategy; PR #831
**Source:** decisions/inbox/livingston-809-goalpath.md
**Decision summary:** Increment 1 of Goal Paths: an optional, controlled Profile.goalPath ("daily_news" | "academic" | "business" | "exam" | "extensive" | null) that tunes recommendations + Today copy deterministically (NO AI). Profile.goalPath was already on main (#806 merge); no base.prisma change. - src/lib/learning/goal-path.ts (new): GOAL_PATHS + isGoalPath; tuning constants table (max length, preferred CEFR band + overshoot tolerance, topic boosts, comprehension copy key per path); pure applyGoalPathAdjustment (additive nudge capped ±0.2 in normalised 0–1 score units); goalPathDelta, goalPathCandidateFits, resolveEffectiveGoalPath (starvation guard). - RecommendationContext gains goalPath (loaded from Profile in context.ts)…


### 2026-06-27: Decision — Today Session P3 (learner UI, API & routing)
**By:** ** Linus (Frontend Dev)
**References:** ** #816 — **MERGED** to `main` (squash commit `9d9f129`)
**Source:** decisions/inbox/linus-today-p3.md
**Decision summary:** A single vertical slice on top of the merged P1 (#814) / P2 (#815) domain service, all gated by FEATURE_TODAY_SESSION_ENABLED (default on; isTodaySessionFeatureEnabled() in src/lib/runtime-config/feature-flags.ts): - #797 API (src/app/api/today/): GET /api/today (privacy-safe view-model summary, optional validated timezone query → 400 on over-long input); POST /api/today/skip (controlled skipReason, 1/day limit, 400 on invalid). Reused the pre-existing POST /api/today/read-complete — not duplicated. All routes user-scoped (never a body id), 404 when flag off. API catalog regenerated. - #796 /today (src/app/(app)/today/page.tsx + _components/TodayWorkflow.tsx + src/lib/engagement/today-session/view-model.ts):…


### 2026-06-27: Decision — Today v1.1 Offline Mutation Support (#811)
**By:** ** Linus (Frontend Dev)
**References:** ** #830 — MERGED (squash) into `main` (merge commit `2c8ddb4`)
**Source:** decisions/inbox/linus-811-offline.md
**Decision summary:** Extended the client-only offline mutation queue (IndexedDB) to cover Today Session step actions. No Prisma/schema change. Added pure helpers: buildTodayIdempotencyKey, isTodayMutationType, isValidLocalDate, isValidTimezoneString, isAllowedTodayPayload, TODAY_ENDPOINT_BY_TYPE, TODAY_OFFLINE_PAYLOAD_FIELDS. todayMutationReplayHandler: validate localDate/tz + allowed-fields → POST; 2xx→remove; 409→conflict status + content-free today_offline_conflict event; network/5xx/408/429→retry with existing back-off; invalid/content payload→failed without sending; other 4xx→permanent fail. Added conflict MutationStatus (offline-sync.ts), a Today conflict pub/sub (subscribeTodayConflicts), and a conflict-aware Today drain…


### 2026-06-27: Decision: Clean-capture pipeline integration into the scraper
**By:** ** Rusty (Lead/Architect)
**References:** ** #841 (squash-merged into main)
**Source:** decisions/inbox/rusty-scraper-integration.md
**Decision summary:** Rewired src/lib/scraper/extract.ts extractArticle() body step to use the merged extractReadable (linkedom + @mozilla/readability) and declutterArticleHtml modules, with a content-preserving fallback and a new SCRAPER_READABILITY kill-switch (default ON). 1. legacyBody = JSON-LD articleBody (via paragraphsToHtml) when present, else the raw <p> harvest (extractBodyHtml). 2. When scraperReadability() is true, readable = extractReadable(cleanedHtml, sourceUrl) — uses the cleaned, NOT normalized HTML so Readability sees full structure. 3. Body choice (never lose content): - JSON-LD articleBody is canonical structured text → always kept. Readability never overrides it. - For the raw-<p> path, Readability wins unle…


### 2026-06-27: Decision: Extend category taxonomy + first-class provider↔category mapping
**By:** Livingston (Backend Dev)
**References:** See source archive.
**Source:** decisions/inbox/livingston-extend-categories.md
**Decision summary:** Extended the canonical article category taxonomy from 9 → 13 by adding environment, history, travel, ideas, and made the provider↔category relationship first-class via an optional categories?: string[] field on the Provider interface. - Added 4 entries to CATEGORIES: environment ("Environment", after science), history ("History"), travel ("Travel"), ideas ("Ideas") (history/travel/ideas placed after culture, before entertainment). - Added matching CATEGORY_COLORS gradients: - environment #22c55e→#15803d (green) - history #b45309→#78350f (amber/brown) - travel #06b6d4→#0e7490 (cyan) - ideas #a855f7→#7e22ce (violet) - isValidCategorySlug/humanizeCategorySlug/categoryGradient unchanged (all derive from CATEGORI…


### 2026-06-27: Decision: Learner v1.1 — Lightweight Reading Placement (#806)
**By:** ** Rusty (Lead/Architect)
**References:** ** #806 — closed via PR body `Closes #806`
**Source:** decisions/inbox/rusty-806-placement.md
**Decision summary:** (phases 1–3) 1. Pure scorer src/lib/learning/placement.ts - computePlacementScore(seedLevel, correct, total, lookups, wordCount) → recommendedLevel (A1–C1). - Deterministic, conservative bucketing evaluated DOWN-first so heavy vocab pressure (lookupRate ≥ 0.1) can never be masked by a high correct ratio. Guards non-positive total (→ down) and wordCount (→ lookupRate 0). No Prisma. - Helpers: seedLevelForProfile (maps any CEFR level → A2/B1/B2 band), isPlacementSeedLevel. - Deviation (honest): the roadmap sketch listed computePlacementScore(correct, total, lookups, wordCount), but a recommended level is relative to the seed ("one above/below seed"), so seedLevel is a required first arg. Documented in code. -…


### 2026-06-27: Decision: Learner v1.1 — Reading Fluency Feedback & Curated Series (#813)
**By:** ** Livingston (Backend Dev)
**References:** ** Closes #813; PR #832
**Source:** decisions/inbox/livingston-813-fluency-series.md
**Decision summary:** (phases 1–3, deterministic, no AI) - computeFluencyTrend (pure, src/lib/engagement/reading-speed.ts): recent-5 vs prior-5 session moving-average WPM → improving | stable | declining | insufficient_data (<3 valid samples ⇒ insufficient, avgWpm null; delta threshold ±5%). Returns FluencyTrend { avgWpm, trend, sampleCount, levelFilter, categoryFilter }. - getFluencyTrend(userId, { level?, category?, windowDays? }) (reading-speed-repo.ts): on-demand gather → pure fn. NOT persisted, NOT cached server-side. - Progress fluency panel (progress/_sections/FluencySection.tsx), non-punitive framing; emits content-free fluency_trend_viewed ({trend, sampleCount, levelFilter}). - src/lib/engagement/series.ts: list public s…


### 2026-06-27: Decision: Multi-strategy scraper fetch fallback chain
**By:** ** Livingston (Backend Dev)
**References:** ** #845 — MERGED (squash, mergeCommit 7a55a7f). Branch `squad/scraper-fetch-strategies` deleted.
**Source:** decisions/inbox/livingston-fetch-strategies.md
**Decision summary:** Added a fallback chain to the SSRF-safe GET fetch (fetchHtml) so bot-blocked provider pages (Cloudflare/DataDome 401/403/429/451/503) can still be captured. fetchText (POST) unchanged. New module src/lib/scraper/fetch-strategies.ts (@server-only), wired into fetchHtml. Inspired by the fetch-url skill but implemented natively inside ReadWise's existing fetch — no external script vendored. 1. origin — existing default request, unchanged for 2xx pages (backward compatible). 2. browser-profile retry — rotating realistic UA + header sets, order: googlebot (first, backward-compat), desktop-chrome, desktop-firefox, desktop-safari, mobile-safari, bingbot. Desktop profiles add Accept, Accept-Language, Sec-Fetch-Mode:…


### 2026-06-27: Decision: RSS-feed discovery to restore 6 broken scraper providers
**By:** ** Linus (Dev)
**References:** ** #844 — MERGED (squash, merge commit 6b4bcf2). Branch `squad/scraper-rss-discovery` deleted.
**Source:** decisions/inbox/linus-rss-discovery.md
**Decision summary:** Add a shared rssUrlExtractor(feedUrls) helper in src/lib/scraper/providers/shared.ts generalizing the existing BBC RSS pattern. It fetches each feed via the injected ctx.fetch, parses with parseRssUrls, dedupes across feeds, caps at ~2x limit, and skips failing feeds gracefully. Wiring: - noema / technologyreview / undark / knowable: urlExtractor: rssUrlExtractor([feed]). - aeon / nautilus: try existing API extractor FIRST, fall back to RSS when the API yields nothing — preserves the aeon-graphql / wp-api modules + tests. - bbc.ts refactored to reuse the helper (no behavior change). Confirmed feeds: - aeon: https://aeon.co/feed.rss - nautilus: https://nautil.us/feed - noema: https://www.noemamag.com/?feed=no…


### 2026-06-27: Decision: Schema foundation for learner v1.1/v2 features
**By:** ** Livingston (Backend Dev)
**References:** ** #806, #807, #809, #810, #813 (Refs, not Closes — feature logic lands in later PRs); PR #826
**Source:** decisions/inbox/livingston-v1_1-schema.md
**Decision summary:** Single additive migration adding ALL new Prisma models/fields for six upcoming learner features, so feature-implementation PRs don't collide on prisma/base.prisma or migrations. Schema ONLY — models are unused until wired by later PRs (expected). Structured outcomes / ids / counts / controlled strings ONLY — no passage, article, answer, option, question, prompt, or note text; no PII. - PlacementResult (#806): userId @unique → 1:1 with User; cols passageArticleId, seedLevel, recommendedLevel, questionCount, correctCount, lookupCount, skipped, attempt, completedAt, timestamps. Cascades with user. - TodayComprehensionFeedback (#807): per Today session; todaySessionId & articleId & questionId are plain strings (…


### 2026-06-27: Decision: Today Session P1 — data & domain service
**By:** ** Livingston (Backend Dev)
**References:** ** #814 (MERGED to `main`, squash, branch deleted)
**Source:** decisions/inbox/livingston-today-p1.md
**Decision summary:** s 1. Single-source schema. Edited prisma/base.prisma only; regenerated both prisma/schema.prisma (SQLite) and prisma/postgresql/schema.prisma (PG) via npm run schema:generate. Hand-wrote both migrations to match existing format (JSONB in both engines; TEXT controlled columns, no enums). 2. Id arrays as Json (JSONB). SQLite Prisma has no scalar lists, so backupArticleIds / targetSavedWordIds are Json holding string ids only. Read path coerces via toIdArray() (drops non-strings). 3. Controlled strings, not enums. status (active|completed|skipped), source (resume|picks|none), completionTier (none|reading|comprehension| full), generationReasonCode (resume_in_progress|picks_primary|no_candidate), skipReason follo…


### 2026-06-27: Decision: Today Session P4 — read-complete route flag gap fix (#804)
**By:** Basher (Tester/QA)
**References:** #804 — rollout privacy & disabled-state regression coverage; PR #4
**Source:** decisions/inbox/basher-today-p4-regression.md
**Decision summary:** Added a minimal, surgical guard to src/app/api/today/read-complete/route.ts mirroring the skip route: if (!isTodaySessionFeatureEnabled()) throw new ApiError(404, "Not found"). No other behavior changed; business logic, routes, and IA are unchanged. Regression test tests/today-rollout-disabled.test.ts asserts 404 when off and a reachable 200 when on. - typecheck: clean - new tests: 9 pass (tests/today-rollout-disabled.test.ts + tests/today-rollout-privacy.test.ts) - full suite: 2745 pass / 0 fail / 22 skip - eslint: clean on touched files The /today page (notFound() gate) and DashboardTodayCard are .tsx/JSX and cannot be imported by the strip-types Node test runner. The page's gate reuses the same isTodaySes…


### 2026-06-27: Decision: Today v1.1 — set a readable article as today's primary (#805)
**By:** ** Livingston (Backend Dev)
**References:** ** #805 (Learner Roadmap v1.1); PR #821
**Source:** decisions/inbox/livingston-today-v1_1-set-article.md
**Decision summary:** Learners can override the generated Today primary with a readable article of their own choosing. Everything is gated on isTodaySessionFeatureEnabled(). - setTodayPrimaryArticle({ user, articleId, requestTimezone }). - Reuses Article Library policy (getReadableArticleById) — NOT hand-rolled. - Another user's PRIVATE / missing article → SetTodayArticleError("not_found") (IDOR-safe, no existence leak). - Only PUBLISHED settable; PROCESSING/FAILED/other non-ready → SetTodayArticleError("not_ready") with clear message. - Swaps primaryArticleId, sets source = "user_selected" (new value in TODAY_SESSION_SOURCES; source is a String column → no migration). - Retains the replaced generated id by appending to backupArt…


### 2026-06-27: Today Session P2 — Completion integrations (epic #784; #792/#793/#794/#795)
**By:** Livingston (Backend Dev) · Date: 2026-06-27
**References:** See source archive.
**Source:** decisions/inbox/livingston-today-p2.md
**Decision summary:** One cohesive feature branch squad/today-session-p2-completion implementing the completion tier engine + three completion sources that feed it, built on the P1 domain service. New module src/lib/engagement/today-session/completion.ts (server-only) with a pure tier core + idempotent marker commands, re-exported from the barrel. Controlled tier values reused from P1 types.ts: none | reading | comprehension | full. - none — reading not complete. - reading — readingCompletedAt set. - comprehension — reading + comprehensionCompletedAt (the "standard" tier). - full — comprehension + wordReviewCompletedAt, only when resolvable target words exist. - No (resolvable) target words → comprehension is best-available and c…


### 2026-06-27: Today Session P4 — Analytics catalog & emit points (#802)
**By:** ** Livingston (Backend Dev)
**References:** See source archive.
**Source:** decisions/inbox/livingston-today-p4-analytics.md
**Decision summary:** Added 8 metadata-only Today product-analytics event types to the catalog and wired best-effort emit points across the Today domain (no new mechanism — all go through the existing recordEvent writer + sanitizer). - today_session_generated — { source, reasonCode, hasPrimary, backupCount, targetWordCount, reviewTargetCount } - today_no_candidate — { source, reasonCode } - today_session_viewed — { status, source, tier, hasPrimary, isNoCandidate, skipped } - today_reading_complete — { method, tier, hasTargetWords } - today_comprehension_complete — { tier } - today_word_review_complete — { tier, targetCount } - today_session_complete — { tier, source, hadTargetWords } - today_skip — { reasonCode, limitReached, bro…


### 2026-06-28: 2026-06-28T20-59-19: Shipped Knowable deep-dive/DOI citation-boilerplate filter (PR #859, MERGED to main)
**By:** ** Livingston
**References:** ** PR #859, PR #856, PR #857, PR #858, huangyingting, knowablemagazine.org
**Source:** decisions/inbox/Livingston-shipped-knowable-deep-dive-doi-citation-boilerplat.md
**Decision summary:** Filtered the residual Knowable noise the user flagged after #856/#857: the trailing "TAKE A DEEPER DIVE | Explore Related Scholarly Articles" rail and the article's own visible DOI string (e.g. 10.1146/knowable-042026-2). On real Knowable article pages, AFTER the real .fr-view body (outside it) the page renders two block-container boilerplate elements: - <section class="deep-dive"> (with nested <div class="deep-dive-header">) — the "TAKE A DEEPER DIVE / Related Scholarly Articles" rail listing OTHER journal articles' titles/abstracts (offset ~53.5k, body starts ~0.7k). - <div class="article-doi">10.1146/knowable-…</div> — the visible DOI citation (offset ~49.5k). Both are OUTSIDE .fr-view (confirmed .fr-view…


### 2026-06-28: Decision: Content-based HTTP-200 bot-challenge detection in fetch chain
**By:** ** Livingston (Backend Dev)
**References:** ** #846 (MERGED to main, squash, branch deleted)
**Source:** decisions/inbox/livingston-challenge-detection.md
**Decision summary:** Added exported looksLikeBotChallenge(html, status?): - Signals (case-insensitive vendor markers): Cloudflare (Just a moment..., Attention Required! | Cloudflare, Checking your browser before accessing, cf-browser-verification, cf-challenge, Performing security verification, Enable JavaScript and cookies to continue, __cf_chl), Vercel (Vercel Security Checkpoint, We're verifying your browser), DataDome / PerimeterX / Akamai (DataDome, px-captcha, Access to this page has been denied, Pardon Our Interruption). - Generic heuristic: visible-text < ~250 chars + noindex robots meta + no article markers → challenge. - False-positive guard (runs first): any body with <article>, ≥3 <p>, JSON-LD, or og:title is NEVER a…


### 2026-06-28: Decision: Remove aeon+voa providers & data-driven category remapping
**By:** ** Livingston (Backend Dev)
**References:** ** #847 — `refactor(scraper): drop aeon+voa, fix category mis-maps & coverage` — **MERGED** (squash, 9c04e01 on main)
**Source:** decisions/inbox/livingston-remove-remap.md
**Decision summary:** aeon (Vercel challenge needing a paid reader key) and voa-learning-english (bot-blocked discovery) cannot be scraped, so they were removed entirely: - Deleted src/lib/scraper/providers/aeon.ts, src/lib/scraper/providers/voa-learning-english.ts, and aeon's dead extractor src/lib/scraper/aeon-graphql.ts. - Unregistered from src/lib/scraper/providers/index.ts (imports + PROVIDERS). - Deleted tests/aeon-graphql.test.ts; removed aeon/voa cases from tests/providers.test.ts and tests/scraper-rss-extractor.test.ts. - Updated docs: capacity-planning.md (14→12), scrapers.md (dropped Aeon GraphQL section + Step 6), content-policy.md. - sources.ts / seeding derive from PROVIDERS dynamically — no hardcoded keys. 12 provi…


---
## 2026-06-29 — Smithsonian scrape workflow decision inbox merge

Processed 1 inbox file into 1 decision summary; full raw entry archived at `decisions/archive/2026-06-29T02-39-40.222+00-00-processed-inbox.md`. Duplicate summaries skipped: 0.

### 2026-06-29T02-52-55: Smithsonian scrape workflow records repo-local visited URLs
**By:** Livingston (Backend Dev)
**References:** scripts/scrape-smithsonian.ts, src/lib/scraper/providers/smithsonian.ts, package.json
**Source:** decisions/inbox/livingston-smithsonian-scrape-workflow-records-repo-local-vis.md
**Decision summary:** Smithsonian reset/scrape/analyze now records repo-local, gitignored visited URLs at `.scraper-state/smithsonian-visited-urls.json` with URL, timestamps, and coarse outcome only (no article text or private content). The workflow skips recorded URLs by default, supports `--target-saved`, paginates Smithsonian categories via `?page=N`, and adds a Smithsonian affiliate-link note cleanup filter after analysis found that recurring non-article fragment.

> Correction (Scribe, 2026-06-29T02:39:40.222+00:00): the raw processed-inbox archive file was not created because `decisions/archive/` is not writable through the runtime state tool. The durable decision record is the summary above; the processed inbox entry was deleted after merge.


---
## 2026-06-29 — ReadingX reference directive inbox merge

Processed 1 inbox file into 1 decision summary. Duplicate summaries skipped: 0.

### 2026-06-29T04:51:47.323+00:00: User directive
**By:** Ralph Agent (via Copilot)
**References:** ../ReadingX
**Source:** decisions/inbox/copilot-directive-2026-06-29T04-51-47-readingx-reference.md
**Decision summary:** User said: "you can also reference code `../ReadingX`". Team agents may reference sibling codebase `../ReadingX` when useful, subject to normal repo/security/privacy constraints.

---
## 2026-06-29 — Undark headless scraping decision inbox merge

Processed 2 inbox files into 2 decision summaries. Duplicate summaries skipped: 0.

### 2026-06-29T10-40-42: Deferred Undark headless tests until implementation contract exists
**By:** Basher
**References:** Basher, Livingston, Ralph, scripts/scrape-undark.ts, tests/scraper-undark-cli.test.ts, tests/scraper-rss-extractor.test.ts, tests/providers.test.ts
**Source:** decisions/inbox/Basher-deferred-undark-headless-tests-until-implementatio.md
**Decision summary:** Basher inspected the worktree for Undark headless-browser scraping support before implementation and found no headless flag, headless fetch path, Playwright/Chromium integration, or fallback semantics in the existing Undark scraper workflow/tests. Basher intentionally deferred speculative failing tests until Livingston landed a concrete implementation contract. Existing focused tests covered current CLI defaults/controls, WordPress.com discovery with RSS fallback, provider URL patterns, and unchanged default non-headless behavior; planned follow-up coverage targeted explicit headless option parsing, safe browser-tooling failure, fallback behavior, and unchanged defaults.

### 2026-06-29T10-54-44: Add Undark-specific headless scraping fallback
**By:** Livingston
**References:** Livingston, Undark scraper, scripts/scrape-undark.ts, src/lib/scraper/providers/undark-headless.ts
**Source:** decisions/inbox/Livingston-add-undark-specific-headless-scraping-fallback.md
**Decision summary:** Implemented Undark scraping as an opt-in provider-specific path. `--headless` retries static extraction/quality failures with Playwright Chromium, and `--headless-only` renders first. Rendered/API HTML still flows through existing extraction, quality, sanitization, and persistence. The browser path validates Undark article URLs and SSRF-checks navigation/resources; unavailable Chromium tooling returns a setup-oriented error for explicit headless use. Because live Undark currently returns Cloudflare challenge HTML even to headless Chromium in this environment, the headless path falls back to Undark's public WordPress.com post API only after browser rendering fails or yields unusable content, preserving non-headless behavior and avoiding shared cleanup hacks.


## 2026-06-30T00:52:48.287+00:00 — Nautilus cleanup rule

- User directive: Nautilus scraped output does not need `<figcaption>` content, but image `src` values must be preserved.
- Decision/application: Nautilus provider cleanup may drop `<figcaption>` elements only while preserving `<figure><img src=...>` image markup/source in sanitized output.
- Scope: This is provider-specific to Nautilus; other providers keep captions unless a separate provider rule changes that behavior.
- Source: merged from `decisions/inbox/copilot-directive-2026-06-30T00-52-48-nautilus-figcaptions.md`.
