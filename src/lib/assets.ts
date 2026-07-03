/**
 * Public asset governance — REF-080.
 *
 * Single source of truth for all governed public icon and font paths. Every
 * reference to a file under `public/` in metadata, manifests, push payloads,
 * and CSS should trace back to a constant defined here.
 *
 * HOW TO UPDATE
 * -------------
 * Icons:  Replace files under `public/icons/` + `public/icon.svg`. If a
 *         filename changes, update the constant below and any CSS/HTML that
 *         references it (tokens.css @font-face, offline pages).
 *
 * Fonts:  Replace files under `public/fonts/`. Update the FONT_* constants
 *         below and the matching `src: url(...)` in `src/app/tokens.css`.
 *         Both must stay in sync because CSS cannot import TS modules.
 *
 * Service worker: `public/sw.js` caches /offline.html + /offline-reader.html
 *   on install and cannot import this module. If those filenames change, update
 *   sw.js manually alongside the constants below and bump SW_CACHE_VERSION in
 *   `src/lib/cache-version.ts`.
 *
 * After any change, run `npm test -- --test-name-pattern assets` to confirm
 * every manifested path resolves to a real file under `public/`.
 */

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

/** SVG app icon — HTML metadata (`<head>`) and PWA manifest. */
export const ICON_SVG = "/icon.svg" as const;

/** 192×192 PNG icon — PWA manifest and Web Push notification icon. */
export const ICON_192 = "/icons/icon-192.png" as const;

/** 512×512 PNG icon — PWA manifest (standard + maskable). */
export const ICON_512 = "/icons/icon-512.png" as const;

/** Apple touch icon (180×180 PNG) — iOS home-screen / HTML metadata. */
export const APPLE_TOUCH_ICON = "/icons/apple-touch-icon.png" as const;

// ---------------------------------------------------------------------------
// Fonts (served from public/fonts/ — referenced by @font-face in tokens.css)
// ---------------------------------------------------------------------------

/** OpenDyslexic Regular woff — loaded on demand when the dyslexic reading font is active. */
export const FONT_OPENDYSLEXIC_REGULAR = "/fonts/OpenDyslexic-Regular.woff" as const;

/** OpenDyslexic Bold woff — loaded on demand when the dyslexic reading font is active. */
export const FONT_OPENDYSLEXIC_BOLD = "/fonts/OpenDyslexic-Bold.woff" as const;

// ---------------------------------------------------------------------------
// Offline pages (pre-cached by the service worker on install)
// ---------------------------------------------------------------------------

/** General offline fallback page — served by the service worker for failed HTML navigations. */
export const OFFLINE_PAGE = "/offline.html" as const;

/** Offline reader page — renders IndexedDB-cached articles when the network is unavailable. */
export const OFFLINE_READER_PAGE = "/offline-reader.html" as const;

const APP_LAYOUT_REF = "src/app/layout.tsx";
const APP_MANIFEST_REF = "src/app/manifest.ts";
const PUSH_COPY_REF = "src/lib/copy/push.ts";
const TOKENS_CSS_REF = "src/app/tokens.css";
const SERVICE_WORKER_REF = "public/sw.js";
const SERVICE_WORKER_REGISTER_REF = "src/components/ServiceWorkerRegister.tsx";

// ---------------------------------------------------------------------------
// Asset manifest — inventory of every governed file under public/
// ---------------------------------------------------------------------------

export type AssetEntry = {
  /** URL path (relative to `/`; maps to `public/<path>` on disk). */
  readonly path: string;
  /** Human-readable purpose. */
  readonly purpose: string;
  /**
   * Source files that reference this asset path. Keep this list current so
   * dead-asset audits can trace every reference.
   */
  readonly references: readonly string[];
};

/**
 * Inventory of all governed static assets under `public/`.
 *
 * The test suite (`tests/assets.test.ts`) verifies that every entry here
 * resolves to an existing file. Add an entry whenever a new file is placed
 * under `public/`; remove entries when files are deleted.
 */
export const ASSET_MANIFEST: readonly AssetEntry[] = [
  {
    path: ICON_SVG,
    purpose: "SVG app icon for HTML metadata and PWA manifest (any size)",
    references: [APP_LAYOUT_REF, APP_MANIFEST_REF],
  },
  {
    path: ICON_192,
    purpose: "192×192 PNG icon for PWA manifest and Web Push notifications",
    references: [APP_MANIFEST_REF, PUSH_COPY_REF],
  },
  {
    path: ICON_512,
    purpose: "512×512 PNG icon for PWA manifest (standard + maskable purpose)",
    references: [APP_MANIFEST_REF],
  },
  {
    path: APPLE_TOUCH_ICON,
    purpose: "Apple touch icon (180×180) for iOS home-screen shortcut",
    references: [APP_LAYOUT_REF],
  },
  {
    path: FONT_OPENDYSLEXIC_REGULAR,
    purpose:
      "OpenDyslexic Regular — dyslexic reading font, loaded on demand via @font-face in tokens.css",
    references: [TOKENS_CSS_REF],
  },
  {
    path: FONT_OPENDYSLEXIC_BOLD,
    purpose:
      "OpenDyslexic Bold — dyslexic reading font, loaded on demand via @font-face in tokens.css",
    references: [TOKENS_CSS_REF],
  },
  {
    path: OFFLINE_PAGE,
    purpose: "General offline fallback page pre-cached by the service worker",
    references: [SERVICE_WORKER_REF],
  },
  {
    path: OFFLINE_READER_PAGE,
    purpose: "Offline reader page pre-cached by the service worker; renders IndexedDB articles",
    references: [SERVICE_WORKER_REF],
  },
  {
    path: "/sw.js",
    purpose:
      "Service worker script — cache strategy, background sync, offline fallbacks (RW-044)",
    references: [SERVICE_WORKER_REGISTER_REF],
  },
] as const;
