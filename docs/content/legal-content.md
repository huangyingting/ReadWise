---
type: "design"
status: "current"
last_updated: "2026-07-01"
description: "Documents legal/static content ownership and release/update boundaries. Captures current responsibilities for terms, privacy, static routes, review cadence, and change control."
---

# Legal and Static Content Governance

> REF-075 — Consolidate legal/static pages, metadata, and manifest content
> governance.

## Overview

Legal, manifest, and static marketing copy are treated as **governed content**:
all strings live in one place, every page's metadata traces to a single module,
and this document records when a review is required.

| Governed module | What it owns |
|----------------|-------------|
| `src/lib/copy/site.ts` | Product name, title template, site description, OG/Twitter copy, PWA manifest description |
| `src/lib/copy/pages.ts` | Per-page `title` and `description` for every static route |
| `src/lib/assets.ts` | All public asset paths (icons, fonts, offline pages) |
| `src/components/legal/LegalPageShell.tsx` | Shared outer structure for Terms and Privacy pages |
| `src/app/manifest.ts` | PWA manifest — reads from `copy/site` and `assets` |
| `src/app/layout.tsx` | Root `<Metadata>` — reads from `copy/site` and `assets` |

## Static content inventory

### Legal pages

| Route | Page file | Metadata key | Last reviewed |
|-------|-----------|-------------|---------------|
| `/terms` | `src/app/terms/page.tsx` | `copy/pages.terms` | June 2025 |
| `/privacy` | `src/app/privacy/page.tsx` | `copy/pages.privacy` | June 2025 |

Both pages use `LegalPageShell` for consistent structure. Metadata is exported
via `@/lib/copy/pages` and is picked up by Next.js automatically.

### App manifest

`src/app/manifest.ts` generates the PWA manifest at `/manifest.webmanifest`.
All values come from `@/lib/copy/site` and `@/lib/assets` — no inline strings.

### Root and landing metadata

`src/app/layout.tsx` exports `metadata` using constants from `@/lib/copy/site`
and `@/lib/assets`. The landing page (`src/app/page.tsx`) uses
`copy/pages.landing` for its title and description.

### Offline library page

`src/app/(app)/offline/page.tsx` is a `"use client"` component and therefore
cannot export server-side metadata. It has no static metadata entry; the root
layout template applies.

## Content review checklist

Review and update legal/static content whenever **any** of the following
changes land:

### Privacy Policy

- [ ] A new **OAuth provider** is added or removed (section 3 — Third-party services)
- [ ] A new **AI provider** (e.g. Azure OpenAI, Azure Speech) is added, changed, or removed (section 3)
- [ ] A new category of **user data is collected** (section 1 — What we collect)
- [ ] **Data retention** behavior or the account-deletion flow changes (section 4)
- [ ] **Push notification** support is added or removed (new data collected)
- [ ] New **localStorage / sessionStorage / IndexedDB** keys that hold personal data are introduced (section 5)
- [ ] Third-party tracking or analytics are added (section 5)
- [ ] The **Settings → Privacy & account** path changes (section 4 link)

### Terms of Service

- [ ] The product scope or name changes (section 1 — Acceptance)
- [ ] Supported **news sources** change significantly (section 3 — Content)
- [ ] New **AI-generated features** are added (section 4 — AI-generated content)
- [ ] The **account suspension or termination** policy changes (section 5 — Accounts)

### App manifest / PWA metadata

- [ ] `SITE_NAME`, `MANIFEST_DESCRIPTION`, or theme color in `copy/site.ts` changes
- [ ] App icons are replaced or renamed (update `assets.ts`)
- [ ] The `start_url` or `display` mode changes in `manifest.ts`

### Site metadata and OG copy

- [ ] `SITE_DESCRIPTION`, `OG_TITLE`, or `OG_DESCRIPTION` in `copy/site.ts` changes
- [ ] The title template or default title changes
- [ ] OG/Twitter image or card type changes in `layout.tsx`
- [ ] Marketing claims (supported sources, feature list) in `page.tsx` diverge from actual behavior

## How to update legal copy

1. Edit the relevant section in `src/app/terms/page.tsx` or
   `src/app/privacy/page.tsx`.
2. Update the `lastUpdated` prop on `LegalPageShell` to the current month and
   year.
3. If the metadata title or description needs to change, update
   `src/lib/copy/pages.ts`.
4. Run `npm run typecheck` and `npm test` to confirm nothing is broken.
5. Tick the applicable items in the checklist above and note the date in the
   table at the top of this file.

## How to add a new legal or static page

1. Create `src/app/<route>/page.tsx`.
2. Add a metadata entry to `src/lib/copy/pages.ts` and export it.
3. Import `LegalPageShell` if the page follows the legal layout; otherwise
   compose a custom layout.
4. Export `metadata` using the new `pages.*` constant.
5. Add the route to the table in this document.
