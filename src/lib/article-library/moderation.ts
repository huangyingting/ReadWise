/**
 * Content governance — moderation review workflow and takedown/rights policy
 * (article-library subsystem, REF-040, BE-7).
 *
 * Barrel re-export. Implementation split by governance axis:
 *   review    — content quality review (verdicts, corrections, history)
 *   takedown  — rights & licensing policy (withheld/DMCA/unpublish)
 */
export * from "./review";
export * from "./takedown";
