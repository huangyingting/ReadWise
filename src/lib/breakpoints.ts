/**
 * Shared JS breakpoint constants that must match the CSS @media rules in
 * globals.css. Co-locate here to prevent silent drift when one side changes.
 *
 * Usage in components:
 *   import { READER_BREAKPOINT } from "@/lib/breakpoints";
 *   window.matchMedia(`(max-width: ${READER_BREAKPOINT - 1}px)`);
 *
 * CSS usage (globals.css): reference these values in comments when defining
 * the corresponding @media rules, e.g.:
 *   /* @breakpoint READER_BREAKPOINT (src/lib/breakpoints.ts) *\/
 *   @media (min-width: 1100px) { ... }
 */

/** Two-column reader layout breakpoint — matches @media (min-width: 1100px) in globals.css. */
export const READER_BREAKPOINT = 1100;

/** Lists/cards two-column layout breakpoint — matches @media (min-width: 900px) in globals.css. */
export const LISTS_BREAKPOINT = 900;
