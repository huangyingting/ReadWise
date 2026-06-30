# Project Context

- **Project:** ReadWise
- **Created:** 2026-06-19

## Core Context

Agent Ralph initialized and ready for work.

## Recent Updates

📌 Team initialized on 2026-06-19

## Learnings

Initial setup complete.


## 2026-06-21 — Cross-agent lessons from #105–#126 merge wave
- When CI is unavailable, the coordinator gates merges via local typecheck/lint/test/clean-build before squash-merge.


## 2026-06-29T02:39:40.222+00:00 — Smithsonian scrape workflow coordination
Coordinator confirmed the analyze-only report after implementation and QA: 50 Smithsonian articles, 130,275 stored words, and no recurring non-article noise candidates.


## 2026-06-29T03:36:59.547+00:00 — Smithsonian publish workflow coordination
Coordinator final check confirmed 50 total Smithsonian rows, 50 published public ownerless rows, 0 drafts, 0 missing publishedAt, and analyze-only showed no recurring noise after Livingston's workflow update and Basher's QA approval.


## 2026-06-29T03:56:04.101+00:00 — Smithsonian avatar cleanup coordination

Coordinator final DB check confirmed article `cmqyo77ig000zjgg7ces1fu51` exists, target headshot residue is 0, all Smithsonian headshot residue is 0, and Smithsonian rows remain published/PUBLIC after Livingston's cleanup and Basher's QA approval.


## 2026-06-29T04:22:21.322+00:00 — Smithsonian scrape coordinator check

Coordinator final direct check confirmed the completed Smithsonian scrape state: total=342, published=342, drafts=0, missing `publishedAt`=0, and analyze-only reported no recurring non-article noise. Non-state repository changes remain for coordinator handling; Scribe made no git commit.


### 2026-06-29T05:27:54.043+00:00 — Undark scrape coordinator check

Coordinator final direct check for the Undark scrape confirmed Smithsonian DRAFT count 392, Undark DRAFT count 10, and Undark known support/newsletter pattern count 0. Scribe recorded orchestration, session, decision-inbox, and health state without committing mutable squad state.


### 2026-06-29T08:05:07.201+00:00 — Undark retry-semantics coordination

Coordinator completed Livingston's Undark all-scrape work, resolved Basher's blocker by making failed visited records retryable, added regression coverage, and reran the scrape at concurrency 1. Final reported state: Undark total=56 published/PUBLIC/ownerless rows, no duplicates or missing `publishedAt`; remaining failed fresh URLs=3209.

### 2026-06-29T10:38:55.698+00:00 — Coordinated Undark headless scraping support

Ralph coordinated the Undark headless scraping batch after the user asked whether a headless browser can scrape Undark articles. Livingston implemented the provider-specific browser/API fallback path, Basher assessed and verified coverage, and coordinator validation passed focused tests, typecheck, targeted ESLint, CLI help smoke, live browser/API smoke, `git diff --check`, and SQL todo review.


### 2026-06-29T11:02:27.669+00:00 — Coordinated Undark scrape exhaustion

Ralph requested recording for the completed Undark all-scrape exhaustion run. Coordinator verification showed visited state at 3,265 rows (2,692 saved, 573 failed) and DB state at 2,692 Undark articles, all published, with 0 drafts, 0 missing `publishedAt`, and 0 duplicate groups. The final rerun saved 0, so the stop condition was all discoverable URLs saved/accounted or persistent failures.

- 2026-06-29T20:08:52.684+00:00 — Coordinated user request to put all articles in draft status. Livingston performed database-only status update; Scribe recorded orchestration/log entries. Final aggregate: 3084 articles `DRAFT/PUBLIC`; visibility unchanged and no code/git changes.


## 2026-06-29T20:18:02.637+00:00 — Noema publish request recorded

Requested Scribe logging for Livingston's Noema publishing operation. Final state: 11 Noema articles `PUBLISHED`, 11 `PUBLIC`, 0 missing `publishedAt`; no article content or code/git changes involved.


## 2026-06-29T20:25:50.268+00:00 — Coordinated Noema scrape exhaustion

Ralph requested Scribe recording for the Noema all-scrape campaign. Coordinator verification reported 255 Noema rows, all published/public, 0 drafts, 0 missing `publishedAt`, 0 duplicate groups, 946,351 stored words, and a confirmed plateau after a rerun saved 0 additional articles; 45 quality-policy rejections remain persistent.


## 2026-06-29T21:13:25.291+00:00 — Coordinated Noema exhaustion correction

Ralph requested Scribe recording after the user challenged whether Noema links were truly exhausted. The corrected record notes that `../ReadingX` had no Noema-specific discovery, the previous 300-link run was not exhaustive, enhanced ReadWise discovery found 2,076 Noema candidates via Yoast article sitemaps plus RSS pagination, and final verification showed 1,336 Noema rows all published/public with no drafts, missing `publishedAt`, or duplicate groups. Unexpected existing commit `cc2176c` on `main`/`origin/main` was noted but not reverted or amended by Scribe.

## 2026-06-29T22:53:56.993+00:00 — all articles draft status

Requested marking all articles as draft. Livingston completed the database-only update, and Scribe recorded the result: 4,420 total articles now `DRAFT`, visibility unchanged at `PUBLIC`, 0 published remaining, with no content exposure or git operations.

- 2026-06-30T00:44:05.590+00:00 — Requested Scribe documentation for the Nautilus article publishing run. Recorded that Livingston confirmed 11 Nautilus rows as `PUBLISHED`/`PUBLIC` with no missing `publishedAt`, and that no content exposure or git operations occurred.


- 2026-06-30T00:52:48.287+00:00 — Coordinated the Nautilus cleanup correction after the user clarified that figcaptions can be dropped but image `src` values must be preserved. Ensured the directive was captured/merged, Livingston updated and remediated the DB, validation passed, and Scribe recorded state without git operations.


## 2026-06-30T01:05:42.741+00:00 — Nautilus scrape exhaustion archive

Scribe archived Ralph's Nautilus scrape continuation request. The campaign reached a scrape plateau after three passes, with 3192 published/public Nautilus rows verified, no duplicate groups, no missing `publishedAt`, no figcaption rows, and targeted tests/lint/typecheck/diff-check passing. Unexpected commit state `b1e2475` on `main`/`origin/main` remains documented; no article content was exposed.


## 2026-06-30T01:47:20.985+00:00 — all articles draft status coordination

Requested documenting the user request to put all articles in draft status. Livingston completed a database-only update of 3,192 rows; Scribe recorded final aggregate 7,612 articles all `DRAFT`/`PUBLIC`, visibility unchanged, 0 published remaining, with no content exposure or git/source changes.

## 2026-06-30T01:58:33.447+00:00 — Knowable sample publish coordination

- Coordinated Knowable sample campaign: scrape results were consolidated, 10 stored HTML bodies were inspected for recurring noise, and only inspected rows were published.
- Verified final state: Knowable total 15, published 10, drafts 5, public rows 15, missing `publishedAt` 5, duplicate groups 0.
- Preserved repository state: no source changes, tests, commits, pushes, branch switches, resets, or article-content exposure.


## 2026-06-30T02:08:59.910+00:00 — Knowable figcaption cleanup coordination

Ralph captured the user directive that Knowable figcaptions/credit captions are unnecessary but images and `img src` values must be preserved. Coordinated Livingston's provider cleanup and DB remediation; final reported state was 14 Knowable rows updated, 42 figcaptions removed, image count preserved 42→42, 0 Knowable figcaptions remaining, and focused tests/ESLint/typecheck/diff-check passing.
