/**
 * @module @/lib/copy
 *
 * Centralized product copy, metadata strings, and notification text.
 *
 * Domains:
 *   - `site`  — product name, title template, site-level metadata & OG copy
 *   - `pages` — per-page static metadata (title / description)
 *   - `push`  — push notification payload and reminder settings UI copy
 *
 * Import individual domains directly for tree-shaking:
 *
 *   import { SITE_NAME, TITLE_TEMPLATE } from "@/lib/copy/site";
 *   import { signIn, settings } from "@/lib/copy/pages";
 *   import { reminder, ui as pushUi } from "@/lib/copy/push";
 *
 * Or import everything via the barrel when convenient:
 *
 *   import * as copy from "@/lib/copy";
 *   // copy.site, copy.pages, copy.push
 */

export * as site from "./site";
export * as pages from "./pages";
export * as push from "./push";
