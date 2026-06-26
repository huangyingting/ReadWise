/**
 * Article library subsystem (REF-040).
 *
 * Re-exports the full public surface of the focused modules so consumers can
 * import from a single entry point:
 *
 *   import { canReadArticle, toListingArticle, searchArticles, … }
 *     from "@/lib/article-library";
 *
 * Module boundaries:
 *   policy           — access predicates, visibility WHERE builders, single-row fetchers
 *   mapper           — article card shaping and reading-time estimation (no DB)
 *   listings         — public feeds, category pages, picks, personal imports
 *   listing-response — shared article-list response builder (BE-9)
 *   admin            — admin search, detail view, delete, AI rebuild commands
 *   moderation       — content review workflow and takedown/rights policy
 *   collections      — taxonomy/tags and reading-list/bookmark management
 */
export * from "./policy";
export * from "./mapper";
export * from "./listings";
export * from "./listing-response";
export * from "./admin";
export * from "./moderation";
export * from "./collections";
