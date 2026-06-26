# UI Internationalization Foundation

ReadWise serves a global learner audience but currently renders all product UI
in English. This document designs the foundation that will make UI localization
feasible without mixing it with the existing article-translation and learner
language-preference systems.

## Three distinct locale concepts

| Concept | Owner | Location | Purpose |
|---|---|---|---|
| **UI locale** | Product / browser negotiation | `src/lib/i18n/` (this design) | Language of navigation, labels, errors, and notifications. |
| **Translation target language** | Reader action | `src/lib/supported-languages.ts` | Language an article is machine-translated into. |
| **Learner language preference** | User profile | `Profile.englishLevel`, `Profile.topics` | CEFR level, topics, and goals that drive recommendations. |

These three concepts must remain independent. Switching the UI to French must
not change which language an article is translated into, nor alter CEFR leveling
logic. Do not conflate them in code or data models.

## Current state

### What already exists

- **`src/lib/copy/`** — centralized product copy module (`site`, `pages`, `push`
  domains). Each file includes a comment noting it is the first step toward
  localization and that its exports can be replaced with locale-keyed lookups
  when a real i18n project starts. This is the primary seam.
- **`src/lib/display-format.ts`** — all `Intl.DateTimeFormat` and
  `toLocaleDateString` calls hard-code `"en-US"` or `"en"`. A comment in the
  file explicitly says "en / en-US throughout until full localization lands."
- **`src/app/layout.tsx`** — `<html lang="en">` is hard-coded. The `next/font`
  fonts (`Inter`, `Space_Grotesk`, `Literata`) load only the `latin` subset.
- **`src/lib/translation.ts`** — the `fallbackText()` function returns
  English-only provider-error messages.

### What is absent

No runtime locale negotiation, no message catalog, no locale context, no RTL
layout support, and no locale-aware font subsetting exist today. UI strings are
scattered across JSX and component files outside `src/lib/copy/`.

## Proposed architecture

### Message catalog

A flat-keyed typed catalog holds every translatable UI string. Keys use
dot-separated namespace segments:

```
<domain>.<surface>.<variant>
```

Examples:

```
nav.home.label
reader.translate.unavailable
push.reminder.body
errors.notFound.heading
```

The catalog is a TypeScript interface (`MessageCatalog`) so that missing keys
are caught at compile time. Each locale ships an object that satisfies the
interface. The English catalog is the fallback and the source of truth during
Phase 1.

The minimal scaffolding (`src/lib/i18n/`) lives in this repo now and is detailed
in the **Scaffolding** section below.

### `t()` — message lookup seam

```typescript
import { t } from "@/lib/i18n";

// static string key
const label = t("nav.home.label");

// parameterized message
const body = t("push.reminder.body", { count: 3 });
```

`t()` accepts a key and an optional params record. During Phase 1 it always
returns the English string. In later phases the active locale is read from a
server-side cookie or the `Accept-Language` header (resolved once per request in
a Server Component or middleware) and passed down via React Context or a locale
param to avoid prop drilling.

Explicit fallback contract: when a key is missing in the active locale catalog,
`t()` falls back to the English catalog entry. When the key is missing from
English too, `t()` returns the key itself (e.g. `"nav.home.label"`) so runtime
errors are never thrown and missing strings are immediately visible in the UI.

### Locale detection and selection

**Priority order (highest first):**

1. User-stored preference (future: `Profile.uiLocale` column, not yet added).
2. `NEXT_LOCALE` cookie set by a locale-switcher component.
3. `Accept-Language` header negotiated against the supported locale list.
4. `"en"` hardcoded default.

Detection runs in Next.js middleware (`middleware.ts`) and stamps the resolved
locale into a `NEXT_LOCALE` response cookie. Server Components read the cookie
via `cookies()`. Client Components receive the locale through a React Context
provider mounted in the root layout.

