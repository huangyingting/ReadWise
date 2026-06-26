/**
 * AI subsystem public entry point (RW-023).
 *
 * `@/lib/ai` is the single, stable import path the rest of the app uses for AI.
 * The implementation lives in `./facade`; this barrel keeps the public surface
 * stable while the subsystem's internals (provider, runner, registry) stay
 * private.
 *
 * ## Public surface
 *
 * - **Chat facade** (`chatComplete`, `chatCompleteWithMeta`, `isAiConfigured`,
 *   `aiModelName`) — provider-agnostic completion client from `./facade`.
 * - **Ambient context** (`runWithAiContext`, `getAiContext`) — lets background
 *   workers (e.g. the processor) mark all AI calls within a run as
 *   `kind: "background"` without threading an option through every helper.
 * - **Admin reporting** (`getAiBudgetStatus`) — budget/quota snapshot for
 *   admin dashboards.
 *
 * ## Private internals (do NOT import from outside `src/lib/ai/`)
 *
 * `provider`, `runner`, `registry`, and the budget enforcement functions
 * (`assertAiQuota`, `checkAiBudget`) are internal to the AI facade and must not
 * be imported by routes, features, or other subsystems.
 *
 * ## Allowed direct submodule imports
 *
 * `./cache`, `./ledger`, `./usage-summary`, `./chunking`, `./prompts`, and
 * `./output/*` are intentionally NOT re-exported here to avoid an import cycle
 * with `./cache` (which depends on `chatComplete` from this entry point). Feature
 * services that need those modules import them directly by their submodule path.
 */
export * from "./facade";

// Ambient context API — needed by the processor to propagate background kind.
// Budget *enforcement* (assertAiQuota / checkAiBudget) remains internal.
export { runWithAiContext, getAiContext } from "./budget";
export type { AiBudgetKind } from "./budget";

// Admin reporting — budget/quota snapshot for admin routes.
export { getAiBudgetStatus } from "./budget";
export type {
  AiBudgetStatus,
  AiBudgetLimitStatus,
  AiBudgetFeatureStatus,
} from "./budget";
