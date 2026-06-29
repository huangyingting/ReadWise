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
