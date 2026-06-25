/**
 * Public barrel for the offline feature package (REF-021).
 *
 * Re-exports the four focused adapters so callers can import from a single
 * canonical path (`@/lib/offline`) or from the specific sub-module when they
 * only need one concern.
 */

export * from "./idb";
export * from "./article-store";
export * from "./mutation-store";
export * from "./registry";
export * from "./sync-runtime";
