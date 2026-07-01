---
type: "reference"
status: "current"
last_updated: "2026-07-01"
description: "Documents UI i18n architecture, locale loading, and separation from article translation and learner preferences. Captures current catalog structure, translation lookup behavior, fallback rules, and contribution guidance."
---

# UI internationalization

ReadWise currently renders product UI in English. The codebase has a small,
typed internationalization seam for shared fallback copy, but it does **not**
yet perform runtime locale negotiation or render non-English UI.

This document describes the current behavior and the boundaries that keep UI
locale concerns separate from article translation and learner preferences.

## Three distinct language concepts

| Concept | Owner | Current location | Purpose |
| --- | --- | --- | --- |
| UI locale | Product UI | `src/lib/i18n/`, plus hard-coded English strings across components | Language of navigation, labels, errors, and notifications. Currently English-only. |
| Translation target language | Reader action | `src/lib/supported-languages.ts`, `src/lib/translation.ts` | Language an article or sentence is machine-translated into. |
| Learner reading profile | Learning | `Profile.englishLevel`, `Profile.topics`, `Profile.goalPath` | CEFR level, topics, and reading strategy used for recommendations. |

These concepts are independent. Changing article translation target language or
learner CEFR preferences does not change UI copy, and the current UI i18n seam
does not alter recommendation or translation behavior.

## Current runtime behavior

- `<html lang="en">` is hard-coded in `src/app/layout.tsx`.
- `src/lib/display-format.ts` formats dates and relative times with English /
  `en-US` assumptions.
- `src/lib/i18n/index.ts` exports `t()` and currently resolves every key against
  the English catalog in `src/lib/i18n/en.ts`.
- `t()` accepts an unused locale parameter for call-site compatibility, but no
  active locale resolver, locale cookie, locale context, URL locale prefix, or
  `Profile.uiLocale` column exists.
- No right-to-left layout mode or locale-specific font subsetting is active.

## Message catalog seam

The current catalog is intentionally small and typed:

| File | Role |
| --- | --- |
| `src/lib/i18n/catalog.ts` | `MessageCatalog` interface. Every key maps to either `() => string` or a parameterized function. |
| `src/lib/i18n/en.ts` | English fallback catalog and current source of truth. |
| `src/lib/i18n/index.ts` | Client-safe `t()` lookup and exports. |

Catalog keys use dot-separated namespace segments such as
`reader.translate.unavailable` and `push.reminder.todayBody`.

Fallback behavior:

- known key → call the English catalog entry;
- formatter error or missing key → return the key string, making missing copy
  visible without throwing a runtime exception.

The seam is safe for Server Components and Client Components because it has no
Node-only imports.

## Current catalog coverage

The English catalog currently covers provider fallback and push reminder copy:

| Key | Current use |
| --- | --- |
| `reader.translate.unavailable` | Article translation unavailable fallback. |
| `ai.tutor.unavailable` | Tutor unavailable fallback response. |
| `ai.quiz.unavailable` | Quiz-generation unavailable UI. |
| `ai.translation.unavailable` | Translation unavailable UI. |
| `ai.vocabulary.unavailable.title` | Vocabulary panel unavailable title. |
| `ai.vocabulary.unavailable.description` | Vocabulary panel unavailable description. |
| `push.reminder.title` | Standard word-review push title. |
| `push.reminder.body` | Standard word-review push body. |
| `push.reminder.todayTitle` | Today Session push title. |
| `push.reminder.todayBody` | Today Session push body. |

Most product UI strings remain hard-coded English in JSX or feature modules.
That is current behavior, not a fallback to a hidden catalog.

## Boundaries

- Do not use `src/lib/i18n/` for article machine translation. Article and
  sentence translation stay in the Reader/AI translation system.
- Do not infer UI locale from `Profile.englishLevel`, `topics`, or `goalPath`.
  These fields describe reading personalization, not interface language.
- Do not add locale-specific routing without revisiting service-worker scope,
  analytics paths, and deep links.
- When moving a string into the catalog, add the key to `MessageCatalog` and
  `en.ts` in the same change so TypeScript catches missing entries.

## Related docs

- [`runtime-config.md`](./runtime-config.md) — server/runtime configuration
  ownership.
- [`../reader/translation.md`](../reader/translation.md) — article and sentence
  translation behavior.
- [`../learning/profile-preferences.md`](../learning/profile-preferences.md) —
  learner profile fields used for personalization.