Do not use Next.js's built-in `i18n` routing (`next.config` `i18n` key) for
Phase 1. It rewrites URLs (e.g. `/fr/reader/…`) which breaks existing deep
links, analytics, and the service worker scope. Cookie-based locale selection
keeps URLs stable.

### Date / number formatting

All formatting helpers in `src/lib/display-format.ts` accept an optional
`locale` parameter defaulting to `"en-US"`. During Phase 1 the default covers
the entire app; callers that already pass the user's resolved locale get correct
output automatically.

```typescript
// Phase 1 (no change needed at call sites):
formatShortDate(article.publishedAt);

// Phase 2 (locale flows in):
formatShortDate(article.publishedAt, resolvedLocale);
```

Number formatting follows the same pattern: `Intl.NumberFormat` is used with an
explicit locale string rather than relying on the runtime default.

### RTL layout support

Arabic (`ar`) and Hebrew (`he`) are right-to-left languages. When either is the
active UI locale:

1. Set `<html dir="rtl">` in `layout.tsx` (next to the existing `lang` prop).
2. Use Tailwind CSS logical properties (`ms-`, `me-`, `ps-`, `pe-`) instead of
   `ml-`/`mr-` in all new components. Existing components migrate surface by
   surface; do not block shipping by requiring a full rewrite.
3. Load the appropriate font subset (`arabic` for `Inter` or substitute a
   variable-weight Arabic webfont). Only extend `next/font` subsets in the
   layout after confirming the locale can be active.

RTL is a Phase 3 concern; do not introduce `dir` logic until at least one RTL
locale is in the supported list.

## High-impact copy surfaces (inventory)

Listed in approximate impact order (most visible first):

| Surface | Files | Notes |
|---|---|---|
| Navigation labels | `src/components/AdminNav.tsx`, shell / sidebar components | Hard-coded strings in label arrays |
| Reader tools | `src/components/` reader toolbar components | Tool names, ARIA labels |
| Onboarding flow | `src/app/onboarding/`, `src/components/` onboarding forms | Multi-step wizard copy |
| Study / flashcards | `src/app/(app)/study/`, study components | Streak, badge, goal copy |
| Push notification payload | `src/lib/copy/push.ts` (`reminder`, `ui` namespaces) | Already centralized |
| Provider-fallback messages | `src/lib/translation.ts` `fallbackText()` | Pilot surface for #733 |
| Errors and empty states | `src/app/not-found.tsx`, `src/app/forbidden/`, error boundaries | Small, high visibility |
| Admin console | `src/app/admin/`, `src/components/Admin*.tsx` | Lower priority; mostly internal |
| Teacher / classroom | `src/app/(app)/classroom/` | Lower priority |
| Legal pages | `src/app/terms/`, `src/app/privacy/` | Near-static; low churn |

## Relationship to #733 (provider-fallback messages)

Issue #733 adds localized messages for cases where the AI or push-notification
provider is unavailable. It builds on the `t()` seam defined here.

### Keys migrated in #733

| Key | Call site | Message (English) |
|---|---|---|
| `reader.translate.unavailable` | `src/lib/translation.ts` | "Translation into \${lang} is unavailable…" |
| `ai.tutor.unavailable` | `src/lib/ai/tutor.ts` | "AI feature unavailable — the AI tutor is not available right now…" |
| `ai.quiz.unavailable` | `src/components/ArticleQuiz.tsx` | "AI feature unavailable — quiz generation is not available right now…" |
| `ai.translation.unavailable` | `src/components/BilingualBody.tsx` | "AI feature unavailable — translation is not available right now." |
| `ai.vocabulary.unavailable.title` | `src/components/ArticleVocabulary.tsx` | "Vocabulary unavailable" |
| `ai.vocabulary.unavailable.description` | `src/components/ArticleVocabulary.tsx` | "AI vocabulary extraction is not available right now…" |
| `push.reminder.title` | `src/lib/copy/push.ts` | "Time to review! 📚" |
| `push.reminder.body` | `src/lib/copy/push.ts` | "You have \${count} word(s) due for review in ReadWise." |

