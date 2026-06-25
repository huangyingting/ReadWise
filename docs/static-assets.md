# Static Asset Governance

> REF-080 — Govern public fonts, icons, and static asset usage.

## Overview

All governed files under `public/` are inventoried in
**`src/lib/assets.ts`**. That module is the single source of truth for every
icon and font URL path referenced anywhere in the codebase — metadata,
manifests, push notification payloads, and CSS.

## Asset inventory

| URL path | Purpose | Key references |
|----------|---------|----------------|
| `/icon.svg` | SVG app icon (any size) | layout.tsx metadata, manifest.ts |
| `/icons/icon-192.png` | 192×192 PNG icon | manifest.ts, push notifications |
| `/icons/icon-512.png` | 512×512 PNG icon (standard + maskable) | manifest.ts |
| `/icons/apple-touch-icon.png` | Apple touch icon (180×180) | layout.tsx metadata |
| `/fonts/OpenDyslexic-Regular.woff` | OpenDyslexic Regular, dyslexic reading font | tokens.css |
| `/fonts/OpenDyslexic-Bold.woff` | OpenDyslexic Bold, dyslexic reading font | tokens.css |
| `/offline.html` | General offline fallback page | sw.js (pre-cached on install) |
| `/offline-reader.html` | Offline article reader (IndexedDB) | sw.js (pre-cached on install) |
| `/sw.js` | Service worker script | ServiceWorkerRegister.tsx |

## Using asset paths in code

Import from `@/lib/assets` instead of hard-coding strings:

```ts
// ✅ correct
import { ICON_192, ICON_SVG, APPLE_TOUCH_ICON } from "@/lib/assets";

// ❌ avoid
const icon = "/icons/icon-192.png";
```

CSS `@font-face` declarations in `src/app/tokens.css` are the only place where
font paths must remain as literal strings (CSS cannot import TypeScript). Keep
those paths identical to the `FONT_OPENDYSLEXIC_*` constants in `assets.ts` —
the test suite enforces this alignment.

## How to update icons

1. Replace the relevant file(s) under `public/icons/` or `public/icon.svg`.
2. If a **filename** changes, update the matching constant in `src/lib/assets.ts`.
3. Run `npm run typecheck` and `npm test` to confirm nothing is broken.
4. If regenerating platform icons (e.g., with a new brand color), regenerate
   all sizes at once: 192 × 192, 512 × 512, and 180 × 180 (Apple touch).

## How to update fonts

1. Replace the `.woff` file(s) under `public/fonts/`.
2. If a **filename** changes, update the matching `FONT_*` constant in
   `src/lib/assets.ts` **and** the `src: url(...)` in
   `src/app/tokens.css` (both must stay in sync).
3. Run `npm test` — the `tokens.css @font-face src matches` tests will catch
   any divergence.

## OpenDyslexic loading strategy

The OpenDyslexic font is loaded **on demand via CSS `@font-face`** with
`font-display: swap`. The browser only fetches the woff files when the reader's
font preference is set to `"dyslexic"` (stored in `localStorage` via
`src/lib/reader-prefs.ts`). No font bytes are transferred for users who never
activate the dyslexic reading mode.

## Service worker and offline pages

`public/sw.js` pre-caches `/offline.html` and `/offline-reader.html` at
install time. Because the service worker cannot import TypeScript modules,
those paths are duplicated as string literals in `sw.js`. The constants
`OFFLINE_PAGE` and `OFFLINE_READER_PAGE` in `assets.ts` are the canonical
spellings — the test suite verifies that `sw.js` references the same strings.

If you rename either offline page, update:
1. `src/lib/assets.ts` (constants + manifest entry)
2. `public/sw.js` (`addAll` call in the `install` handler)
3. Bump `SW_CACHE_VERSION` in `src/lib/cache-version.ts` to force the old
   pre-cache entry to be dropped.

## Adding a new public asset

1. Place the file under `public/`.
2. Add a constant in `src/lib/assets.ts`.
3. Add an entry to `ASSET_MANIFEST` in `src/lib/assets.ts` with `path`,
   `purpose`, and `references`.
4. Run `npm test` — the "all ASSET_MANIFEST entries exist on disk" suite will
   confirm the new file is present.

## Detecting missing or unexpectedly large assets

- **Missing references**: `npm test` runs `tests/assets.test.ts`, which calls
  `existsSync` for every manifest entry.
- **Size awareness**: The OpenDyslexic woff files are ~20 KB each (acceptable
  for an on-demand reading font). Icon files are ≤4 KB each. Before adding new
  fonts or high-resolution images, check the size impact on the initial page
  load (fonts are deferred; icon PNGs are not inlined).