### Follow-up inventory (not yet migrated)

These user-facing strings were identified in #733 but deferred to a follow-up
issue to keep this PR focused:

| Surface | File | Message |
|---|---|---|
| Speech token transient error | `src/components/reader/useSpeechToken.ts` | "Speech service is temporarily unavailable. Try again shortly." |
| Speech token unavailable | `src/components/reader/useSpeechToken.ts` | "Speech service is temporarily unavailable." |
| Sentence translate error | `src/components/SentenceTranslatePopover.tsx` | "Couldn't translate that. Try again." |
| Sentence translate fallback | `src/components/SentenceTranslatePopover.tsx` | "Translation isn't available right now. Try again in a moment." |
| AI budget quota exceeded | `src/lib/ai/budget.ts` (quotaMessage) | "AI usage limit reached for \${subject} budget…" |
| Moderation fallback | `src/lib/ai/output/moderation.ts` | "I can't help with that…" |
| Narration unavailable | `src/components/ReaderListenButton.tsx` | "Narration unavailable" |
| Microphone access denied | `src/components/pronunciation/ErrorNotice.tsx` | "ReadWise can't hear your microphone…" |
| Push UI: denied info | `src/lib/copy/push.ts` (ui.deniedInfo) | "Notifications are blocked…" |
| Push UI: subscribe errors | `src/lib/copy/push.ts` (ui.subscribeError etc.) | "Failed to enable push notifications." |

## Scaffolding (`src/lib/i18n/`)

A minimal typed catalog and `t()` are added now as a safe, non-breaking seam.
No existing call sites are changed; the seam is available for #733 and future
work to adopt incrementally.

### Files added

```
src/lib/i18n/
  catalog.ts   — MessageCatalog interface + parameter type helpers
  en.ts        — English default catalog (8 keys as of #733)
  index.ts     — t() lookup function + re-exports; overloads for both
                 parameterless t("key") and parameterized t("key", { ... })
```
```

The implementation is server/client-safe (no Node-only imports). It is a pure
TypeScript module that works in both Server Components and Client Components.

## Phased adoption plan

### Phase 1 — Foundation (this issue)

- [x] Design doc at `docs/platform/internationalization.md`.
- [x] `src/lib/i18n/` seam: `MessageCatalog` type, English catalog, `t()`.
- [x] #733 migrates `fallbackText()`, push-reminder copy, and provider-fallback
  component strings to `t()`. 8 keys now live in the catalog; see the table
  above for the full list.
- [ ] `src/lib/display-format.ts` functions accept optional `locale` param.

### Phase 2 — Pilot locale (future issue)

- Add a second locale (e.g. `zh-Hans`) to `src/lib/i18n/`.
- Implement middleware locale detection and `NEXT_LOCALE` cookie.
- Mount a `LocaleProvider` context in the root layout.
- Migrate push notification copy and one reader-tool surface as the pilot.
- Verify round-trip: locale cookie → `t()` → correct string in rendered HTML.

### Phase 3 — Broad rollout (future)

- Migrate remaining high-impact surfaces surface by surface.
- Extend `Profile` with an optional `uiLocale` column.
- Evaluate RTL font and layout needs if Arabic is in scope.
- Add `<html lang>` and optional `dir` to layout driven by resolved locale.
- Extend `next/font` subsets per active locale.

## Decisions deferred

- No locale-aware URL routing (`/fr/…` paths) until there is a strong SEO case.
- No database column for `uiLocale` until Phase 2; Phase 1 uses cookie only.
- No full-app string extraction tooling (e.g. `i18next`, `FormatJS`) until the
  pilot locale proves the pattern; the typed catalog scales to hundreds of keys
  without an external library.
- RTL support deferred to Phase 3.
